/**
 * FaceLandmarker 결과 → FaceFrame 변환의 순수/캔버스 로직.
 *
 * 메인 스레드 경로(faceDetection.ts 폴백)와 워커 경로(faceDetection.worker.ts)가
 * 동일 로직을 공유하도록 여기로 추출했다. window/document 등 DOM 전역에 의존하지 않으며,
 * 2D 컨텍스트는 Canvas/OffscreenCanvas 양쪽 타입을 받는다.
 */

import type { EmotionScores, FaceFrame } from '../types/index';

export interface Point {
  x: number;
  y: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface NormPt {
  x: number;
  y: number;
  z?: number;
}

// MediaPipe FaceLandmarker 결과의 우리가 쓰는 부분만 추린 최소 형태
export interface LandmarkResult {
  faceLandmarks?: NormPt[][];
  faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
}

// 코끝 이동량(정규화)이 이 값을 넘으면 움직임이 커 rPPG 샘플을 건너뜀
export const MOTION_GATE = 0.02;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// 주요 얼굴 특징 연결 (Face Mesh) — 모듈 상수로 한 번만 생성
const CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // 얼굴 윤곽
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 0],
  // 왼쪽 눈
  [33, 246], [246, 161], [161, 160], [160, 159], [159, 158], [158, 157], [157, 173], [173, 133],
  // 오른쪽 눈
  [263, 466], [466, 388], [388, 387], [387, 386], [386, 385], [385, 384], [384, 398], [398, 362],
  // 입
  [61, 185], [185, 40], [40, 39], [39, 37], [37, 0], [0, 267], [267, 269], [269, 270],
  [270, 409], [409, 291], [291, 375], [375, 321], [321, 405], [405, 314], [314, 17], [17, 84],
  [84, 181], [181, 91], [91, 106],
];

// 오버레이가 실제로 쓰는 정점만 (CONNECTIONS에 등장하는 ~60개). 점 패스를 FaceMesh
// 478점 전체가 아니라 이 부분집합으로 그려 매 프레임 arc 비용을 ~8배 줄인다.
const CONNECTION_VERTICES: readonly number[] = [...new Set(CONNECTIONS.flat())];

// 랜드마크 점·연결선 그리기 (정규화 좌표 → 픽셀 인라인 변환, 중간 배열 할당 없음)
export function drawLandmarks(ctx: Ctx2D, landmarks: NormPt[], w: number, h: number): void {
  // 점 — 한 패스로 모아 한 번에 fill (연결선에 쓰이는 정점만)
  ctx.fillStyle = '#00FF00';
  ctx.beginPath();
  for (const idx of CONNECTION_VERTICES) {
    const landmark = landmarks[idx];
    if (!landmark) continue;
    const x = landmark.x * w;
    const y = landmark.y * h;
    ctx.moveTo(x + 2, y);
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
  }
  ctx.fill();

  // 선 — 한 패스로 모아 한 번에 stroke
  ctx.strokeStyle = '#00FF00';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of CONNECTIONS) {
    const start = landmarks[a];
    const end = landmarks[b];
    if (start && end) {
      ctx.moveTo(start.x * w, start.y * h);
      ctx.lineTo(end.x * w, end.y * h);
    }
  }
  ctx.stroke();
}

// 블렌드셰이프 카테고리 배열 → 이름→점수 Map (감정·긴장 계산에서 공유).
// 프레임마다 새 Map을 만들지 않고 모듈 단일 인스턴스를 비우고 채운다.
// (buildFrame은 스레드 내 동기 실행이며 반환 전에 이 Map을 모두 소비한다)
const sharedShape = new Map<string, number>();
function blendshapeMap(categories: Array<{ categoryName: string; score: number }>): Map<string, number> {
  sharedShape.clear();
  for (const c of categories) sharedShape.set(c.categoryName, c.score);
  return sharedShape;
}

// 블렌드셰이프 조회 헬퍼 — 프레임마다 클로저를 새로 만들지 않도록 모듈 스코프에 둔다
const shapeGet = (shape: Map<string, number>, name: string): number => shape.get(name) ?? 0;
const shapePair = (shape: Map<string, number>, base: string): number =>
  (shapeGet(shape, `${base}Left`) + shapeGet(shape, `${base}Right`)) / 2;

const clamp100 = (v: number): number => Math.min(100, Math.max(0, v));

// 긴장 감지·웃음 판별에 쓰는 블렌드셰이프 부분집합 (0~1)
function extractTensionSignals(
  shape: Map<string, number>
): Omit<FaceFrame, 'emotions' | 'gazeX' | 'gazeY' | 'headMotion'> {
  return {
    browDown: shapePair(shape, 'browDown'),
    mouthPress: shapePair(shape, 'mouthPress'),
    noseSneer: shapePair(shape, 'noseSneer'),
    eyeSquint: shapePair(shape, 'eyeSquint'),
    mouthStretch: shapePair(shape, 'mouthStretch'),
    smile: shapePair(shape, 'mouthSmile'),
    cheekSquint: shapePair(shape, 'cheekSquint'),
    blink: shapePair(shape, 'eyeBlink'),
  };
}

// ARKit 스타일 블렌드셰이프(0~1) 조합으로 7종 감정 점수(0~100) 산출
function calculateEmotionFromBlendshapes(shape: Map<string, number>): EmotionScores {
  const smile = shapePair(shape, 'mouthSmile');
  const cheekSquint = shapePair(shape, 'cheekSquint');
  const frown = shapePair(shape, 'mouthFrown');
  const browInnerUp = shapeGet(shape, 'browInnerUp');
  const browDown = shapePair(shape, 'browDown');
  const eyeSquint = shapePair(shape, 'eyeSquint');
  const mouthPress = shapePair(shape, 'mouthPress');
  const eyeWide = shapePair(shape, 'eyeWide');
  const browOuterUp = shapePair(shape, 'browOuterUp');
  const jawOpen = shapeGet(shape, 'jawOpen');
  const noseSneer = shapePair(shape, 'noseSneer');
  const upperLipRaise = shapePair(shape, 'mouthUpperUp');
  const mouthStretch = shapePair(shape, 'mouthStretch');

  const happy = clamp100((smile * 1.2 + cheekSquint * 0.4) * 100);
  const sad = clamp100((frown * 0.9 + browInnerUp * 0.5) * 100);
  const angry = clamp100((browDown * 1.0 + eyeSquint * 0.4 + mouthPress * 0.5) * 100);
  const surprised = clamp100((eyeWide * 0.7 + browOuterUp * 0.6 + jawOpen * 0.5) * 100);
  const disgusted = clamp100((noseSneer * 1.2 + upperLipRaise * 0.6) * 100);
  const fearful = clamp100((eyeWide * 0.4 + browInnerUp * 0.4 + mouthStretch * 0.7) * 100);

  const scores: EmotionScores = {
    happy,
    sad,
    angry,
    surprised,
    neutral: 0,
    disgusted,
    fearful,
  };
  const total = happy + sad + angry + surprised + disgusted + fearful;
  scores.neutral = clamp100(100 - total);
  return scores;
}

function calculateEmotionFromLandmarks(landmarks: Point[]): EmotionScores {
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const leftMouth = landmarks[61];
  const rightMouth = landmarks[291];
  const mouthTop = landmarks[13];
  const mouthBottom = landmarks[14];

  if (!leftEye || !rightEye || !leftMouth || !rightMouth || !mouthTop || !mouthBottom) {
    return { happy: 0, sad: 0, angry: 0, surprised: 0, neutral: 100, disgusted: 0, fearful: 0 };
  }

  const mouthHeight = Math.abs(mouthBottom.y - mouthTop.y);
  const eyeDistance = Math.abs(rightEye.y - leftEye.y);

  const happy = Math.min(100, mouthHeight > 15 ? mouthHeight * 3 : 0);
  const surprised = Math.min(100, eyeDistance > 30 ? (eyeDistance - 20) * 2 : 0);
  const sad = Math.min(100, mouthHeight < 5 ? 50 : 0);

  const emotionScores: EmotionScores = {
    happy,
    sad,
    angry: 0,
    surprised,
    neutral: 0,
    disgusted: 0,
    fearful: 0,
  };
  const total = happy + sad + surprised;
  emotionScores.neutral = total === 0 ? 100 : Math.max(0, 100 - total);
  return emotionScores;
}

// 정규화 좌표 중심 박스에서 평균 R/G/B를 추출 (화면 밖이면 null) — POS rPPG용.
// 20x20 다운샘플 캔버스 컨텍스트와 샘플 소스(비디오/ImageBitmap)를 주입받는다.
function sampleBox(
  sctx: Ctx2D,
  source: CanvasImageSource,
  cx: number,
  cy: number,
  w: number,
  h: number,
  vw: number,
  vh: number
): Rgb | null {
  const pw = w * vw;
  const ph = h * vh;
  const sx = cx * vw - pw / 2;
  const sy = cy * vh - ph / 2;
  if (sx < 0 || sy < 0 || sx + pw > vw || sy + ph > vh || pw < 4 || ph < 4) {
    return null;
  }

  try {
    sctx.drawImage(source, sx, sy, pw, ph, 0, 0, 20, 20);
    const data = sctx.getImageData(0, 0, 20, 20).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const px = data.length / 4;
    return { r: r / px, g: g / px, b: b / px };
  } catch {
    return null; // ROI 샘플 실패는 무시 (심박만 영향)
  }
}

// 이마 + 양 볼 다중 ROI에서 평균 RGB를 추출 (호출자가 심박 서비스에 전달). 없으면 null.
function sampleForehead(
  sctx: Ctx2D,
  source: CanvasImageSource,
  normalized: NormPt[],
  vw: number,
  vh: number
): Rgb | null {
  if (!vw || !vh) return null;

  const top = normalized[10]; // 이마 상단 중앙
  const mid = normalized[151]; // 이마 중앙
  const brow = normalized[9]; // 미간 위
  if (!top || !mid || !brow) return null;

  const fh = Math.abs(brow.y - top.y); // 이마 높이(정규화)
  if (fh <= 0) return null;

  const rois: Array<{ cx: number; cy: number; w: number; h: number }> = [
    { cx: mid.x, cy: top.y + fh * 0.45, w: fh * 1.3, h: fh * 0.6 },
  ];
  const leftCheek = normalized[50];
  const rightCheek = normalized[280];
  if (leftCheek) rois.push({ cx: leftCheek.x, cy: leftCheek.y, w: fh * 0.9, h: fh * 0.9 });
  if (rightCheek) rois.push({ cx: rightCheek.x, cy: rightCheek.y, w: fh * 0.9, h: fh * 0.9 });

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const roi of rois) {
    const m = sampleBox(sctx, source, roi.cx, roi.cy, roi.w, roi.h, vw, vh);
    if (m) {
      r += m.r;
      g += m.g;
      b += m.b;
      count += 1;
    }
  }
  if (count === 0) return null;
  return { r: r / count, g: g / count, b: b / count };
}

export interface BuildFrameDeps {
  result: LandmarkResult;
  drawCtx: Ctx2D; // 랜드마크 오버레이 (이미 비디오 크기로 설정/clear됨)
  sampleCtx: Ctx2D; // 20x20 다운샘플 캔버스 컨텍스트 (willReadFrequently)
  source: CanvasImageSource; // ROI 샘플 소스 (비디오 또는 ImageBitmap)
  w: number; // 소스/캔버스 너비(px)
  h: number; // 소스/캔버스 높이(px)
  lastGaze: Point | null; // 직전 프레임 코끝 위치(정규화)
}

export interface BuildFrameResult {
  frame: FaceFrame | null;
  sample: Rgb | null; // 심박 샘플 (없으면 null) — 호출자가 heartRateService에 전달
  gaze: Point | null; // 갱신된 직전 코끝 위치 (호출자가 보관)
}

// FaceLandmarker 결과 1개 → FaceFrame + 심박 샘플 + 갱신된 gaze.
// 드로잉/샘플링은 주입된 컨텍스트에서 수행되므로 메인/워커 양쪽에서 동작한다.
export function buildFrame(deps: BuildFrameDeps): BuildFrameResult {
  const { result, drawCtx, sampleCtx, source, w, h, lastGaze } = deps;
  const normalized = result.faceLandmarks?.[0];
  if (!normalized || normalized.length === 0) {
    return { frame: null, sample: null, gaze: lastGaze };
  }

  drawLandmarks(drawCtx, normalized, w, h);

  // 코끝(랜드마크 1) 정규화 좌표 → 시선/머리 위치 + 직전 대비 이동량
  const nose = normalized[1] ?? normalized[4] ?? { x: 0.5, y: 0.5 };
  const gazeX = nose.x;
  const gazeY = nose.y;
  const headMotion = lastGaze ? Math.hypot(gazeX - lastGaze.x, gazeY - lastGaze.y) : 0;
  const gaze = { x: gazeX, y: gazeY };

  // rPPG: 움직임이 작을 때만 피부 ROI 수집 (품질 게이팅)
  const sample = headMotion < MOTION_GATE ? sampleForehead(sampleCtx, source, normalized, w, h) : null;

  // 블렌드셰이프 기반 계산 — 랜드마크 거리 추정보다 훨씬 정확
  const blendshapes = result.faceBlendshapes?.[0]?.categories;
  if (blendshapes && blendshapes.length > 0) {
    const shape = blendshapeMap(blendshapes);
    return {
      frame: {
        emotions: calculateEmotionFromBlendshapes(shape),
        ...extractTensionSignals(shape),
        gazeX,
        gazeY,
        headMotion,
      },
      sample,
      gaze,
    };
  }

  // 폴백: 블렌드셰이프가 없으면 감정만 추정하고 긴장 신호는 0
  const points: Point[] = normalized.map((p) => ({ x: p.x * w, y: p.y * h }));
  return {
    frame: {
      emotions: calculateEmotionFromLandmarks(points),
      browDown: 0,
      mouthPress: 0,
      noseSneer: 0,
      eyeSquint: 0,
      mouthStretch: 0,
      smile: 0,
      cheekSquint: 0,
      blink: 0,
      gazeX,
      gazeY,
      headMotion,
    },
    sample,
    gaze,
  };
}

// 7종 감정 중 최고 점수 감정명 (순수 함수 — 메인 스레드에서 사용)
export function getPrimaryEmotion(scores: EmotionScores): string {
  const entries = Object.entries(scores);
  const [emotion] = entries.reduce((max, current) => (current[1] > max[1] ? current : max));
  return emotion;
}
