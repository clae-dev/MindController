import type { EmotionScores } from '../types/index';

// 감정 매핑
const EMOTIONS = ['angry', 'disgusted', 'afraid', 'happy', 'neutral', 'sad', 'surprised'];

export class FaceDetectionService {
  private model: any = null;
  private canvas: HTMLCanvasElement | null = null;
  private videoElement: HTMLVideoElement | null = null;

  async initialize(videoElement: HTMLVideoElement): Promise<void> {
    this.videoElement = videoElement;
    this.canvas = document.createElement('canvas');

    try {
      // MediaPipe 또는 간단한 얼굴 감지 초기화
      // 실제 구현에서는 더 복잡한 모델 사용
      console.log('Face detection initialized');
    } catch (error) {
      console.error('Failed to initialize face detection:', error);
      throw error;
    }
  }

  async detectFaceAndEmotion(): Promise<EmotionScores> {
    if (!this.videoElement || !this.canvas) {
      throw new Error('Face detection not initialized');
    }

    // 캔버스에 비디오 프레임 그리기
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Cannot get canvas context');
    }

    this.canvas.width = this.videoElement.videoWidth;
    this.canvas.height = this.videoElement.videoHeight;
    ctx.drawImage(this.videoElement, 0, 0);

    // 임시: 랜덤 감정 점수 생성 (실제로는 ML 모델 사용)
    // 실제 구현에서는 MediaPipe FaceDetection + TensorFlow.js 감정 분류 사용
    const emotionScores: EmotionScores = {
      happy: Math.random() * 100,
      sad: Math.random() * 100,
      angry: Math.random() * 100,
      surprised: Math.random() * 100,
      neutral: Math.random() * 100,
      disgusted: Math.random() * 100,
    };

    return emotionScores;
  }

  getPrimaryEmotion(scores: EmotionScores): string {
    const entries = Object.entries(scores);
    const [emotion] = entries.reduce((max, current) =>
      current[1] > max[1] ? current : max
    );
    return emotion;
  }

  destroy(): void {
    this.model = null;
    this.canvas = null;
    this.videoElement = null;
  }
}

export const faceDetectionService = new FaceDetectionService();
