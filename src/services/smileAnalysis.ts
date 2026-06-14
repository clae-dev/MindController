/**
 * 억지웃음 판별 — Duchenne 미소 원리. 진짜 웃음은 입꼬리(mouthSmile)뿐 아니라
 * 눈가 근육(cheekSquint)이 함께 수축한다. 입만 웃으면 억지 웃음으로 본다.
 * 재미용 추정이며 정밀 판별이 아니다.
 */

import type { FaceFrame, SmileResult } from '../types/index';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function computeSmileAuthenticity(frames: FaceFrame[]): SmileResult {
  if (frames.length === 0) {
    return { authenticity: 0, verdict: 'faint', smile: 0, cheekSquint: 0 };
  }

  // 최고 미소 강도
  const maxSmile = frames.reduce((m, f) => Math.max(m, f.smile), 0);

  // 미소가 약하면 판정 보류
  if (maxSmile < 0.15) {
    return { authenticity: 0, verdict: 'faint', smile: maxSmile, cheekSquint: 0 };
  }

  // 충분히 웃은 구간(최고 미소의 60% 이상)에서 눈가 근육 평균
  const peakFrames = frames.filter((f) => f.smile >= maxSmile * 0.6);
  const cheek =
    peakFrames.reduce((a, f) => a + f.cheekSquint, 0) / Math.max(1, peakFrames.length);

  // Duchenne 비율: 눈가 근육이 입 미소에 비해 얼마나 동반됐나
  const ratio = clamp01(cheek / maxSmile);
  const authenticity = Math.round(ratio * 100);
  const verdict: SmileResult['verdict'] = authenticity >= 45 ? 'genuine' : 'forced';

  return { authenticity, verdict, smile: maxSmile, cheekSquint: cheek };
}
