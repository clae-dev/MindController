import { useState, useRef, useEffect } from 'react';
import type { AnalysisStatus, AnalysisSummary, EmotionScores } from '../types/index';
import { faceDetectionService } from '../services/faceDetection';
import { speechRecognitionService } from '../services/speechRecognition';
import { emotionAnalysisService } from '../services/emotionAnalysis';
import Results from './Results';
import '../styles/StressAnalyzer.css';

const ANALYSIS_DURATION = 60000; // 1분 (60초)

export default function StressAnalyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [timeRemaining, setTimeRemaining] = useState<number>(60);
  const [result, setResult] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      faceDetectionService.destroy();
      speechRecognitionService.destroy();
    };
  }, []);

  const startAnalysis = async () => {
    try {
      setError(null);
      setStatus('analyzing');
      setTimeRemaining(60);

      // 1. 웹캠 접근
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // 2. 얼굴 감지 초기화
      if (videoRef.current) {
        await faceDetectionService.initialize(videoRef.current);
      }

      // 3. 음성 인식 시작
      let transcript = '';
      await speechRecognitionService.startListening((current) => {
        transcript = current;
      });

      // 4. 60초 동안 분석
      let emotionScoresCollected: EmotionScores[] = [];

      timerRef.current = setInterval(async () => {
        setTimeRemaining(prev => Math.max(0, prev - 1));

        // 1초마다 얼굴 감정 수집
        try {
          const scores = await faceDetectionService.detectFaceAndEmotion();
          emotionScoresCollected.push(scores);
        } catch (err) {
          console.error('Face detection error:', err);
        }
      }, 1000);

      // 60초 후 분석 완료
      setTimeout(async () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }

        try {
          // 5. 수집된 데이터 분석
          const finalTranscript = speechRecognitionService.stopListening();
          const voiceTone = await speechRecognitionService.analyzeVoiceTone();

          // 감정 점수 평균 계산
          const averageEmotionScores: EmotionScores = {
            happy: 0,
            sad: 0,
            angry: 0,
            surprised: 0,
            neutral: 0,
            disgusted: 0,
          };

          if (emotionScoresCollected.length > 0) {
            (Object.keys(averageEmotionScores) as Array<keyof EmotionScores>).forEach((emotion) => {
              const sum = emotionScoresCollected.reduce((acc, scores) => acc + scores[emotion], 0);
              averageEmotionScores[emotion] = sum / emotionScoresCollected.length;
            });
          }

          // 6. 텍스트 감정 분석
          const emotionAnalysis = await emotionAnalysisService.analyzeEmotionFromText(
            finalTranscript
          );

          // 7. 최종 스트레스 지수 계산
          const stressIndex = emotionAnalysisService.calculateStressFromAnalysis(
            averageEmotionScores,
            voiceTone,
            { emotion: emotionAnalysis.emotion, confidence: emotionAnalysis.confidence }
          );

          // 8. 주요 감정 결정
          const primaryEmotion = faceDetectionService.getPrimaryEmotion(averageEmotionScores);

          // 9. 권장사항
          const recommendation = emotionAnalysisService.getRecommendation(
            stressIndex,
            primaryEmotion
          );

          // 10. 결과 저장
          const summary: AnalysisSummary = {
            primaryEmotion,
            stressLevel:
              stressIndex < 33 ? 'low' : stressIndex < 66 ? 'medium' : 'high',
            stressIndex: Math.round(stressIndex),
            keyword: emotionAnalysis.keyword,
            recommendation,
            analyzedTime: 60,
          };

          setResult(summary);
          setStatus('completed');

          // 스트림 종료
          stream.getTracks().forEach((track) => track.stop());
        } catch (err) {
          console.error('Analysis error:', err);
          setError('분석 중 오류가 발생했습니다.');
          setStatus('error');
        }
      }, ANALYSIS_DURATION);
    } catch (err) {
      console.error('Start analysis error:', err);
      setError('분석을 시작할 수 없습니다. 웹캠과 마이크 접근 권한을 확인해주세요.');
      setStatus('error');
    }
  };

  const stopAnalysis = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    speechRecognitionService.stopListening();
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    setStatus('idle');
    setTimeRemaining(60);
  };

  const resetAnalysis = () => {
    setStatus('idle');
    setResult(null);
    setError(null);
    setTimeRemaining(60);
  };

  if (result && status === 'completed') {
    return <Results result={result} onReset={resetAnalysis} />;
  }

  return (
    <div className="stress-analyzer">
      <div className="container">
        <h1>🧠 마음건강 스트레스 분석</h1>
        <p className="subtitle">1분간의 자동 분석으로 당신의 스트레스 지수를 알아보세요</p>

        {status === 'idle' && (
          <div className="idle-state">
            <div className="instruction">
              <p>📹 웹캠으로 표정을 분석합니다</p>
              <p>🎤 마이크로 음성을 분석합니다</p>
              <p>⏱️ 총 1분 동안 진행됩니다</p>
            </div>
            {error && <div className="error-message">{error}</div>}
            <button className="start-button" onClick={startAnalysis}>
              분석 시작
            </button>
          </div>
        )}

        {status === 'analyzing' && (
          <div className="analyzing-state">
            <video
              ref={videoRef}
              className="video-feed"
              autoPlay
              playsInline
              muted
            />
            <div className="timer">
              <div className="timer-display">{timeRemaining}</div>
              <p>초</p>
            </div>
            <div className="analyzing-text">분석 중입니다...</div>
            <button className="stop-button" onClick={stopAnalysis}>
              중지
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="error-state">
            <p className="error-message">{error}</p>
            <button className="start-button" onClick={resetAnalysis}>
              다시 시도
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
