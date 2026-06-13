import type { EmotionScores } from '../types/index';

/**
 * 분포 기반 자동 보정 — 측정이 쌓일수록 판정이 정확해진다.
 *
 * 측정마다 익명 통계(평균/분산, Welford 알고리즘)를 localStorage에 누적하고,
 * 표본이 충분해지면 새 측정값을 이 기기 환경(카메라·조명·이용자층)의 분포에
 * 비추어 z-점수 기반으로 보정한다. 영상이나 개인 식별 정보는 저장하지 않는다.
 */

interface RunningStat {
  mean: number;
  m2: number; // 분산 계산용 제곱합 (Welford)
}

interface CalibrationStats {
  count: number;
  stress: RunningStat;
  emotions: Record<keyof EmotionScores, RunningStat>;
}

const STORAGE_KEY = 'mc-population-stats-v1';
const MIN_SAMPLES = 15; // 이보다 표본이 적으면 보정하지 않음
const MIN_STD = 5; // 분산이 너무 작을 때의 과보정 방지

const emptyStat = (): RunningStat => ({ mean: 0, m2: 0 });

const emptyStats = (): CalibrationStats => ({
  count: 0,
  stress: emptyStat(),
  emotions: {
    happy: emptyStat(),
    sad: emptyStat(),
    angry: emptyStat(),
    surprised: emptyStat(),
    neutral: emptyStat(),
    disgusted: emptyStat(),
    fearful: emptyStat(),
  },
});

const updateStat = (stat: RunningStat, count: number, value: number): void => {
  const delta = value - stat.mean;
  stat.mean += delta / count;
  stat.m2 += delta * (value - stat.mean);
};

const stdOf = (stat: RunningStat, count: number): number =>
  count > 1 ? Math.sqrt(stat.m2 / (count - 1)) : 0;

class PopulationCalibrationService {
  private stats: CalibrationStats;

  constructor() {
    this.stats = this.load();
  }

  private load(): CalibrationStats {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CalibrationStats;
        if (typeof parsed.count === 'number' && parsed.stress && parsed.emotions) {
          return parsed;
        }
      }
    } catch {
      // localStorage 접근 불가(시크릿 모드 등) — 메모리에서만 동작
    }
    return emptyStats();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats));
    } catch {
      // 저장 실패해도 세션 내 메모리 통계로는 계속 동작
    }
  }

  // 분석 1회 완료마다 호출 — 보정 전 원점수로 기록해야 분포가 오염되지 않음
  record(scores: EmotionScores, rawStressIndex: number): void {
    this.stats.count += 1;
    updateStat(this.stats.stress, this.stats.count, rawStressIndex);
    (Object.keys(this.stats.emotions) as Array<keyof EmotionScores>).forEach(
      (key) => updateStat(this.stats.emotions[key], this.stats.count, scores[key])
    );
    this.save();
  }

  /**
   * 누적 분포에 비춘 스트레스 지수 보정.
   * 표본이 적으면 원점수 그대로, 쌓일수록 분포 보정 비중이 커진다(최대 60%).
   */
  calibrateStress(rawIndex: number): number {
    const { count, stress } = this.stats;
    if (count < MIN_SAMPLES) return rawIndex;

    const std = Math.max(stdOf(stress, count), MIN_STD);
    const z = (rawIndex - stress.mean) / std;
    const relative = Math.min(100, Math.max(0, 50 + z * 20));

    const weight = Math.min(0.6, count / 100);
    return rawIndex * (1 - weight) + relative * weight;
  }

  getCount(): number {
    return this.stats.count;
  }
}

export const populationCalibration = new PopulationCalibrationService();
