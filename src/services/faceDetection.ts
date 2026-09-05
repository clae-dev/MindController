import type { Delegate, EmotionScores, FaceFrame } from '../types/index';
import type { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { ActiveDelegate, WorkerIn, WorkerOut } from './faceDetection.worker';
// `?worker` import: 프로덕션 빌드에서 Vite가 **클래식 워커**(iife)로 생성한다.
// MediaPipe는 워커에서 WASM 로더를 importScripts로 불러오는데, 모듈 워커에선 importScripts가
// 금지돼 "ModuleFactory not set"으로 실패하고 메인 스레드로 폴백돼 왔다. 개발 서버(dev)는
// 워커를 항상 모듈로 서빙하므로 dev에서만 폴백되고, 빌드 결과에선 워커 경로가 정상 동작한다.
import FaceWorker from './faceDetection.worker?worker';
import { heartRateService } from './heartRate';
import { buildFrame, getPrimaryEmotion, type Point } from './faceLandmarkerCore';
import { perfProfile } from '../utils/tvMode';
import { perfStats, recordDetect, recordError } from '../utils/perfStats';

/**
 * 얼굴 감지 진입점 — 가능하면 Web Worker + OffscreenCanvas에서 추론/드로잉/ROI 샘플링을
 * 수행해 메인 스레드를 비우고(React·Lottie와 경쟁 제거), 미지원 환경에서는 기존
 * 메인 스레드 경로로 자동 폴백한다. 공개 인터페이스는 두 경로가 동일하다.
 *
 * 심박 버퍼/추정(DFT)은 항상 메인 스레드(heartRateService)가 소유하며,
 * 워커 경로에서도 워커는 RGB 샘플만 반환하고 누적은 여기서 한다.
 *
 * 성능 프로파일(utils/tvMode.ts)에 따라 추론 위임(GPU/CPU)과 오버레이 드로잉 여부가 정해지고,
 * detect() 소요 시간은 utils/perfStats.ts에 기록돼 PerfHud에서 볼 수 있다.
 */

interface Backend {
  // 요청한 위임으로 초기화하고 실제 활성화된 위임을 반환
  load(delegate: Delegate): Promise<ActiveDelegate>;
  // canvas가 null이면 랜드마크 오버레이를 그리지 않는다
  bind(video: HTMLVideoElement, canvas: HTMLCanvasElement | null): Promise<void>;
  detect(): Promise<FaceFrame | null>;
  unbind(): void;
}

const workerSupported = (): boolean =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';

// ─── 워커 백엔드 ────────────────────────────────────────────────────────────
class WorkerBackend implements Backend {
  private worker: Worker;
  private video: HTMLVideoElement | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (f: FaceFrame | null) => void; reject: (e: unknown) => void }>();
  private loadResolve: ((d: ActiveDelegate) => void) | null = null;
  private loadReject: ((e: unknown) => void) | null = null;
  // load() 호출 전에 워커가 죽은 경우(모듈 평가 에러 등)를 기억해 즉시 reject
  private earlyError: unknown = null;

  constructor() {
    this.worker = new FaceWorker();
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      // 초기화 중이면 로드 실패로 전파, 그 외에는 진행 중 detect를 모두 거부
      const err = new Error(`worker error: ${e.message}`);
      if (this.loadReject) {
        this.loadReject(err);
        this.loadResolve = this.loadReject = null;
      } else {
        this.earlyError = err;
      }
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    };
  }

  private post(msg: WorkerIn, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private onMessage(msg: WorkerOut): void {
    switch (msg.type) {
      case 'loaded':
        this.loadResolve?.(msg.delegate);
        this.loadResolve = this.loadReject = null;
        break;
      case 'load-error':
        this.loadReject?.(new Error(msg.message));
        this.loadResolve = this.loadReject = null;
        break;
      case 'detect-result': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.sample) {
            heartRateService.addSample(msg.sample.r, msg.sample.g, msg.sample.b, performance.now());
          }
          p.resolve(msg.frame);
        }
        break;
      }
      case 'detect-error': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.reject(new Error(msg.message));
        }
        break;
      }
    }
  }

  load(delegate: Delegate): Promise<ActiveDelegate> {
    return new Promise<ActiveDelegate>((resolve, reject) => {
      if (this.earlyError) {
        reject(this.earlyError);
        return;
      }
      this.loadResolve = resolve;
      this.loadReject = reject;
      this.post({ type: 'load', delegate });
    });
  }

  async bind(video: HTMLVideoElement, canvas: HTMLCanvasElement | null): Promise<void> {
    this.video = video;
    // 오버레이를 끈 경우 transferControlToOffscreen 자체를 하지 않는다 (요소당 1회만 가능)
    const offscreen = canvas ? canvas.transferControlToOffscreen() : null;
    this.post({ type: 'bind', canvas: offscreen }, offscreen ? [offscreen] : []);
  }

  detect(): Promise<FaceFrame | null> {
    const video = this.video;
    // 첫 프레임이 디코딩되기 전(readyState < HAVE_CURRENT_DATA)엔 createImageBitmap이 throw하므로 건너뜀
    if (!video || !video.videoWidth || video.readyState < 2) {
      return Promise.resolve(null);
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    perfStats.captureW = w;
    perfStats.captureH = h;
    return createImageBitmap(video).then(
      (bitmap) =>
        new Promise<FaceFrame | null>((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, { resolve, reject });
          this.post({ type: 'detect', id, bitmap, w, h }, [bitmap]);
        })
    );
  }

  unbind(): void {
    this.video = null;
    for (const { reject } of this.pending.values()) reject(new Error('unbound'));
    this.pending.clear();
    this.post({ type: 'unbind' });
  }

  dispose(): void {
    this.worker.terminate();
  }
}

// ─── 메인 스레드 백엔드 (폴백) ──────────────────────────────────────────────
class MainBackend implements Backend {
  private landmarker: FaceLandmarker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private video: HTMLVideoElement | null = null;
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleCtx: CanvasRenderingContext2D | null = null;
  private lastGaze: Point | null = null;

  private createLandmarker(
    FaceLandmarkerCls: typeof FaceLandmarker,
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: ActiveDelegate
  ): Promise<FaceLandmarker> {
    return FaceLandmarkerCls.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
  }

  private async warmup(): Promise<void> {
    try {
      const img = new Image();
      img.src = '/warmup-face.jpg';
      await img.decode();
      const result = this.landmarker!.detectForVideo(img, performance.now());
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        console.warn('Warmup image had no detectable face; first live detection may be slow');
      }
    } catch (error) {
      console.warn('Face detection warmup failed:', error);
    }
  }

  async load(pref: Delegate): Promise<ActiveDelegate> {
    // 메인 스레드 폴백 경로에서만 MediaPipe를 동적 로드한다 — 워커가 지원되는
    // 일반 브라우저에선 이 무거운 래퍼가 메인 번들에 포함되지 않는다.
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    let active: ActiveDelegate = 'CPU';
    if (pref === 'auto') {
      try {
        this.landmarker = await this.createLandmarker(FaceLandmarker, fileset, 'GPU');
        active = 'GPU';
      } catch (error) {
        console.warn('GPU delegate failed, falling back to CPU:', error);
      }
    }
    if (!this.landmarker) {
      this.landmarker = await this.createLandmarker(FaceLandmarker, fileset, 'CPU');
    }
    await this.warmup();
    return active;
  }

  async bind(video: HTMLVideoElement, canvas: HTMLCanvasElement | null): Promise<void> {
    this.video = video;
    this.canvas = canvas;
    this.canvasCtx = canvas ? canvas.getContext('2d') : null;
    this.lastGaze = null;
  }

  private ensureSampleCtx(): CanvasRenderingContext2D | null {
    if (!this.sampleCanvas) {
      this.sampleCanvas = document.createElement('canvas');
      this.sampleCanvas.width = 20;
      this.sampleCanvas.height = 20;
      this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    return this.sampleCtx;
  }

  detect(): Promise<FaceFrame | null> {
    const video = this.video;
    const canvas = this.canvas;
    const ctx = this.canvasCtx;
    if (!video || !this.landmarker) {
      throw new Error('Face detection not initialized');
    }
    if (!video.videoWidth || video.readyState < 2) return Promise.resolve(null);
    const sctx = this.ensureSampleCtx();
    if (!sctx) throw new Error('Cannot get sample context');

    const w = video.videoWidth;
    const h = video.videoHeight;
    perfStats.captureW = w;
    perfStats.captureH = h;
    // 오버레이가 있을 때만 캔버스 크기 맞추고 clear
    if (canvas && ctx) {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.clearRect(0, 0, w, h);
    }

    const result = this.landmarker.detectForVideo(video, performance.now());
    const out = buildFrame({
      result,
      drawCtx: ctx,
      sampleCtx: sctx,
      source: video,
      w,
      h,
      lastGaze: this.lastGaze,
    });
    this.lastGaze = out.gaze;
    if (out.sample) {
      heartRateService.addSample(out.sample.r, out.sample.g, out.sample.b, performance.now());
    }
    return Promise.resolve(out.frame);
  }

  unbind(): void {
    this.canvas = null;
    this.canvasCtx = null;
    this.video = null;
    this.lastGaze = null;
  }
}

// ─── 프록시 (백엔드 선택 + 폴백) ────────────────────────────────────────────
export class FaceDetectionService {
  private backend: Backend | null = null;
  private modelLoadPromise: Promise<void> | null = null;

  // 모델 다운로드 + 초기화 (멱등). 워커 경로가 실패하면 메인 스레드 경로로 폴백.
  loadModel(): Promise<void> {
    if (!this.modelLoadPromise) {
      this.modelLoadPromise = this.init().catch((error) => {
        this.modelLoadPromise = null; // 실패 시 재시도 가능
        throw error;
      });
    }
    return this.modelLoadPromise;
  }

  private async init(): Promise<void> {
    if (workerSupported()) {
      const backend = new WorkerBackend();
      try {
        const delegate = await backend.load(perfProfile.delegate);
        this.backend = backend;
        perfStats.backend = 'worker';
        perfStats.delegate = delegate;
        console.log(`Face landmarker ready (worker, ${delegate})`);
        return;
      } catch (error) {
        console.warn('Worker backend unavailable, falling back to main thread:', error);
        recordError(error);
        backend.dispose();
        this.backend = null;
      }
    }
    const main = new MainBackend();
    const delegate = await main.load(perfProfile.delegate);
    this.backend = main;
    perfStats.backend = 'main';
    perfStats.delegate = delegate;
    console.log(`Face landmarker ready (main thread, ${delegate})`);
  }

  async bind(videoElement: HTMLVideoElement, canvas?: HTMLCanvasElement): Promise<void> {
    await this.loadModel();
    if (!this.backend) throw new Error('Face detection backend not initialized');
    // 프로파일에서 오버레이를 껐으면(TV 모드) 캔버스를 넘기지 않아 드로잉·전송 비용을 없앤다
    const overlay = perfProfile.drawOverlay ? (canvas ?? null) : null;
    await this.backend.bind(videoElement, overlay);
  }

  // 얼굴이 감지되면 감정 점수를, 아니면 null (기존 마음 분석용)
  async detectFaceAndEmotion(): Promise<EmotionScores | null> {
    const frame = await this.detectFaceFrame();
    return frame ? frame.emotions : null;
  }

  // 얼굴이 감지되면 감정 + 긴장/웃음/시선 신호를 함께 반환 (긴장 감지용)
  async detectFaceFrame(): Promise<FaceFrame | null> {
    if (!this.backend) throw new Error('Face detection not initialized');
    const t0 = performance.now();
    try {
      const frame = await this.backend.detect();
      recordDetect(performance.now() - t0, t0, frame !== null);
      return frame;
    } catch (err) {
      recordError(err);
      throw err;
    }
  }

  getPrimaryEmotion(scores: EmotionScores): string {
    return getPrimaryEmotion(scores);
  }

  // 비디오/캔버스 바인딩만 해제 — 로드된 모델·워커는 유지 (재마운트 시 재다운로드 방지)
  unbind(): void {
    this.backend?.unbind();
  }
}

export const faceDetectionService = new FaceDetectionService();
