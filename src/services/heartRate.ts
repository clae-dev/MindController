/**
 * rPPG 심박수 추정 — 웹캠만으로 이마 피부의 미세한 색 변화(맥동)를 모아
 * 주파수 분석으로 BPM을 추정한다. 의료기기 수준이 아니며 조명·움직임에 민감하다.
 */

interface Sample {
  value: number; // 이마 ROI 평균 녹색값
  t: number; // performance.now() 타임스탬프(ms)
}

const MIN_DURATION_MS = 4000; // 이보다 짧으면 추정 불가
const MIN_HZ = 0.7; // 42 bpm
const MAX_HZ = 4.0; // 240 bpm

class HeartRateService {
  private samples: Sample[] = [];

  reset(): void {
    this.samples = [];
  }

  addSample(value: number, t: number): void {
    this.samples.push({ value, t });
  }

  estimate(): { bpm: number; confidence: number } | null {
    const n = this.samples.length;
    if (n < 16) return null;

    const duration = this.samples[n - 1].t - this.samples[0].t;
    if (duration < MIN_DURATION_MS) return null;

    const fs = (n - 1) / (duration / 1000); // 평균 샘플레이트(Hz)
    if (!isFinite(fs) || fs < 2) return null;

    // 1) 선형 추세 제거(detrend) — 조명 드리프트 등 저주파 성분 제거
    const values = this.samples.map((s) => s.value);
    const detrended = this.detrend(values);

    // 2) Hann 윈도우
    const windowed = detrended.map(
      (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
    );

    // 3) 관심 대역에서 직접 DFT 파워 스펙트럼
    const minHz = MIN_HZ;
    const maxHz = Math.min(MAX_HZ, fs / 2);
    const step = 0.02; // ~1.2 bpm 해상도
    let peakHz = 0;
    let peakPower = 0;
    let sumPower = 0;
    let bins = 0;

    for (let f = minHz; f <= maxHz; f += step) {
      let re = 0;
      let im = 0;
      const w = 2 * Math.PI * f;
      for (let i = 0; i < n; i++) {
        const t = i / fs;
        re += windowed[i] * Math.cos(w * t);
        im -= windowed[i] * Math.sin(w * t);
      }
      const power = re * re + im * im;
      sumPower += power;
      bins += 1;
      if (power > peakPower) {
        peakPower = power;
        peakHz = f;
      }
    }

    if (peakHz === 0 || bins === 0) return null;

    // confidence: 피크가 대역 평균 대비 얼마나 우세한가 (SNR 유사)
    const meanPower = sumPower / bins;
    const snr = meanPower > 0 ? peakPower / meanPower : 0;
    const confidence = Math.min(1, Math.max(0, (snr - 3) / 12));

    const bpm = Math.round(peakHz * 60);
    return { bpm, confidence };
  }

  private detrend(values: number[]): number[] {
    const n = values.length;
    // 최소제곱 직선 적합 후 잔차 반환
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += i;
      sy += values[i];
      sxx += i * i;
      sxy += i * values[i];
    }
    const denom = n * sxx - sx * sx;
    const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
    const intercept = (sy - slope * sx) / n;
    return values.map((v, i) => v - (slope * i + intercept));
  }
}

export const heartRateService = new HeartRateService();
