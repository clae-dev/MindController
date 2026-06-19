import type { EmotionScores, FaceFrame } from '../types/index';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { heartRateService } from './heartRate';

interface Point {
  x: number;
  y: number;
}

// 코끝 이동량(정규화)이 이 값을 넘으면 움직임이 커 rPPG 샘플을 건너뜀
const MOTION_GATE = 0.02;

export class FaceDetectionService {
  private landmarker: FaceLandmarker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private isInitialized = false;
  private modelLoadPromise: Promise<void> | null = null;

  // rPPG 심박 측정용: 피부 ROI를 작게 다운샘플해 평균 RGB를 추출하는 오프스크린 캔버스
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleCtx: CanvasRenderingContext2D | null = null;

  // 직전 프레임 코끝 위치(정규화) — 머리 움직임량 계산용
  private lastGaze: { x: number; y: number } | null = null;

  // 모델 다운로드 + 초기화를 미리 수행 (멱등 — 여러 번 호출해도 1회만 로드)
  loadModel(): Promise<void> {
    if (!this.modelLoadPromise) {
      this.modelLoadPromise = this.doLoadModel().catch((error) => {
        this.modelLoadPromise = null; // 실패 시 재시도 가능하도록 리셋
        throw error;
      });
    }
    return this.modelLoadPromise;
  }

  private async doLoadModel(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

    try {
      this.landmarker = await this.createLandmarker(fileset, 'GPU');
    } catch (error) {
      console.warn('GPU delegate failed, falling back to CPU:', error);
      this.landmarker = await this.createLandmarker(fileset, 'CPU');
    }

    await this.warmup();
    console.log('Face landmarker loaded and warmed up');
  }

  private createLandmarker(
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: 'GPU' | 'CPU'
  ): Promise<FaceLandmarker> {
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: '/models/face_landmarker.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true, // 표정 근육 수치(미소, 찌푸림 등 52종) — 감정 계산에 사용
    });
  }

  // 실제 얼굴 이미지로 추론 1회 실행 → 첫 라이브 감지 지연 제거
  private async warmup(): Promise<void> {
    try {
      const img = new Image();
      img.src = '/warmup-face.jpg';
      await img.decode();

      const result = this.landmarker!.detectForVideo(img, performance.now());
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        console.warn('Warmup image contained no detectable face; first live detection may be slow');
      }
    } catch (error) {
      console.warn('Face detection warmup failed:', error);
    }
  }

  async bind(videoElement: HTMLVideoElement, canvas?: HTMLCanvasElement): Promise<void> {
    await this.loadModel();
    this.videoElement = videoElement;
    this.canvas = canvas || document.createElement('canvas');
    this.canvasCtx = this.canvas.getContext('2d');
    this.lastGaze = null;
    this.isInitialized = true;
  }

  // 얼굴이 감지되면 감정 점수를, 감지되지 않으면 null을 반환 (기존 마음 분석용)
  async detectFaceAndEmotion(): Promise<EmotionScores | null> {
    const frame = await this.detectFaceFrame();
    return frame ? frame.emotions : null;
  }

  // 얼굴이 감지되면 감정 + 긴장/웃음/시선 신호를 함께 반환 (긴장 감지용)
  async detectFaceFrame(): Promise<FaceFrame | null> {
    if (!this.videoElement || !this.canvas || !this.landmarker || !this.isInitialized) {
      throw new Error('Face detection not initialized');
    }

    const ctx = this.canvasCtx;
    if (!ctx) {
      throw new Error('Cannot get canvas context');
    }

    // 크기 변경 시에만 버퍼 재할당 (매 프레임 재할당은 비용이 큼)
    if (this.canvas.width !== this.videoElement.videoWidth) {
      this.canvas.width = this.videoElement.videoWidth;
    }
    if (this.canvas.height !== this.videoElement.videoHeight) {
      this.canvas.height = this.videoElement.videoHeight;
    }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    try {
      const result = this.landmarker.detectForVideo(this.videoElement, performance.now());
      const normalized = result.faceLandmarks?.[0];

      if (!normalized || normalized.length === 0) {
        return null;
      }

      // 드로잉은 정규화 좌표에서 인라인 변환 — 매 프레임 478개 Point 객체 할당을 피함
      this.drawLandmarks(ctx, normalized, this.canvas.width, this.canvas.height);

      // 코끝(랜드마크 1) 정규화 좌표 → 시선/머리 위치 + 직전 대비 이동량
      const nose = normalized[1] ?? normalized[4] ?? { x: 0.5, y: 0.5 };
      const gazeX = nose.x;
      const gazeY = nose.y;
      const headMotion = this.lastGaze
        ? Math.hypot(gazeX - this.lastGaze.x, gazeY - this.lastGaze.y)
        : 0;
      this.lastGaze = { x: gazeX, y: gazeY };

      // rPPG: 움직임이 작을 때만 피부 ROI를 심박 추정용으로 수집 (품질 게이팅)
      if (headMotion < MOTION_GATE) {
        this.sampleForehead(normalized);
      }

      // 블렌드셰이프(표정 근육 수치) 기반 계산 — 랜드마크 거리 추정보다 훨씬 정확
      const blendshapes = result.faceBlendshapes?.[0]?.categories;
      if (blendshapes && blendshapes.length > 0) {
        const shape = this.blendshapeMap(blendshapes);
        return {
          emotions: this.calculateEmotionFromBlendshapes(shape),
          ...this.extractTensionSignals(shape),
          gazeX,
          gazeY,
          headMotion,
        };
      }

      // 폴백: 블렌드셰이프가 없으면 감정만 추정하고 긴장 신호는 0
      // (드문 경로이므로 여기서만 픽셀 좌표를 할당)
      const points: Point[] = normalized.map((p) => ({
        x: p.x * this.canvas!.width,
        y: p.y * this.canvas!.height,
      }));
      return {
        emotions: this.calculateEmotionFromLandmarks(points),
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
      };
    } catch (error) {
      console.error('Face detection error:', error);
      throw error;
    }
  }

  private drawLandmarks(
    ctx: CanvasRenderingContext2D,
    landmarks: Array<{ x: number; y: number }>,
    w: number,
    h: number
  ): void {
    // 점 그리기 — 478개를 한 패스로 모아 한 번에 fill (개별 fill 대비 그리기 비용 감소)
    // 정규화 좌표(0~1)를 그릴 때 픽셀로 인라인 변환 (중간 배열 할당 없음)
    ctx.fillStyle = '#00FF00';
    ctx.beginPath();
    for (const landmark of landmarks) {
      const x = landmark.x * w;
      const y = landmark.y * h;
      ctx.moveTo(x + 2, y);
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
    }
    ctx.fill();

    // 주요 얼굴 특징 연결 (Face Mesh)
    const connections = [
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

    // 선 그리기 — 한 패스로 모아 한 번에 stroke
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const connection of connections) {
      const start = landmarks[connection[0]];
      const end = landmarks[connection[1]];
      if (start && end) {
        ctx.moveTo(start.x * w, start.y * h);
        ctx.lineTo(end.x * w, end.y * h);
      }
    }
    ctx.stroke();
  }

  // 블렌드셰이프 카테고리 배열 → 이름→점수 Map (감정·긴장 계산에서 공유)
  private blendshapeMap(
    categories: Array<{ categoryName: string; score: number }>
  ): Map<string, number> {
    const shape = new Map<string, number>();
    for (const c of categories) shape.set(c.categoryName, c.score);
    return shape;
  }

  // 긴장 감지·웃음 판별에 쓰는 블렌드셰이프 부분집합 (0~1)
  private extractTensionSignals(
    shape: Map<string, number>
  ): Omit<FaceFrame, 'emotions' | 'gazeX' | 'gazeY' | 'headMotion'> {
    const s = (name: string) => shape.get(name) ?? 0;
    const pair = (base: string) => (s(`${base}Left`) + s(`${base}Right`)) / 2;
    return {
      browDown: pair('browDown'),
      mouthPress: pair('mouthPress'),
      noseSneer: pair('noseSneer'),
      eyeSquint: pair('eyeSquint'),
      mouthStretch: pair('mouthStretch'),
      smile: pair('mouthSmile'),
      cheekSquint: pair('cheekSquint'),
      blink: pair('eyeBlink'),
    };
  }

  // ARKit 스타일 블렌드셰이프(0~1) 조합으로 7종 감정 점수(0~100) 산출
  private calculateEmotionFromBlendshapes(shape: Map<string, number>): EmotionScores {
    const s = (name: string) => shape.get(name) ?? 0;
    const pair = (base: string) => (s(`${base}Left`) + s(`${base}Right`)) / 2;
    const clamp = (v: number) => Math.min(100, Math.max(0, v));

    const smile = pair('mouthSmile');
    const cheekSquint = pair('cheekSquint');
    const frown = pair('mouthFrown');
    const browInnerUp = s('browInnerUp');
    const browDown = pair('browDown');
    const eyeSquint = pair('eyeSquint');
    const mouthPress = pair('mouthPress');
    const eyeWide = pair('eyeWide');
    const browOuterUp = pair('browOuterUp');
    const jawOpen = s('jawOpen');
    const noseSneer = pair('noseSneer');
    const upperLipRaise = pair('mouthUpperUp');
    const mouthStretch = pair('mouthStretch');

    const happy = clamp((smile * 1.2 + cheekSquint * 0.4) * 100);
    const sad = clamp((frown * 0.9 + browInnerUp * 0.5) * 100);
    const angry = clamp((browDown * 1.0 + eyeSquint * 0.4 + mouthPress * 0.5) * 100);
    const surprised = clamp((eyeWide * 0.7 + browOuterUp * 0.6 + jawOpen * 0.5) * 100);
    const disgusted = clamp((noseSneer * 1.2 + upperLipRaise * 0.6) * 100);
    const fearful = clamp((eyeWide * 0.4 + browInnerUp * 0.4 + mouthStretch * 0.7) * 100);

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
    scores.neutral = clamp(100 - total);
    return scores;
  }

  // 정규화 좌표 중심 박스에서 평균 R/G/B를 추출 (화면 밖이면 null) — POS rPPG용
  private sampleBox(
    cx: number,
    cy: number,
    w: number,
    h: number,
    vw: number,
    vh: number
  ): { r: number; g: number; b: number } | null {
    const pw = w * vw;
    const ph = h * vh;
    const sx = cx * vw - pw / 2;
    const sy = cy * vh - ph / 2;
    if (sx < 0 || sy < 0 || sx + pw > vw || sy + ph > vh || pw < 4 || ph < 4) {
      return null;
    }

    if (!this.sampleCanvas) {
      this.sampleCanvas = document.createElement('canvas');
      this.sampleCanvas.width = 20;
      this.sampleCanvas.height = 20;
      this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    const sctx = this.sampleCtx;
    if (!sctx) return null;

    try {
      sctx.drawImage(this.videoElement!, sx, sy, pw, ph, 0, 0, 20, 20);
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

  // 이마 + 양 볼 다중 ROI에서 평균 RGB를 추출해 심박(POS) 추정 샘플로 전달
  private sampleForehead(normalized: Array<{ x: number; y: number }>): void {
    const video = this.videoElement;
    if (!video || !video.videoWidth) return;

    const top = normalized[10]; // 이마 상단 중앙
    const mid = normalized[151]; // 이마 중앙
    const brow = normalized[9]; // 미간 위
    if (!top || !mid || !brow) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const fh = Math.abs(brow.y - top.y); // 이마 높이(정규화)
    if (fh <= 0) return;

    // ROI 중심(정규화): 이마 + 좌/우 볼. 헤어라인/눈썹은 살짝 피함
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
      const m = this.sampleBox(roi.cx, roi.cy, roi.w, roi.h, vw, vh);
      if (m) {
        r += m.r;
        g += m.g;
        b += m.b;
        count += 1;
      }
    }
    if (count === 0) return;
    heartRateService.addSample(r / count, g / count, b / count, performance.now());
  }

  private calculateEmotionFromLandmarks(landmarks: Point[]): EmotionScores {
    // 주요 랜드마크 인덱스
    const leftEye = landmarks[33]; // 왼쪽 눈 바깥쪽
    const rightEye = landmarks[263]; // 오른쪽 눈 바깥쪽
    const leftMouth = landmarks[61]; // 입 왼쪽
    const rightMouth = landmarks[291]; // 입 오른쪽
    const mouthTop = landmarks[13]; // 입 위쪽
    const mouthBottom = landmarks[14]; // 입 아래쪽

    if (!leftEye || !rightEye || !leftMouth || !rightMouth || !mouthTop || !mouthBottom) {
      return {
        happy: 0,
        sad: 0,
        angry: 0,
        surprised: 0,
        neutral: 100,
        disgusted: 0,
        fearful: 0,
      };
    }

    // 입의 높이 계산 (미소 감지)
    const mouthHeight = Math.abs(mouthBottom.y - mouthTop.y);

    // 눈의 높이 계산 (놀람 감지)
    const eyeDistance = Math.abs(rightEye.y - leftEye.y);

    // 표정 점수 계산
    const happy = Math.min(100, mouthHeight > 15 ? mouthHeight * 3 : 0);
    const surprised = Math.min(100, eyeDistance > 30 ? (eyeDistance - 20) * 2 : 0);
    const sad = Math.min(100, mouthHeight < 5 ? 50 : 0);
    const angry = 0; // 간단한 구현에서는 계산 어려움
    const disgusted = 0; // 간단한 구현에서는 계산 어려움

    const emotionScores: EmotionScores = {
      happy,
      sad,
      angry,
      surprised,
      neutral: 0,
      disgusted,
      fearful: 0,
    };

    // 합계가 0이면 중립으로 설정
    const total = Object.values(emotionScores).reduce((a, b) => a + b, 0);
    if (total === 0) {
      emotionScores.neutral = 100;
    } else {
      emotionScores.neutral = Math.max(0, 100 - total);
    }

    return emotionScores;
  }

  getPrimaryEmotion(scores: EmotionScores): string {
    const entries = Object.entries(scores);
    const [emotion] = entries.reduce((max, current) =>
      current[1] > max[1] ? current : max
    );
    return emotion;
  }

  // 비디오/캔버스 바인딩만 해제 — 로드된 모델은 유지 (재마운트 시 재다운로드 방지)
  unbind(): void {
    this.canvas = null;
    this.canvasCtx = null;
    this.videoElement = null;
    this.lastGaze = null;
    this.isInitialized = false;
  }
}

export const faceDetectionService = new FaceDetectionService();
