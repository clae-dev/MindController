/// <reference lib="webworker" />
/**
 * 얼굴 감지 워커 — FaceLandmarker 추론, 랜드마크 오버레이 드로잉, rPPG ROI 샘플링을
 * 메인 스레드에서 분리해 수행한다. 메인 스레드는 매 프레임 비디오를 ImageBitmap으로
 * 떠서 전달(transfer)하고, 워커는 { frame, sample }을 돌려준다.
 *
 * 오버레이 캔버스는 bind 시 transferControlToOffscreen으로 한 번 넘겨받아 워커가 직접 그린다.
 * 심박 버퍼/추정(DFT)은 메인 스레드가 소유하므로, 워커는 RGB 샘플만 반환한다.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { buildFrame, type Point } from './faceLandmarkerCore';

type InMessage =
  | { type: 'load' }
  | { type: 'bind'; canvas: OffscreenCanvas }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; w: number; h: number }
  | { type: 'unbind' };

let landmarker: FaceLandmarker | null = null;
let overlay: OffscreenCanvas | null = null;
let overlayCtx: OffscreenCanvasRenderingContext2D | null = null;
let sampleCanvas: OffscreenCanvas | null = null;
let sampleCtx: OffscreenCanvasRenderingContext2D | null = null;
let lastGaze: Point | null = null;

// MediaPipe VIDEO 모드는 단조 증가 타임스탬프를 요구한다 (워커 시계 기준으로 통일)
let lastTs = 0;
const nextTs = (): number => {
  const t = Math.max(performance.now(), lastTs + 1);
  lastTs = t;
  return t;
};

async function createLandmarker(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: 'GPU' | 'CPU'
): Promise<FaceLandmarker> {
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
}

async function warmup(): Promise<void> {
  let bitmap: ImageBitmap;
  try {
    const res = await fetch('/warmup-face.jpg');
    bitmap = await createImageBitmap(await res.blob());
  } catch (error) {
    // 워밍업 이미지 다운로드 실패는 관용 (모델 자체는 사용 가능) — 첫 감지가 느려질 뿐
    console.warn('[worker] warmup image unavailable, skipping:', error);
    return;
  }
  // detectForVideo가 워커 컨텍스트에서 실제로 동작하는지 검증한다.
  // 여기서 throw하면 load()가 실패하고 메인 스레드 경로로 폴백되므로, 일부러 catch하지 않는다.
  try {
    const result = landmarker!.detectForVideo(bitmap, nextTs());
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      console.warn('[worker] warmup image had no detectable face');
    }
  } finally {
    bitmap.close();
  }
}

async function load(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  try {
    landmarker = await createLandmarker(fileset, 'GPU');
  } catch (error) {
    console.warn('[worker] GPU delegate failed, falling back to CPU:', error);
    landmarker = await createLandmarker(fileset, 'CPU');
  }
  await warmup();
}

function ensureSampleCtx(): OffscreenCanvasRenderingContext2D | null {
  if (!sampleCanvas) {
    sampleCanvas = new OffscreenCanvas(20, 20);
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  return sampleCtx;
}

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data;

  if (msg.type === 'load') {
    try {
      await load();
      (self as DedicatedWorkerGlobalScope).postMessage({ type: 'loaded' });
    } catch (error) {
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: 'load-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (msg.type === 'bind') {
    overlay = msg.canvas;
    overlayCtx = overlay.getContext('2d');
    lastGaze = null;
    return;
  }

  if (msg.type === 'unbind') {
    overlay = null;
    overlayCtx = null;
    lastGaze = null;
    return;
  }

  if (msg.type === 'detect') {
    const { id, bitmap, w, h } = msg;
    try {
      if (!landmarker || !overlay || !overlayCtx) {
        throw new Error('worker not initialized');
      }
      const sctx = ensureSampleCtx();
      if (!sctx) throw new Error('cannot get sample context');

      // 크기 변경 시에만 버퍼 재할당 후 clear
      if (overlay.width !== w) overlay.width = w;
      if (overlay.height !== h) overlay.height = h;
      overlayCtx.clearRect(0, 0, w, h);

      const result = landmarker.detectForVideo(bitmap, nextTs());
      const out = buildFrame({
        result,
        drawCtx: overlayCtx,
        sampleCtx: sctx,
        source: bitmap,
        w,
        h,
        lastGaze,
      });
      lastGaze = out.gaze;
      bitmap.close();

      (self as DedicatedWorkerGlobalScope).postMessage({
        type: 'detect-result',
        id,
        frame: out.frame,
        sample: out.sample,
      });
    } catch (error) {
      bitmap.close();
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: 'detect-error',
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
