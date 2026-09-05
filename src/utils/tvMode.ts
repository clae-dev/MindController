/**
 * TV 모드(스탠바이미 등 저사양 대화면 브라우저) 판별과 성능 프로파일.
 *
 * 우선순위: URL `?tv=1|0`(저장) → `?tv=auto`(저장 삭제) → localStorage → webOS UA 자동 감지.
 * 모듈 평가 시점에 한 번만 resolve되며, 워커에서는 절대 import하지 않는다
 * (document/localStorage에 접근하므로 Delegate 타입은 types/index.ts에 둔다).
 *
 * 현장 튜닝용 URL 오버라이드(저장하지 않음):
 *   fps=N        얼굴 감지 주기 (2~30)
 *   cap=WxH      카메라 캡처 해상도 (예: 480x360)
 *   overlay=0|1  랜드마크 메쉬 오버레이
 *   lottie=still|play  이모지 애니메이션 재생 여부
 *   delegate=cpu|gpu|auto  MediaPipe 추론 위임 (gpu는 auto와 동일)
 *   debug=1      성능 HUD 표시
 */

import type { Delegate } from '../types/index';

export type TvSource = 'url' | 'stored' | 'ua' | 'none';

export interface PerfProfile {
  tv: boolean;
  tvSource: TvSource; // TV 모드가 결정된 근거 (HUD 표시용)
  detectionIntervalMs: number; // 얼굴 감지 루프 목표 주기
  captureWidth: number; // getUserMedia ideal 너비
  captureHeight: number; // getUserMedia ideal 높이
  drawOverlay: boolean; // 랜드마크 메쉬 오버레이 그리기 여부
  lottie: 'play' | 'still'; // 이모지 Lottie 재생 / 첫 프레임 정지
  delegate: Delegate; // MediaPipe 추론 위임
  debug: boolean; // PerfHud 표시
}

type Preset = Omit<PerfProfile, 'tv' | 'tvSource' | 'debug'>;

const STORAGE_KEY = 'mc-tv-mode'; // '1' | '0'
const TV_UA = /Web0S|webOS|SmartTV|WebAppManager/i;

const PRESETS: Record<'default' | 'tv', Preset> = {
  default: {
    detectionIntervalMs: 100,
    captureWidth: 640,
    captureHeight: 480,
    drawOverlay: true,
    lottie: 'play',
    delegate: 'auto',
  },
  // 스탠바이미2 기준 초기값 — 현장에서 HUD로 측정한 뒤 조정한다
  tv: {
    detectionIntervalMs: 166,
    captureWidth: 480,
    captureHeight: 360,
    drawOverlay: false,
    lottie: 'still',
    delegate: 'auto',
  },
};

function readParams(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function readStored(): '1' | '0' | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null; // localStorage 불가 환경 — 자동 감지만 사용
  }
}

function writeStored(value: '1' | '0' | null): void {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 저장 실패는 무시 (이번 세션에만 적용)
  }
}

function resolveTvMode(params: URLSearchParams): { tv: boolean; source: TvSource } {
  const q = params.get('tv');
  if (q === '1' || q === '0') {
    writeStored(q);
    return { tv: q === '1', source: 'url' };
  }
  if (q === 'auto') writeStored(null);

  const stored = readStored();
  if (stored !== null) return { tv: stored === '1', source: 'stored' };

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (TV_UA.test(ua)) return { tv: true, source: 'ua' };
  return { tv: false, source: 'none' };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function applyOverrides(base: Preset, params: URLSearchParams): Preset {
  const out: Preset = { ...base };

  const fps = Number(params.get('fps'));
  if (Number.isFinite(fps) && fps > 0) {
    out.detectionIntervalMs = Math.round(1000 / clamp(fps, 2, 30));
  }

  const cap = /^(\d{2,4})x(\d{2,4})$/i.exec(params.get('cap') ?? '');
  if (cap) {
    out.captureWidth = Number(cap[1]);
    out.captureHeight = Number(cap[2]);
  }

  const overlay = params.get('overlay');
  if (overlay === '0' || overlay === '1') out.drawOverlay = overlay === '1';

  const lottie = params.get('lottie');
  if (lottie === 'still' || lottie === 'play') out.lottie = lottie;

  const delegate = (params.get('delegate') ?? '').toLowerCase();
  if (delegate === 'cpu') out.delegate = 'CPU';
  else if (delegate === 'gpu' || delegate === 'auto') out.delegate = 'auto';

  return out;
}

function resolveProfile(): PerfProfile {
  const params = readParams();
  const { tv, source } = resolveTvMode(params);
  const preset = applyOverrides(tv ? PRESETS.tv : PRESETS.default, params);
  return {
    tv,
    tvSource: source,
    ...preset,
    debug: params.get('debug') === '1',
  };
}

export const perfProfile: PerfProfile = resolveProfile();

export const isTvMode = (): boolean => perfProfile.tv;

// <html data-tv="1">을 토글해 CSS의 TV 모드 블록을 활성화한다 (멱등, React 마운트 전에 호출)
export function applyTvModeToDocument(): void {
  const root = document.documentElement;
  if (perfProfile.tv) root.dataset.tv = '1';
  else delete root.dataset.tv;
}
