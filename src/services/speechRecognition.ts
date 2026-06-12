import type { VoiceTone } from '../types/index';

declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

export class SpeechRecognitionService {
  private recognition: any = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private ownsStream = false;
  private transcript = '';
  private isListening = false;

  constructor() {
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.setupRecognition();
      }
    } catch (error) {
      console.warn('Speech Recognition initialization failed:', error);
    }
  }

  private setupRecognition(): void {
    if (!this.recognition) return;

    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'ko-KR'; // 한국어 설정
  }

  async startListening(
    onResultCallback?: (transcript: string) => void,
    stream?: MediaStream
  ): Promise<void> {
    try {
      if (stream) {
        // 외부에서 받은 스트림 재사용 (권한 프롬프트 중복 방지) — 소유권은 호출자에게
        this.mediaStream = stream;
        this.ownsStream = false;
      } else {
        // 마이크 접근 요청
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.ownsStream = true;
      }

      // Audio Context 설정
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      this.transcript = '';
      this.isListening = true;

      if (this.recognition) {
        this.recognition.onresult = (event: any) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              this.transcript += transcript + ' ';
            } else {
              interim += transcript;
            }
          }
          if (onResultCallback) {
            onResultCallback(this.transcript + interim);
          }
        };

        this.recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
        };

        this.recognition.start();
      } else {
        console.warn('Speech Recognition API is not available');
      }
    } catch (error) {
      console.error('Failed to start listening:', error);
      throw error;
    }
  }

  stopListening(): string {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        console.warn('Error stopping recognition:', error);
      }
    }
    this.isListening = false;
    return this.transcript;
  }

  async analyzeVoiceTone(): Promise<VoiceTone> {
    if (!this.analyser || !this.audioContext) {
      throw new Error('Audio context not initialized');
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    // 주파수 분석 (피치 추정)
    const pitch = this.estimatePitch(dataArray);
    const volume = this.calculateVolume(dataArray);

    // 음성 속도는 transcript 길이와 시간으로 추정
    const speed = this.transcript.split(' ').length / (this.transcript.length > 0 ? this.transcript.length : 1);

    // 스트레스 지수 계산 (피치와 음량 기반)
    const stressLevel = this.calculateStressLevel(pitch, volume);

    return {
      pitch,
      speed,
      volume,
      stressLevel,
    };
  }

  private estimatePitch(dataArray: Uint8Array): number {
    // 간단한 피치 추정: 높은 주파수 비율
    const high = dataArray.slice(dataArray.length / 2).reduce((a, b) => a + b, 0);
    const low = dataArray.slice(0, dataArray.length / 2).reduce((a, b) => a + b, 0);
    return (high / (high + low)) * 100;
  }

  private calculateVolume(dataArray: Uint8Array): number {
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    return Math.min(average, 100);
  }

  private calculateStressLevel(pitch: number, volume: number): number {
    // 높은 피치와 높은 음량이 스트레스를 나타냄
    return (pitch * 0.4 + volume * 0.6);
  }

  getTranscript(): string {
    return this.transcript;
  }

  destroy(): void {
    if (this.mediaStream && this.ownsStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    if (this.recognition) {
      this.recognition.stop();
    }
  }
}

export const speechRecognitionService = new SpeechRecognitionService();
