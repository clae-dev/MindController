/// <reference lib="webworker" />
/**
 * 얼굴 감지 워커 — FaceLandmarker 추론, 랜드마크 오버레이 드로잉, rPPG ROI 샘플링을
 * 메인 스레드에서 분리해 수행한다. 메인 스레드는 매 프레임 비디오를 ImageBitmap으로
 * 떠서 전달(transfer)하고, 워커는 { frame, sample }을 돌려준다.
 *
 * 오버레이 캔버스는 bind 시 transferControlToOffscreen으로 한 번 넘겨받아 워커가 직접 그린다.
 * TV 모드처럼 오버레이를 끈 경우 canvas는 null로 오고 드로잉을 건너뛴다.
 * 심박 버퍼/추정(DFT)은 메인 스레드가 소유하므로, 워커는 RGB 샘플만 반환한다.
 *
 * 이 파일은 utils/tvMode.ts를 import하면 안 된다 (document/localStorage 접근).
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Delegate, FaceFrame } from '../types/index';
import { buildFrame, OVERLAY_SCALE, type Point, type Rgb } from './faceLandmarkerCore';

export type ActiveDelegate = 'GPU' | 'CPU';

// 메인 → 워커
export type WorkerIn =
  | { type: 'load'; delegate: Delegate }
  | { type: 'bind'; canvas: OffscreenCanvas | null }
  | { type: 'detect'; id: number; bitmap: ImageBitmap; w: number; h: number }
  | { type: 'unbind' };

// 워커 → 메인
export type WorkerOut =
  | { type: 'loaded'; delegate: ActiveDelegate }
  | { type: 'load-error'; message: string }
  | { type: 'detect-result'; id: number; frame: FaceFrame | null; sample: Rgb | null }
  | { type: 'detect-error'; id: number; message: string };

const post = (msg: WorkerOut): void => (self as DedicatedWorkerGlobalScope).postMessage(msg);

let landmarker: FaceLandmarker | null = null;
let bound = false;
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
  delegate: ActiveDelegate
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

// 요청된 위임으로 초기화하고 실제로 활성화된 위임을 반환한다
async function load(pref: Delegate): Promise<ActiveDelegate> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  let active: ActiveDelegate = 'CPU';
  if (pref === 'auto') {
    try {
      landmarker = await createLandmarker(fileset, 'GPU');
      active = 'GPU';
    } catch (error) {
      console.warn('[worker] GPU delegate failed, falling back to CPU:', error);
    }
  }
  if (!landmarker) landmarker = await createLandmarker(fileset, 'CPU');
  await warmup();
  return active;
}

function ensureSampleCtx(): OffscreenCanvasRenderingContext2D | null {
  if (!sampleCanvas) {
    sampleCanvas = new OffscreenCanvas(20, 20);
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  return sampleCtx;
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;

  if (msg.type === 'load') {
    try {
      const delegate = await load(msg.delegate);
      post({ type: 'loaded', delegate });
    } catch (error) {
      post({
        type: 'load-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (msg.type === 'bind') {
    overlay = msg.canvas;
    overlayCtx = overlay?.getContext('2d') ?? null;
    bound = true;
    lastGaze = null;
    return;
  }

  if (msg.type === 'unbind') {
    overlay = null;
    overlayCtx = null;
    bound = false;
    lastGaze = null;
    return;
  }

  if (msg.type === 'detect') {
    const { id, bitmap, w, h } = msg;
    try {
      if (!landmarker || !bound) {
        throw new Error('worker not initialized');
      }
      const sctx = ensureSampleCtx();
      if (!sctx) throw new Error('cannot get sample context');

      // 오버레이가 있을 때만: 크기 변경 시 버퍼 재할당 후 clear (절반 해상도, CSS로 확대)
      const ow = Math.round(w * OVERLAY_SCALE);
      const oh = Math.round(h * OVERLAY_SCALE);
      if (overlay && overlayCtx) {
        if (overlay.width !== ow) overlay.width = ow;
        if (overlay.height !== oh) overlay.height = oh;
        overlayCtx.clearRect(0, 0, ow, oh);
      }

      const result = landmarker.detectForVideo(bitmap, nextTs());
      const out = buildFrame({
        result,
        drawCtx: overlayCtx,
        drawW: ow,
        drawH: oh,
        sampleCtx: sctx,
        source: bitmap,
        w,
        h,
        lastGaze,
      });
      lastGaze = out.gaze;
      bitmap.close();

      post({ type: 'detect-result', id, frame: out.frame, sample: out.sample });
    } catch (error) {
      bitmap.close();
      post({
        type: 'detect-error',
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
