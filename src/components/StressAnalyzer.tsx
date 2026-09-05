import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import type { AnalysisStatus, AnalysisSummary, EmotionScores } from '../types/index';
import { faceDetectionService } from '../services/faceDetection';
import { perfProfile } from '../utils/tvMode';
import { emotionAnalysisService } from '../services/emotionAnalysis';
import { populationCalibration } from '../services/populationCalibration';
import { heartRateService } from '../services/heartRate';
import AnimatedEmoji from './AnimatedEmoji';
import BrandFooter from './BrandFooter';
import MemoryOrbs from './MemoryOrbs';
import EmotionCharacter, { CHARACTER_NAME } from './EmotionCharacter';
import EmotionConsole from './EmotionConsole';
import type { EmotionConsoleHandle } from './EmotionConsole';
import '../styles/StressAnalyzer.css';

// 결과·긴장 화면은 사용자 상호작용 후에야 필요하므로 분리 로드해 첫 진입 번들을 줄임
const Results = lazy(() => import('./Results'));
const TensionDetector = lazy(() => import('./TensionDetector'));

const ANALYSIS_DURATION = 10; // 분석 시간 (초) — 심박 추정을 위해 10초
const DETECTION_INTERVAL = perfProfile.detectionIntervalMs; // 얼굴 감지 목표 주기 (ms) — 프로파일(TV 모드)에 따름

// 추정 심박수에 따른 상태 라벨
const heartRateLabel = (bpm: number): string => {
  if (bpm < 70) return '아주 안정적이에요';
  if (bpm < 90) return '편안한 상태예요';
  if (bpm < 105) return '살짝 긴장했어요';
  return '많이 두근거려요';
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
  const consoleRef = useRef<EmotionConsoleHandle>(null);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [appMode, setAppMode] = useState<'mind' | 'tension'>('mind');
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
      heartRateService.reset();

      // 1. 웹캠 접근 (카메라만 사용) — 표시는 CSS로 확대하고, 캡처는 추론·캔버스 비용을
      //    줄이려 낮춤. 얼굴 랜드마크는 내부적으로 더 낮은 해상도로 처리돼 정확도 영향 거의 없음
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: perfProfile.captureWidth },
          height: { ideal: perfProfile.captureHeight },
        },
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
            fearful: 0,
          };

          if (emotionScoresCollected.length > 0) {
            (Object.keys(averageEmotionScores) as Array<keyof EmotionScores>).forEach((emotion) => {
              const sum = emotionScoresCollected.reduce((acc, scores) => acc + scores[emotion], 0);
              averageEmotionScores[emotion] = sum / emotionScoresCollected.length;
            });
          }

          // 표정만으로 스트레스 지수 계산
          const rawStressIndex = emotionAnalysisService.calculateStressFromFace(
            averageEmotionScores
          );

          // 분포 기반 자동 보정: 원점수로 통계를 쌓고, 누적 분포에 비추어 보정
          populationCalibration.record(averageEmotionScores, rawStressIndex);
          const stressIndex = populationCalibration.calibrateStress(rawStressIndex);

          // 주요 감정 결정
          const primaryEmotion = faceDetectionService.getPrimaryEmotion(averageEmotionScores);

          // 권장사항
          const recommendation = emotionAnalysisService.getRecommendation(
            stressIndex,
            primaryEmotion
          );

          // 표정 묘사 (강도 + 보조 감정 반영)
          const { label, detail } = emotionAnalysisService.describeEmotion(
            averageEmotionScores,
            primaryEmotion
          );

          // 심박 추정 (rPPG) — 신뢰도가 충분할 때만 결과에 포함
          const hr = heartRateService.estimate();
          const heartRate =
            hr && hr.confidence >= 0.35
              ? {
                  bpm: Math.min(120, Math.max(50, hr.bpm)),
                  label: heartRateLabel(Math.min(120, Math.max(50, hr.bpm))),
                }
              : undefined;

          // 결과 저장
          const stressLevel =
            stressIndex < 33 ? 'low' : stressIndex < 66 ? 'medium' : 'high';
          const summary: AnalysisSummary = {
            primaryEmotion,
            stressLevel,
            stressIndex: Math.round(stressIndex),
            keyword: label,
            emotionDetail: detail,
            emotionScores: averageEmotionScores,
            recommendation,
            quote: emotionAnalysisService.getQuote(stressLevel, primaryEmotion),
            analyzedTime: ANALYSIS_DURATION,
            calibrationCount: populationCalibration.getCount(),
            heartRate,
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
        const t0 = performance.now();

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
            // 콘솔 레버는 DOM에 직접 반영 — 매 틱 리렌더를 만들지 않는다
            consoleRef.current?.update(scores);
          }
        } catch (err) {
          console.error('Face detection error:', err);
        }

        if (runningRef.current) {
          // detect 소요 시간을 빼서 실제 주기를 목표에 맞춘다 (await 후 예약이라 백로그 없음, rPPG 샘플 간격 균일화)
          detectLoopRef.current = setTimeout(
            detectLoop,
            Math.max(16, DETECTION_INTERVAL - (performance.now() - t0))
          );
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

  if (appMode === 'tension') {
    return (
      <Suspense fallback={null}>
        <TensionDetector onBack={() => setAppMode('mind')} />
      </Suspense>
    );
  }

  if (result && status === 'completed') {
    return (
      <Suspense fallback={null}>
        <Results result={result} onReset={resetAnalysis} />
      </Suspense>
    );
  }

  return (
    <div className="stress-analyzer hall-scene">
      <MemoryOrbs paused={status === 'detecting' || status === 'analyzing'} />
      <div className="container">
        <header className="page-header">
          <span className="badge">
            <span className="badge-dot" aria-hidden="true" />
            1부스 · AI 표정 인식
          </span>
          <h1>마음, 잠깐 들여다볼까요?</h1>
          <p className="subtitle">
            카메라 앞에서 {ANALYSIS_DURATION}초면 충분해요.
            <br />
            오늘 마음이 무슨 색인지 알려드릴게요.
          </p>
        </header>

        {status === 'idle' && (
          <div className="card idle-state">
            <div className="hero-emoji">
              <EmotionCharacter
                emotion="joy"
                size={112}
                large
                orb
                label="기쁨이 맞이하고 있어요"
              />
            </div>
            <ul className="steps">
              <li>
                <span className="step-icon">
                  <EmotionCharacter emotion="joy" size={30} orb />
                </span>
                카메라를 편안하게 바라봐 주세요
              </li>
              <li>
                <span className="step-icon">
                  <EmotionCharacter emotion="sadness" size={30} orb />
                </span>
                얼굴이 보이면 {ANALYSIS_DURATION}초 동안 자동으로 분석해요
              </li>
              <li>
                <span className="step-icon">
                  <EmotionCharacter emotion="fear" size={30} orb />
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
              {modelReady ? '마음 본부 들어가기' : '준비하고 있어요…'}
            </button>
            <p className="hint">버튼을 누르면 카메라 사용 권한을 요청해요</p>
            <button className="mode-switch" onClick={() => setAppMode('tension')}>
              긴장 감지도 해볼래요 →
            </button>

            <div className="roster">
              <p className="roster-title">오늘 본부를 지키는 감정들</p>
              <div className="roster-list">
                {(
                  ['joy', 'sadness', 'anger', 'disgust', 'fear', 'anxiety', 'ennui'] as const
                ).map((key) => (
                  <EmotionCharacter
                    key={key}
                    emotion={key}
                    size={38}
                    orb
                    label={CHARACTER_NAME[key]}
                  />
                ))}
              </div>
            </div>
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
                {/* 카운트다운 = 빛으로 차오르는 기억 구슬 */}
                <div className="countdown">
                  <span
                    className="count-orb"
                    style={{
                      ['--fill' as string]: `${
                        ((ANALYSIS_DURATION - timeRemaining) / ANALYSIS_DURATION) * 100
                      }%`,
                    }}
                  >
                    <span className="count-orb-fill" />
                    <span className="count-num">{timeRemaining}</span>
                  </span>
                  <span className="count-text">
                    표정을 읽고 있어요
                    <em>구슬이 다 차면 결과가 나와요</em>
                  </span>
                </div>
                <EmotionConsole ref={consoleRef} />
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
              <EmotionCharacter emotion="sadness" size={92} orb label="머쓱한 얼굴" />
            </div>
            <p className="error-message">{error}</p>
            <button className="start-button" onClick={resetAnalysis}>
              다시 시도하기
            </button>
          </div>
        )}

        <BrandFooter />
      </div>
    </div>
  );
}
