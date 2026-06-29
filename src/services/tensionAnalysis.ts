/**
 * 긴장 감지 분석 — baseline(평소 상태) 대비 표정 긴장·미세표정 불안정성·깜빡임 변화·
 * 시선 흔들림·심박 상승을 합쳐 0~100 "긴장 지수"를 산출한다.
 *
 * 주의: 거짓말을 판별하는 것이 아니라 각성/긴장 수준을 추정하는 엔터테인먼트용 도구다.
 */

import type { FaceFrame, TensionBreakdown, TensionSummary, QuestionResult } from '../types/index';
import { heartRateService } from './heartRate';

// 성분별 가중치 (합 1.0)
const WEIGHTS: TensionBreakdown = {
  facial: 0.35,
  instability: 0.2,
  blink: 0.15,
  gaze: 0.15,
  heart: 0.15,
};

// baseline 대비 편차를 0~1로 정규화하는 스케일 (엔터테인먼트용 경험값, 튜닝 가능)
const SCALES = {
  facial: 0.25, // 표정 긴장 블렌드셰이프 편차
  instability: 0.15, // 감정 벡터 프레임 간 변동
  blink: 0.6, // 분당이 아닌 초당 깜빡임 편차
  gaze: 0.0015, // 코끝 위치 분산(정규화^2)
  heart: 15, // BPM 상승
};

const ROLLING_WINDOW_MS = 1500; // 라이브 지표 계산용 롤링 윈도
const BLINK_THRESHOLD = 0.5; // eyeBlink 가 이 값을 넘으면 깜빡임 1회
const MOTION_GATE = 0.02; // 코끝 이동량이 이보다 크면 저품질 프레임
const EMA_ALPHA = 0.2; // 표시 안정화용 지수이동평균 계수
const BPM_RECALC_MS = 1000; // 심박 재계산 주기 (DFT 비용 절감)

interface FrameRecord {
  t: number;
  facial: number; // 순간 표정 긴장 0~1
  blink: number;
  gazeX: number;
  gazeY: number;
  emotion: number[]; // 불안정성 계산용 감정 벡터(neutral 제외)
  lowQuality: boolean;
}

interface Baseline {
  facial: number;
  blinkRate: number; // 초당 깜빡임
  gazeVar: number;
  instability: number;
  bpm: number | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// 표정 긴장: 긴장 관련 블렌드셰이프의 가중 합 (0~1로 클램프)
function facialTension(f: FaceFrame): number {
  return clamp01(
    f.browDown * 1.0 +
      f.mouthPress * 0.8 +
      f.noseSneer * 0.6 +
      f.eyeSquint * 0.4 +
      f.mouthStretch * 0.5
  );
}

// 불안정성 계산용 감정 벡터 (neutral 제외, 0~1 스케일)
// 매 프레임 호출되므로 리터럴+map 2회 할당 대신 단일 배열 리터럴로 한 번만 할당
function emotionVec(f: FaceFrame): number[] {
  const e = f.emotions;
  return [
    e.happy / 100,
    e.sad / 100,
    e.angry / 100,
    e.surprised / 100,
    e.disgusted / 100,
    e.fearful / 100,
  ];
}

// 표정 긴장 평균 — 중간 배열 할당 없이 단일 패스로 누산
function facialMean(records: FrameRecord[]): number {
  if (!records.length) return 0;
  let sum = 0;
  for (let i = 0; i < records.length; i++) sum += records[i].facial;
  return sum / records.length;
}

// 연속 프레임 감정 벡터 간 L1 거리 평균 → 미세표정 불안정성
function instabilityOf(records: FrameRecord[]): number {
  if (records.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < records.length; i++) {
    const a = records[i].emotion;
    const b = records[i - 1].emotion;
    let d = 0;
    for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]);
    sum += d;
  }
  return sum / (records.length - 1);
}

// 깜빡임 상승 에지 횟수 / 구간 길이(초) → 초당 깜빡임
function blinkRateOf(records: FrameRecord[]): number {
  if (records.length < 2) return 0;
  let edges = 0;
  for (let i = 1; i < records.length; i++) {
    if (records[i].blink >= BLINK_THRESHOLD && records[i - 1].blink < BLINK_THRESHOLD) edges += 1;
  }
  const durSec = (records[records.length - 1].t - records[0].t) / 1000;
  return durSec > 0 ? edges / durSec : 0;
}

// 코끝 위치 분산 합(gazeX + gazeY) — 합/제곱합 단일 패스로 중간 배열 회피
function gazeVarOf(records: FrameRecord[]): number {
  const n = records.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i++) {
    const x = records[i].gazeX;
    const y = records[i].gazeY;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumYY += y * y;
  }
  const varX = sumXX / n - (sumX / n) ** 2;
  const varY = sumYY / n - (sumY / n) ** 2;
  return Math.max(0, varX) + Math.max(0, varY);
}

class TensionAnalysisService {
  private baselineRecords: FrameRecord[] = [];
  private baseline: Baseline | null = null;
  private window: FrameRecord[] = [];
  private ema = 0;
  // 세션 통계는 배열로 쌓지 않고 러닝 누산기로 유지 (무한 증가·Math.max 스프레드 회피)
  private sessionPeak = 0;
  private sessionSum = 0;
  private sessionCount = 0;
  private breakdownTotals: TensionBreakdown = {
    facial: 0,
    instability: 0,
    blink: 0,
    gaze: 0,
    heart: 0,
  };
  private confidenceSum = 0;
  private confidenceCount = 0;
  private startT: number | null = null;
  private lastT: number | null = null;
  private cachedBpm: number | null = null;
  private lastBpmCalcT = 0;
  private segment: { label: string; peak: number; sum: number; count: number } | null = null;

  reset(): void {
    this.baselineRecords = [];
    this.baseline = null;
    this.window = [];
    this.ema = 0;
    this.sessionPeak = 0;
    this.sessionSum = 0;
    this.sessionCount = 0;
    this.breakdownTotals = { facial: 0, instability: 0, blink: 0, gaze: 0, heart: 0 };
    this.confidenceSum = 0;
    this.confidenceCount = 0;
    this.startT = null;
    this.lastT = null;
    this.cachedBpm = null;
    this.lastBpmCalcT = 0;
    this.segment = null;
  }

  private toRecord(frame: FaceFrame, t: number): FrameRecord {
    return {
      t,
      facial: facialTension(frame),
      blink: frame.blink,
      gazeX: frame.gazeX,
      gazeY: frame.gazeY,
      emotion: emotionVec(frame),
      lowQuality: frame.headMotion >= MOTION_GATE,
    };
  }

  // baseline 구간: 평온 상태 프레임 누적
  recordBaselineFrame(frame: FaceFrame, t: number): void {
    this.baselineRecords.push(this.toRecord(frame, t));
  }

  // baseline 확정 — 각 지표의 기준값을 계산
  finalizeBaseline(): void {
    const recs = this.baselineRecords;
    const hr = heartRateService.estimate();
    this.baseline = {
      facial: facialMean(recs),
      blinkRate: blinkRateOf(recs),
      gazeVar: gazeVarOf(recs),
      instability: instabilityOf(recs),
      bpm: hr && hr.confidence >= 0.3 ? hr.bpm : null,
    };
  }

  // 라이브 프레임 1개 처리 → 현재 긴장 지수 + 성분 기여도 + 신뢰도 반환
  pushFrame(
    frame: FaceFrame,
    t: number
  ): { tension: number; breakdown: TensionBreakdown; confidence: number } {
    const base = this.baseline ?? {
      facial: 0,
      blinkRate: 0,
      gazeVar: 0,
      instability: 0,
      bpm: null,
    };
    if (this.startT === null) this.startT = t;
    this.lastT = t;

    const rec = this.toRecord(frame, t);
    this.window.push(rec);
    // 롤링 윈도 유지
    while (this.window.length > 2 && t - this.window[0].t > ROLLING_WINDOW_MS) {
      this.window.shift();
    }

    // 윈도 기반 현재 지표
    const facialNow = facialMean(this.window);
    const instabilityNow = instabilityOf(this.window);
    const blinkRateNow = blinkRateOf(this.window);
    const gazeVarNow = gazeVarOf(this.window);

    // 심박은 비용이 커 주기적으로만 재계산
    if (t - this.lastBpmCalcT >= BPM_RECALC_MS) {
      const hr = heartRateService.estimate();
      this.cachedBpm = hr && hr.confidence >= 0.3 ? hr.bpm : this.cachedBpm;
      this.lastBpmCalcT = t;
    }

    // baseline 대비 정규화된 편차 (양의 변화만 긴장으로 간주, 깜빡임은 절대 변화)
    const n: TensionBreakdown = {
      facial: clamp01(Math.max(0, facialNow - base.facial) / SCALES.facial),
      instability: clamp01(Math.max(0, instabilityNow - base.instability) / SCALES.instability),
      blink: clamp01(Math.abs(blinkRateNow - base.blinkRate) / SCALES.blink),
      gaze: clamp01(Math.max(0, gazeVarNow - base.gazeVar) / SCALES.gaze),
      heart:
        this.cachedBpm !== null && base.bpm !== null
          ? clamp01(Math.max(0, this.cachedBpm - base.bpm) / SCALES.heart)
          : 0,
    };

    const raw =
      WEIGHTS.facial * n.facial +
      WEIGHTS.instability * n.instability +
      WEIGHTS.blink * n.blink +
      WEIGHTS.gaze * n.gaze +
      WEIGHTS.heart * n.heart;
    const tensionRaw = clamp01(raw) * 100;

    // 지수이동평균으로 표시 안정화
    this.ema = this.sessionCount === 0 ? tensionRaw : this.ema + EMA_ALPHA * (tensionRaw - this.ema);
    const tension = Math.round(this.ema);

    // 신뢰도: 최근 윈도의 저품질(움직임 큰) 프레임 비율
    // 매 프레임 호출이라 filter로 임시 배열을 만들지 않고 카운트만 누적
    let lowQ = 0;
    for (let i = 0; i < this.window.length; i++) {
      if (this.window[i].lowQuality) lowQ += 1;
    }
    const confidence = clamp01(1 - lowQ / Math.max(1, this.window.length));

    // 세션 누산기 갱신
    if (tension > this.sessionPeak) this.sessionPeak = tension;
    this.sessionSum += tension;
    this.sessionCount += 1;
    this.breakdownTotals.facial += n.facial;
    this.breakdownTotals.instability += n.instability;
    this.breakdownTotals.blink += n.blink;
    this.breakdownTotals.gaze += n.gaze;
    this.breakdownTotals.heart += n.heart;
    this.confidenceSum += confidence;
    this.confidenceCount += 1;
    if (this.segment) {
      if (tension > this.segment.peak) this.segment.peak = tension;
      this.segment.sum += tension;
      this.segment.count += 1;
    }

    return { tension, breakdown: n, confidence };
  }

  // 질문 챌린지: 구간 시작/종료
  beginSegment(label: string): void {
    this.segment = { label, peak: 0, sum: 0, count: 0 };
  }

  endSegment(): QuestionResult {
    const seg = this.segment ?? { label: '', peak: 0, sum: 0, count: 0 };
    this.segment = null;
    return {
      question: seg.label,
      peak: seg.count ? seg.peak : 0,
      average: seg.count ? Math.round(seg.sum / seg.count) : 0,
    };
  }

  getSummary(): TensionSummary {
    const peak = this.sessionPeak;
    const average = this.sessionCount ? Math.round(this.sessionSum / this.sessionCount) : 0;

    // 성분별 누적 기여 합 → 최대 기여 신호
    const totals = this.breakdownTotals;
    const topSignal = (Object.keys(totals) as Array<keyof TensionBreakdown>).reduce((a, b) =>
      totals[b] > totals[a] ? b : a
    );

    const band: TensionSummary['band'] = peak < 33 ? 'calm' : peak < 66 ? 'mild' : 'tense';
    const durationSec =
      this.startT !== null && this.lastT !== null ? Math.round((this.lastT - this.startT) / 1000) : 0;

    return {
      peak,
      average,
      band,
      topSignal,
      confidence: clamp01(this.confidenceCount ? this.confidenceSum / this.confidenceCount : 0),
      durationSec,
    };
  }
}

export const tensionAnalysisService = new TensionAnalysisService();
