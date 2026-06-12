import { useState, useRef, useEffect } from 'react';
import type { AnalysisStatus, AnalysisSummary, EmotionScores } from '../types/index';
import { faceDetectionService } from '../services/faceDetection';
import { emotionAnalysisService } from '../services/emotionAnalysis';
import Results from './Results';
import '../styles/StressAnalyzer.css';

const ANALYSIS_DURATION = 5; // 분석 시간 (초)
const DETECTION_INTERVAL = 100; // 얼굴 감지 주기 (ms)

const EMOTION_LABELS: Record<string, string> = {
  happy: '행복한 표정',
  sad: '슬픈 표정',
  angry: '화난 표정',
  surprised: '놀란 표정',
  neutral: '평온한 표정',
  disgusted: '불쾌한 표정',
};

export default function StressAnalyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const detectLoopRef = useRef<NodeJS.Timeout | null>(null);
  const runningRef = useRef(false);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [modelReady, setModelReady] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(ANALYSIS_DURATION);
  const [result, setResult] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 페이지 진입 시 모델을 미리 로드 + 워밍업 (분석 시작이 즉시 가능하도록)
  useEffect(() => {
    let cancelled = false;
    faceDetectionService
      .loadModel()
      .then(() => {
        if (!cancelled) setModelReady(true);
      })
      .catch((err) => {
        console.error('Model preload error:', err);
        if (!cancelled) {
          setError('분석 모델을 불러오지 못했습니다. 네트워크 연결을 확인해주세요.');
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
      faceDetectionService.unbind();
    };
  }, []);

  const startAnalysis = async () => {
    try {
      setError(null);
      setStatus('detecting');
      setTimeRemaining(ANALYSIS_DURATION);

      // 1. 웹캠 접근 (카메라만 사용)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // 2. 얼굴 감지 바인딩 (모델은 이미 로드되어 있음)
      if (videoRef.current && canvasRef.current) {
        await faceDetectionService.bind(videoRef.current, canvasRef.current);
      }

      const emotionScoresCollected: EmotionScores[] = [];
      let analysisStarted = false;
      let finished = false;
      runningRef.current = true;

      // 분석 완료 처리
      const finishAnalysis = async () => {
        if (finished) return;
        finished = true;
        runningRef.current = false;
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        if (detectLoopRef.current) {
          clearTimeout(detectLoopRef.current);
        }

        try {
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

          // 표정만으로 스트레스 지수 계산
          const stressIndex = emotionAnalysisService.calculateStressFromFace(
            averageEmotionScores
          );

          // 주요 감정 결정
          const primaryEmotion = faceDetectionService.getPrimaryEmotion(averageEmotionScores);

          // 권장사항
          const recommendation = emotionAnalysisService.getRecommendation(
            stressIndex,
            primaryEmotion
          );

          // 결과 저장
          const summary: AnalysisSummary = {
            primaryEmotion,
            stressLevel:
              stressIndex < 33 ? 'low' : stressIndex < 66 ? 'medium' : 'high',
            stressIndex: Math.round(stressIndex),
            keyword: EMOTION_LABELS[primaryEmotion] || primaryEmotion,
            recommendation,
            analyzedTime: ANALYSIS_DURATION,
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
      };

      // 얼굴 감지 루프: 랜드마크를 실시간으로 그리고, 얼굴이 인식되면 바로 분석 시작
      const detectLoop = async () => {
        if (!runningRef.current) return;

        try {
          const scores = await faceDetectionService.detectFaceAndEmotion();
          if (scores) {
            if (!analysisStarted) {
              analysisStarted = true;
              setStatus('analyzing');

              // 벽시계 기준 카운트다운: 얼굴 인식 시점부터 정확히 ANALYSIS_DURATION초
              const startTs = performance.now();
              timerRef.current = setInterval(() => {
                const elapsed = (performance.now() - startTs) / 1000;
                setTimeRemaining(Math.max(0, Math.ceil(ANALYSIS_DURATION - elapsed)));
                if (elapsed >= ANALYSIS_DURATION) {
                  finishAnalysis();
                }
              }, 250);
            }
            emotionScoresCollected.push(scores);
          }
        } catch (err) {
          console.error('Face detection error:', err);
        }

        if (runningRef.current) {
          detectLoopRef.current = setTimeout(detectLoop, DETECTION_INTERVAL);
        }
      };
      detectLoop();
    } catch (err) {
      console.error('Start analysis error:', err);
      setError('분석을 시작할 수 없습니다. 웹캠과 마이크 접근 권한을 확인해주세요.');
      setStatus('error');
    }
  };

  const stopAnalysis = () => {
    runningRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    setStatus('idle');
    setTimeRemaining(ANALYSIS_DURATION);
  };

  const resetAnalysis = () => {
    setStatus('idle');
    setResult(null);
    setError(null);
    setTimeRemaining(ANALYSIS_DURATION);

    // 모델 로드가 실패했던 경우 재시도
    if (!modelReady) {
      faceDetectionService
        .loadModel()
        .then(() => setModelReady(true))
        .catch((err) => {
          console.error('Model preload error:', err);
          setError('분석 모델을 불러오지 못했습니다. 네트워크 연결을 확인해주세요.');
          setStatus('error');
        });
    }
  };

  if (result && status === 'completed') {
    return <Results result={result} onReset={resetAnalysis} />;
  }

  return (
    <div className="stress-analyzer">
      <div className="container">
        <h1>🧠 마음건강 스트레스 분석</h1>
        <p className="subtitle">
          {ANALYSIS_DURATION}초간의 자동 분석으로 당신의 스트레스 지수를 알아보세요
        </p>

        {status === 'idle' && (
          <div className="idle-state">
            <div className="instruction">
              <p>📹 웹캠으로 표정을 분석합니다</p>
              <p>⏱️ 얼굴이 인식되면 바로 {ANALYSIS_DURATION}초 동안 분석합니다</p>
            </div>
            {error && <div className="error-message">{error}</div>}
            <button
              className="start-button"
              onClick={startAnalysis}
              disabled={!modelReady}
            >
              {modelReady ? '분석 시작' : '모델 준비 중...'}
            </button>
          </div>
        )}

        {(status === 'detecting' || status === 'analyzing') && (
          <div className="analyzing-state">
            <div
              style={{
                position: 'relative',
                display: 'inline-block',
                transform: 'scaleX(-1)', // 거울 모드: 비디오와 랜드마크 캔버스를 함께 반전
              }}
            >
              <video
                ref={videoRef}
                className="video-feed"
                autoPlay
                playsInline
                muted
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                }}
              />
            </div>
            {status === 'detecting' ? (
              <div className="analyzing-text">
                얼굴을 인식하는 중입니다... 카메라를 바라봐주세요
              </div>
            ) : (
              <>
                <div className="timer">
                  <div className="timer-display">{timeRemaining}</div>
                  <p>초</p>
                </div>
                <div className="analyzing-text">분석 중입니다...</div>
              </>
            )}
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
