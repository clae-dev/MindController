import type { EmotionScores } from '../types/index';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

interface Point {
  x: number;
  y: number;
}

export class FaceDetectionService {
  private landmarker: FaceLandmarker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private isInitialized = false;
  private modelLoadPromise: Promise<void> | null = null;

  // 모델 다운로드 + 초기화를 미리 수행 (멱등 — 여러 번 호출해도 1회만 로드)
  loadModel(): Promise<void> {
    if (!this.modelLoadPromise) {
      this.modelLoadPromise = this.doLoadModel().catch((error) => {
        this.modelLoadPromise = null; // 실패 시 재시도 가능하도록 리셋
        throw error;
      });
    }
    return this.modelLoadPromise;
  }

  private async doLoadModel(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

    try {
      this.landmarker = await this.createLandmarker(fileset, 'GPU');
    } catch (error) {
      console.warn('GPU delegate failed, falling back to CPU:', error);
      this.landmarker = await this.createLandmarker(fileset, 'CPU');
    }

    await this.warmup();
    console.log('Face landmarker loaded and warmed up');
  }

  private createLandmarker(fileset: any, delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: '/models/face_landmarker.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true, // 표정 근육 수치(미소, 찌푸림 등 52종) — 감정 계산에 사용
    });
  }

  // 실제 얼굴 이미지로 추론 1회 실행 → 첫 라이브 감지 지연 제거
  private async warmup(): Promise<void> {
    try {
      const img = new Image();
      img.src = '/warmup-face.jpg';
      await img.decode();

      const result = this.landmarker!.detectForVideo(img, performance.now());
      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        console.warn('Warmup image contained no detectable face; first live detection may be slow');
      }
    } catch (error) {
      console.warn('Face detection warmup failed:', error);
    }
  }

  async bind(videoElement: HTMLVideoElement, canvas?: HTMLCanvasElement): Promise<void> {
    await this.loadModel();
    this.videoElement = videoElement;
    this.canvas = canvas || document.createElement('canvas');
    this.canvasCtx = this.canvas.getContext('2d');
    this.isInitialized = true;
  }

  // 얼굴이 감지되면 감정 점수를, 감지되지 않으면 null을 반환
  async detectFaceAndEmotion(): Promise<EmotionScores | null> {
    if (!this.videoElement || !this.canvas || !this.landmarker || !this.isInitialized) {
      throw new Error('Face detection not initialized');
    }

    const ctx = this.canvasCtx;
    if (!ctx) {
      throw new Error('Cannot get canvas context');
    }

    this.canvas.width = this.videoElement.videoWidth;
    this.canvas.height = this.videoElement.videoHeight;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    try {
      const result = this.landmarker.detectForVideo(this.videoElement, performance.now());
      const normalized = result.faceLandmarks?.[0];

      if (!normalized || normalized.length === 0) {
        return null;
      }

      // 정규화 좌표(0~1) → 픽셀 좌표 변환
      const points: Point[] = normalized.map((p) => ({
        x: p.x * this.canvas!.width,
        y: p.y * this.canvas!.height,
      }));

      this.drawLandmarks(ctx, points);

      // 블렌드셰이프(표정 근육 수치) 기반 계산 — 랜드마크 거리 추정보다 훨씬 정확
      const blendshapes = result.faceBlendshapes?.[0]?.categories;
      if (blendshapes && blendshapes.length > 0) {
        return this.calculateEmotionFromBlendshapes(blendshapes);
      }
      return this.calculateEmotionFromLandmarks(points);
    } catch (error) {
      console.error('Face detection error:', error);
      throw error;
    }
  }

  private drawLandmarks(ctx: CanvasRenderingContext2D, landmarks: Point[]): void {
    // 점 그리기
    ctx.fillStyle = '#00FF00';
    for (const landmark of landmarks) {
      ctx.beginPath();
      ctx.arc(landmark.x, landmark.y, 2, 0, 2 * Math.PI);
      ctx.fill();
    }

    // 주요 얼굴 특징 연결 (Face Mesh)
    const connections = [
      // 얼굴 윤곽
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
      [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 0],
      // 왼쪽 눈
      [33, 246], [246, 161], [161, 160], [160, 159], [159, 158], [158, 157], [157, 173], [173, 133],
      // 오른쪽 눈
      [263, 466], [466, 388], [388, 387], [387, 386], [386, 385], [385, 384], [384, 398], [398, 362],
      // 입
      [61, 185], [185, 40], [40, 39], [39, 37], [37, 0], [0, 267], [267, 269], [269, 270],
      [270, 409], [409, 291], [291, 375], [375, 321], [321, 405], [405, 314], [314, 17], [17, 84],
      [84, 181], [181, 91], [91, 106],
    ];

    // 선 그리기
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 1;
    for (const connection of connections) {
      const start = landmarks[connection[0]];
      const end = landmarks[connection[1]];
      if (start && end) {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }
  }

  // ARKit 스타일 블렌드셰이프(0~1) 조합으로 7종 감정 점수(0~100) 산출
  private calculateEmotionFromBlendshapes(
    categories: Array<{ categoryName: string; score: number }>
  ): EmotionScores {
    const shape = new Map<string, number>();
    for (const c of categories) shape.set(c.categoryName, c.score);
    const s = (name: string) => shape.get(name) ?? 0;
    const pair = (base: string) => (s(`${base}Left`) + s(`${base}Right`)) / 2;
    const clamp = (v: number) => Math.min(100, Math.max(0, v));

    const smile = pair('mouthSmile');
    const cheekSquint = pair('cheekSquint');
    const frown = pair('mouthFrown');
    const browInnerUp = s('browInnerUp');
    const browDown = pair('browDown');
    const eyeSquint = pair('eyeSquint');
    const mouthPress = pair('mouthPress');
    const eyeWide = pair('eyeWide');
    const browOuterUp = pair('browOuterUp');
    const jawOpen = s('jawOpen');
    const noseSneer = pair('noseSneer');
    const upperLipRaise = pair('mouthUpperUp');
    const mouthStretch = pair('mouthStretch');

    const happy = clamp((smile * 1.2 + cheekSquint * 0.4) * 100);
    const sad = clamp((frown * 0.9 + browInnerUp * 0.5) * 100);
    const angry = clamp((browDown * 1.0 + eyeSquint * 0.4 + mouthPress * 0.5) * 100);
    const surprised = clamp((eyeWide * 0.7 + browOuterUp * 0.6 + jawOpen * 0.5) * 100);
    const disgusted = clamp((noseSneer * 1.2 + upperLipRaise * 0.6) * 100);
    const fearful = clamp((eyeWide * 0.4 + browInnerUp * 0.4 + mouthStretch * 0.7) * 100);

    const scores: EmotionScores = {
      happy,
      sad,
      angry,
      surprised,
      neutral: 0,
      disgusted,
      fearful,
    };
    const total = happy + sad + angry + surprised + disgusted + fearful;
    scores.neutral = clamp(100 - total);
    return scores;
  }

  // 블렌드셰이프가 없을 때의 폴백: 랜드마크 거리 기반 단순 추정
  private calculateEmotionFromLandmarks(landmarks: Point[]): EmotionScores {
    // 주요 랜드마크 인덱스
    const leftEye = landmarks[33]; // 왼쪽 눈 바깥쪽
    const rightEye = landmarks[263]; // 오른쪽 눈 바깥쪽
    const leftMouth = landmarks[61]; // 입 왼쪽
    const rightMouth = landmarks[291]; // 입 오른쪽
    const mouthTop = landmarks[13]; // 입 위쪽
    const mouthBottom = landmarks[14]; // 입 아래쪽

    if (!leftEye || !rightEye || !leftMouth || !rightMouth || !mouthTop || !mouthBottom) {
      return {
        happy: 0,
        sad: 0,
        angry: 0,
        surprised: 0,
        neutral: 100,
        disgusted: 0,
        fearful: 0,
      };
    }

    // 입의 높이 계산 (미소 감지)
    const mouthHeight = Math.abs(mouthBottom.y - mouthTop.y);

    // 눈의 높이 계산 (놀람 감지)
    const eyeDistance = Math.abs(rightEye.y - leftEye.y);

    // 표정 점수 계산
    const happy = Math.min(100, mouthHeight > 15 ? mouthHeight * 3 : 0);
    const surprised = Math.min(100, eyeDistance > 30 ? (eyeDistance - 20) * 2 : 0);
    const sad = Math.min(100, mouthHeight < 5 ? 50 : 0);
    const angry = 0; // 간단한 구현에서는 계산 어려움
    const disgusted = 0; // 간단한 구현에서는 계산 어려움

    const emotionScores: EmotionScores = {
      happy,
      sad,
      angry,
      surprised,
      neutral: 0,
      disgusted,
      fearful: 0,
    };

    // 합계가 0이면 중립으로 설정
    const total = Object.values(emotionScores).reduce((a, b) => a + b, 0);
    if (total === 0) {
      emotionScores.neutral = 100;
    } else {
      emotionScores.neutral = Math.max(0, 100 - total);
    }

    return emotionScores;
  }

  getPrimaryEmotion(scores: EmotionScores): string {
    const entries = Object.entries(scores);
    const [emotion] = entries.reduce((max, current) =>
      current[1] > max[1] ? current : max
    );
    return emotion;
  }

  // 비디오/캔버스 바인딩만 해제 — 로드된 모델은 유지 (재마운트 시 재다운로드 방지)
  unbind(): void {
    this.canvas = null;
    this.canvasCtx = null;
    this.videoElement = null;
    this.isInitialized = false;
  }
}

export const faceDetectionService = new FaceDetectionService();
