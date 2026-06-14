/**
 * rPPG 심박수 추정 — 웹캠만으로 피부(이마·볼)의 미세한 색 변화(맥동)를 모아
 * 주파수 분석으로 BPM을 추정한다. 의료기기 수준이 아니며 조명·움직임에 민감하다.
 *
 * 펄스 신호 추출에는 POS(Plane-Orthogonal-to-Skin, Wang et al. 2017)를 사용한다.
 * 녹색 채널만 쓰던 방식보다 R/G/B를 함께 투영해 움직임·조명 잡음에 강하다.
 */

interface Sample {
  r: number; // 피부 ROI 평균 적색값
  g: number; // 평균 녹색값
  b: number; // 평균 청색값
  t: number; // performance.now() 타임스탬프(ms)
}

const MIN_DURATION_MS = 4000; // 이보다 짧으면 추정 불가
const MIN_HZ = 0.7; // 42 bpm
const MAX_HZ = 4.0; // 240 bpm
const POS_WINDOW_SEC = 1.6; // POS 슬라이딩 윈도 길이(초)

class HeartRateService {
  private samples: Sample[] = [];

  reset(): void {
    this.samples = [];
  }

  addSample(r: number, g: number, b: number, t: number): void {
    this.samples.push({ r, g, b, t });
  }

  estimate(): { bpm: number; confidence: number } | null {
    const n = this.samples.length;
    if (n < 16) return null;

    const duration = this.samples[n - 1].t - this.samples[0].t;
    if (duration < MIN_DURATION_MS) return null;

    const fs = (n - 1) / (duration / 1000); // 평균 샘플레이트(Hz)
    if (!isFinite(fs) || fs < 2) return null;

    // 1) POS로 펄스 신호 추출 (R/G/B 투영 + overlap-add)
    const pulse = this.pos(fs);

    // 2) 선형 추세 제거(detrend) — 조명 드리프트 등 저주파 성분 제거
    const detrended = this.detrend(pulse);

    // 3) Hann 윈도우
    const windowed = detrended.map(
      (v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
    );

    // 4) 관심 대역에서 직접 DFT 파워 스펙트럼
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

  // POS(Plane-Orthogonal-to-Skin): 슬라이딩 윈도마다 채널 정규화 후
  // P=[[0,1,-1],[-2,1,1]] 투영을 합쳐 펄스 신호를 overlap-add로 누적
  private pos(fs: number): number[] {
    const n = this.samples.length;
    const H = new Array<number>(n).fill(0);
    const l = Math.max(8, Math.round(POS_WINDOW_SEC * fs)); // 윈도 길이(샘플)
    if (n < l) {
      // 윈도보다 짧으면 정규화만 적용한 녹색 신호로 폴백
      const meanG = this.samples.reduce((a, s) => a + s.g, 0) / n;
      return this.samples.map((s) => (meanG > 0 ? s.g / meanG - 1 : 0));
    }

    for (let m = 0; m + l <= n; m++) {
      // 채널별 윈도 평균
      let mr = 0;
      let mg = 0;
      let mb = 0;
      for (let i = 0; i < l; i++) {
        const s = this.samples[m + i];
        mr += s.r;
        mg += s.g;
        mb += s.b;
      }
      mr /= l;
      mg /= l;
      mb /= l;
      if (mr <= 0 || mg <= 0 || mb <= 0) continue;

      // 시간 정규화 후 투영 → S1, S2
      const s1 = new Array<number>(l);
      const s2 = new Array<number>(l);
      for (let i = 0; i < l; i++) {
        const s = this.samples[m + i];
        const rn = s.r / mr;
        const gn = s.g / mg;
        const bn = s.b / mb;
        s1[i] = gn - bn; // [0, 1, -1]
        s2[i] = -2 * rn + gn + bn; // [-2, 1, 1]
      }

      // alpha = std(S1)/std(S2) 로 두 투영을 결합
      const std1 = std(s1);
      const std2 = std(s2);
      const alpha = std2 > 0 ? std1 / std2 : 0;

      // 평균 제거 후 overlap-add
      let hMean = 0;
      const h = new Array<number>(l);
      for (let i = 0; i < l; i++) {
        h[i] = s1[i] + alpha * s2[i];
        hMean += h[i];
      }
      hMean /= l;
      for (let i = 0; i < l; i++) {
        H[m + i] += h[i] - hMean;
      }
    }

    return H;
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

// 표준편차 (POS 결합 계수 계산용)
function std(arr: number[]): number {
  const n = arr.length;
  if (n === 0) return 0;
  const mean = arr.reduce((a, v) => a + v, 0) / n;
  const variance = arr.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(variance);
}

export const heartRateService = new HeartRateService();
