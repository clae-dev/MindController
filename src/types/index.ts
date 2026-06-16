export interface EmotionScores {
  happy: number;
  sad: number;
  angry: number;
  surprised: number;
  neutral: number;
  disgusted: number;
  fearful: number;
}

export interface VoiceTone {
  pitch: number;
  speed: number;
  volume: number;
  stressLevel: number;
}

export type AnalysisStatus = 'idle' | 'detecting' | 'analyzing' | 'completed' | 'error';

export interface Quote {
  text: string;
  author: string;
}

export interface AnalysisSummary {
  primaryEmotion: string;
  stressLevel: 'low' | 'medium' | 'high';
  stressIndex: number;
  keyword: string; // 강도까지 반영한 표정 묘사 (예: '잔잔한 미소가 머무는 얼굴')
  emotionDetail: string; // 보조 감정 설명 (예: '놀람의 기색도 살짝 함께 보였어요')
  emotionScores: EmotionScores; // 감정 분포 차트용 평균 점수
  recommendation: string;
  quote: Quote;
  analyzedTime: number;
  calibrationCount: number; // 이 기기에 누적된 측정 횟수 (분포 보정 표본)
  heartRate?: { bpm: number; label: string }; // rPPG 심박 추정 (신뢰도 충분 시에만)
}

export interface AnalysisResult {
  timestamp: Date;
  emotionScore: EmotionScores;
  stressIndex: number;
  voiceTone: VoiceTone;
  emotionKeyword: string;
  recommendation: string;
}

// 한 프레임에서 추출한 풍부한 얼굴 신호 (긴장 감지 · 웃음 판별용)
export interface FaceFrame {
  emotions: EmotionScores;
  // 긴장 관련 블렌드셰이프 (0~1)
  browDown: number; // 눈썹 내림
  mouthPress: number; // 입술 압박
  noseSneer: number; // 콧잔등 찡그림
  eyeSquint: number; // 눈 가늘게
  mouthStretch: number; // 입 옆으로 당김
  // 웃음 진위 판별 (Duchenne)
  smile: number; // 입꼬리 미소
  cheekSquint: number; // 눈가 근육(진짜 웃음 지표)
  // 깜빡임
  blink: number; // 눈 감김 정도
  // 시선/머리 위치 (정규화 코끝 좌표, 0~1)
  gazeX: number;
  gazeY: number;
  // 직전 프레임 대비 코끝 이동량(정규화) — 움직임 게이팅용
  headMotion: number;
}

// 긴장 지수 성분별 기여도 (0~1, baseline 대비 정규화된 편차)
export interface TensionBreakdown {
  facial: number; // 표정 긴장
  instability: number; // 미세표정 불안정성
  blink: number; // 깜빡임 변화
  gaze: number; // 시선/머리 흔들림
  heart: number; // 심박 상승
}

// 긴장 감지 종합 결과
export interface TensionSummary {
  peak: number; // 최고 긴장 지수 (0~100)
  average: number; // 평균 긴장 지수 (0~100)
  band: 'calm' | 'mild' | 'tense'; // 판정 밴드
  topSignal: keyof TensionBreakdown; // 가장 크게 기여한 신호
  confidence: number; // 측정 신뢰도 (0~1)
  durationSec: number; // 측정 시간
}

// 질문 챌린지: 질문 한 개에 대한 긴장 반응
export interface QuestionResult {
  question: string;
  peak: number; // 해당 질문 구간의 최고 긴장 (0~100)
  average: number; // 평균 긴장 (0~100)
}

// 억지웃음 판별 결과
export interface SmileResult {
  authenticity: number; // 0~100 (진짜 웃음일수록 높음)
  verdict: 'genuine' | 'forced' | 'faint'; // 진짜 / 억지 / 미소 약함
  smile: number; // peak 구간 평균 미소 강도 (0~1)
  cheekSquint: number; // 동반된 볼 근육 (0~1, 보고용)
  eyeEngage: number; // peak 구간 평균 눈가 engagement (0~1)
  baseEye?: number; // 측정된 중립 baseline 눈가 engagement (있으면)
  lowConfidence?: boolean; // 모션으로 대부분 프레임이 버려졌을 때
}
