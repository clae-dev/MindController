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
}

export interface AnalysisResult {
  timestamp: Date;
  emotionScore: EmotionScores;
  stressIndex: number;
  voiceTone: VoiceTone;
  emotionKeyword: string;
  recommendation: string;
}
