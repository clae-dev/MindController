export interface EmotionScores {
  happy: number;
  sad: number;
  angry: number;
  surprised: number;
  neutral: number;
  disgusted: number;
}

export interface VoiceTone {
  pitch: number;
  speed: number;
  volume: number;
  stressLevel: number;
}

export type AnalysisStatus = 'idle' | 'detecting' | 'analyzing' | 'completed' | 'error';

export interface AnalysisSummary {
  primaryEmotion: string;
  stressLevel: 'low' | 'medium' | 'high';
  stressIndex: number;
  keyword: string;
  recommendation: string;
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
