/**
 * 얼굴 감지 파이프라인 성능 통계 — 모듈 전역 객체 하나를 갱신하고 PerfHud가 주기적으로 읽는다.
 * React·tvMode에 의존하지 않아 서비스 어디서든 import할 수 있다 (워커 제외).
 */

export interface PerfStats {
  backend: 'worker' | 'main' | '-';
  delegate: 'GPU' | 'CPU' | '-';
  detectMs: number; // detect() 왕복 시간 EMA
  loopFps: number; // 연속 detect 호출 간격 기반 EMA
  captureW: number; // 실제 videoWidth
  captureH: number; // 실제 videoHeight
  frames: number; // 총 detect 호출 수
  faces: number; // 얼굴이 감지된 호출 수
  errors: number;
  lastError: string;
}

export const perfStats: PerfStats = {
  backend: '-',
  delegate: '-',
  detectMs: 0,
  loopFps: 0,
  captureW: 0,
  captureH: 0,
  frames: 0,
  faces: 0,
  errors: 0,
  lastError: '',
};

const EMA_ALPHA = 0.1;
let lastCalledAt = 0;

const ema = (prev: number, next: number): number =>
  prev === 0 ? next : prev + EMA_ALPHA * (next - prev);

export function recordDetect(durationMs: number, calledAt: number, faceFound: boolean): void {
  perfStats.frames += 1;
  if (faceFound) perfStats.faces += 1;
  perfStats.detectMs = ema(perfStats.detectMs, durationMs);
  if (lastCalledAt > 0) {
    const gap = calledAt - lastCalledAt;
    // 세션 간 긴 공백(측정 중단 후 재시작)은 fps 통계에서 제외
    if (gap > 0 && gap < 2000) perfStats.loopFps = ema(perfStats.loopFps, 1000 / gap);
  }
  lastCalledAt = calledAt;
}

export function recordError(err: unknown): void {
  perfStats.errors += 1;
  perfStats.lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

// 개발자도구가 없는 기기(TV)에서 예외를 HUD로 보기 위한 전역 훅 — debug 모드에서만 설치
export function installErrorHooks(): void {
  window.addEventListener('error', (e) => recordError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason));
}
