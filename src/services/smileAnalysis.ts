/**
 * 진짜/억지 웃음 판별 — Duchenne 미소 원리. 진짜 웃음은 입꼬리(mouthSmile)뿐 아니라
 * 눈둘레근이 함께 수축해 볼이 올라가고(cheekSquint) 눈이 가늘어진다(eyeSquint).
 * 입만 웃으면 억지 웃음으로 본다. 재미용 추정이며 정밀 판별이 아니다.
 *
 * 핵심: 눈가 동반 정도를 입 미소로 "나누지" 않는다(cheekSquint는 원래 mouthSmile보다
 * 훨씬 작게 나와 진짜 웃음도 억지로 찍힘). 대신 눈가 engagement를 자체 스케일로 점수화하고,
 * 가능하면 무표정 baseline 대비 "증가량"으로 판정한다.
 */

import type { FaceFrame, SmileResult } from '../types/index';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mean = (arr: number[]) => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0);

// 눈가 engagement 가중치 (cheekSquint가 더 특이적인 Duchenne 마커, eyeSquint는 보조)
const W_CHEEK = 0.7;
const W_EYE = 0.3;

const SCALE = 0.45; // baseline 없을 때: eyeRaw → 0..1 정규화
const SCALE_DELTA = 0.3; // baseline 있을 때: (eyeRaw - baseEye) → 0..1 정규화
const SMILE_FAINT = 0.15; // 이보다 약하면 판정 보류(faint)
const PEAK_FRAC = 0.6; // 최고 미소의 60% 이상 구간만 사용
const GENUINE_T = 55; // 이 점수 이상이면 진짜 웃음
const MOTION_GATE = 0.02; // 흔들린(블러) 프레임 제외 기준 (faceDetection과 동일)

// 한 프레임의 눈가 근육 동반 정도 (0~1)
const eyeEngageOf = (f: FaceFrame) => clamp01(W_CHEEK * f.cheekSquint + W_EYE * f.eyeSquint);

// baseline(무표정) 프레임에서 평균 눈가 engagement — 모션 게이팅 후 계산
export function meanEyeEngage(frames: FaceFrame[]): number {
  if (frames.length === 0) return 0;
  const usable = frames.filter((f) => f.headMotion < MOTION_GATE);
  const src = usable.length > 0 ? usable : frames;
  return mean(src.map(eyeEngageOf));
}

export function computeSmileAuthenticity(frames: FaceFrame[], baseEye = 0): SmileResult {
  const faint: SmileResult = {
    authenticity: 0,
    verdict: 'faint',
    smile: 0,
    cheekSquint: 0,
    eyeEngage: 0,
    baseEye,
  };
  if (frames.length === 0) return faint;

  // 모션 게이팅: 흔들린 프레임 제외. 전부 걸러지면 전체로 폴백(저신뢰).
  const usable = frames.filter((f) => f.headMotion < MOTION_GATE);
  const lowConfidence = usable.length === 0;
  const src = lowConfidence ? frames : usable;

  // 최고 미소 강도 (단일 프레임) — faint 게이트 판단용
  const maxSmile = src.reduce((m, f) => Math.max(m, f.smile), 0);
  if (maxSmile < SMILE_FAINT) {
    return { ...faint, smile: maxSmile, lowConfidence };
  }

  // 충분히 웃은 구간(최고 미소의 60% 이상)
  const peakFrames = src.filter((f) => f.smile >= maxSmile * PEAK_FRAC);
  const peak = peakFrames.length > 0 ? peakFrames : src;

  // peak 구간 평균으로 입/눈가를 같은 척도에서 비교
  const smile = mean(peak.map((f) => f.smile));
  const eyeRaw = mean(peak.map(eyeEngageOf));
  const cheek = mean(peak.map((f) => f.cheekSquint));

  // baseline이 있으면 증가량으로, 없으면 절대값으로 점수화
  const score =
    baseEye > 0
      ? clamp01(Math.max(0, eyeRaw - baseEye) / SCALE_DELTA)
      : clamp01(eyeRaw / SCALE);
  const authenticity = Math.round(score * 100);
  const verdict: SmileResult['verdict'] = authenticity >= GENUINE_T ? 'genuine' : 'forced';

  return { authenticity, verdict, smile, cheekSquint: cheek, eyeEngage: eyeRaw, baseEye, lowConfidence };
}
