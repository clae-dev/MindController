import { useState, useRef, useEffect } from 'react';
import type { AnalysisStatus, AnalysisSummary, EmotionScores } from '../types/index';
import { faceDetectionService } from '../services/faceDetection';
import { emotionAnalysisService } from '../services/emotionAnalysis';
import Results from './Results';
import AnimatedEmoji from './AnimatedEmoji';
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

// 모델 로드 실패는 WASM/모델 파일 다운로드 실패 — 개발 중에는 대부분 dev 서버가 꺼진 경우
const modelLoadErrorMessage = (): string =>
  import.meta.env.DEV
    ? '분석 모델을 불러오지 못했습니다. 개발 서버가 실행 중인지 확인한 뒤 페이지를 새로고침해주세요.'
    : '분석 모델을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.';

const startErrorMessage = (err: unknown): string => {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return '웹캠 접근이 차단되었습니다. 브라우저의 카메라 권한을 허용해주세요.';
      case 'NotFoundError':
        return '사용 가능한 웹캠을 찾을 수 없습니다. 카메라 연결을 확인해주세요.';
      case 'NotReadableError':
        return '웹캠을 사용할 수 없습니다. 다른 프로그램이 카메라를 사용 중인지 확인해주세요.';
    }
  }
  // 웹캠 단계가 아니면 모델 로드(WASM/모델 파일 다운로드) 단계의 실패
  return modelLoadErrorMessage();
};

export default function StressAnalyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          setError(modelLoadErrorMessage());
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

      // 1. 웹캠 접근 (카메라만 사용) — 크게 표시되므로 높은 해상도를 우선 요청
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 960 } },
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
          const stressLevel =
            stressIndex < 33 ? 'low' : stressIndex < 66 ? 'medium' : 'high';
          const summary: AnalysisSummary = {
            primaryEmotion,
            stressLevel,
            stressIndex: Math.round(stressIndex),
            keyword: EMOTION_LABELS[primaryEmotion] || primaryEmotion,
            recommendation,
            quote: emotionAnalysisService.getQuote(stressLevel),
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
      setError(startErrorMessage(err));
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
          setError(modelLoadErrorMessage());
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
        <header className="page-header">
          <span className="badge">
            <AnimatedEmoji emoji="🌈" size={18} label="오늘의 날씨" />
            오늘의 마음 날씨
          </span>
          <h1>마음, 잠깐 들여다볼까요?</h1>
          <p className="subtitle">
            카메라 앞에서 {ANALYSIS_DURATION}초면 충분해요.
            <br />
            표정으로 지금의 스트레스를 읽어드릴게요.
          </p>
        </header>

        {status === 'idle' && (
          <div className="card idle-state">
            <div className="hero-emoji">
              <AnimatedEmoji emoji="😌" size={80} label="평온한 얼굴" />
            </div>
            <ul className="steps">
              <li>
                <span className="step-icon">
                  <AnimatedEmoji emoji="📸" size={22} />
                </span>
                카메라를 편안하게 바라봐 주세요
              </li>
              <li>
                <span className="step-icon">
                  <AnimatedEmoji emoji="⏳" size={22} />
                </span>
                얼굴이 보이면 {ANALYSIS_DURATION}초 동안 자동으로 분석해요
              </li>
              <li>
                <span className="step-icon">
                  <AnimatedEmoji emoji="🔒" size={22} />
                </span>
                영상은 저장되지 않고, 기기 안에서만 처리돼요
              </li>
            </ul>
            {error && <div className="error-message">{error}</div>}
            <button
              className="start-button"
              onClick={startAnalysis}
              disabled={!modelReady}
            >
              {modelReady ? (
                <>
                  마음 들여다보기 <AnimatedEmoji emoji="✨" size={20} />
                </>
              ) : (
                '준비하고 있어요…'
              )}
            </button>
            <p className="hint">버튼을 누르면 카메라 사용 권한을 요청해요</p>
          </div>
        )}

        {(status === 'detecting' || status === 'analyzing') && (
          <div className="card analyzing-state">
            <div className="video-frame">
              <video
                ref={videoRef}
                className="video-feed"
                autoPlay
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="landmark-canvas" />
            </div>
            {status === 'detecting' ? (
              <div className="status-line">
                <AnimatedEmoji emoji="👀" size={24} label="두리번" />
                얼굴을 찾고 있어요… 카메라를 바라봐 주세요
              </div>
            ) : (
              <>
                <div className="countdown">
                  <span className="count-num">{timeRemaining}</span>초 남았어요
                </div>
                <div className="status-line">
                  표정을 읽는 중이에요
                  <AnimatedEmoji emoji="🍃" size={22} label="나뭇잎" />
                </div>
              </>
            )}
            <button className="stop-button" onClick={stopAnalysis}>
              그만할래요
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="card error-state">
            <div className="hero-emoji">
              <AnimatedEmoji emoji="🥲" size={72} label="머쓱한 얼굴" />
            </div>
            <p className="error-message">{error}</p>
            <button className="start-button" onClick={resetAnalysis}>
              다시 시도하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
