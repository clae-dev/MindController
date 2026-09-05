import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { FaceFrame, TensionSummary, QuestionResult, SmileResult, TensionBreakdown } from '../types/index';
import { faceDetectionService } from '../services/faceDetection';
import { perfProfile } from '../utils/tvMode';
import { heartRateService } from '../services/heartRate';
import { tensionAnalysisService } from '../services/tensionAnalysis';
import { computeSmileAuthenticity, meanEyeEngage } from '../services/smileAnalysis';
import { pickQuestions } from '../data/tensionQuestions';
import { useCountUp } from '../hooks/useCountUp';
import AnimatedEmoji from './AnimatedEmoji';
import BrandFooter from './BrandFooter';
import MemoryOrbs from './MemoryOrbs';
import EmotionCharacter from './EmotionCharacter';
import '../styles/TensionDetector.css';

interface TensionDetectorProps {
  onBack: () => void;
}

type SubMode = 'free' | 'question' | 'smile';
type Phase =
  | 'menu'
  | 'detecting'
  | 'baseline'
  | 'live'
  | 'qIntro'
  | 'qCapture'
  | 'smileBaseline'
  | 'smileCapture'
  | 'completed'
  | 'error';

const DETECTION_INTERVAL = perfProfile.detectionIntervalMs; // ms — 프로파일(TV 모드)에 따름
const BASELINE_SEC = 4;
const SMILE_BASELINE_SEC = 1.5; // 웃기 직전 무표정 기준선
const SMILE_SEC = 4;
const Q_INTRO_SEC = 1.6;
const Q_CAPTURE_SEC = 3.4;
const QUESTION_COUNT = 4;

// 구간마다 나오는 감정 캐릭터: 편안 → 평온(따분), 약간 → 불안, 뚜렷 → 버럭
const BAND_INFO = {
  calm: { text: '아주 편안해 보였어요', character: 'ennui', color: 'var(--sage)' },
  mild: { text: '약간의 긴장이 보였어요', character: 'anxiety', color: 'var(--anxiety)' },
  tense: { text: '긴장이 뚜렷했어요', character: 'anger', color: 'var(--maroon)' },
} as const;

const SIGNAL_LABELS: Record<keyof TensionBreakdown, string> = {
  facial: '표정 긴장',
  instability: '미세표정의 흔들림',
  blink: '깜빡임 변화',
  gaze: '시선·고개 움직임',
  heart: '심박 상승',
};

const SMILE_INFO = {
  genuine: { emoji: '😄', text: '진짜 웃음이에요!', desc: '눈가까지 함께 웃는 Duchenne 미소예요' },
  forced: { emoji: '😬', text: '살짝 억지 웃음?', desc: '입은 웃는데 눈가 근육은 덜 움직였어요' },
  faint: { emoji: '🙂', text: '미소가 약했어요', desc: '조금 더 활짝 웃어볼까요?' },
} as const;

const bandOf = (t: number): keyof typeof BAND_INFO =>
  t < 33 ? 'calm' : t < 66 ? 'mild' : 'tense';

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
  return '분석 모델을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
};

export default function TensionDetector({ onBack }: TensionDetectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const detectLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // 루프 로직용 ref (리렌더 없이 갱신)
  const phaseRef = useRef<Phase>('menu');
  const phaseStartRef = useRef(0);
  const subModeRef = useRef<SubMode>('free');
  const questionsRef = useRef<string[]>([]);
  const qIndexRef = useRef(0);
  const qResultsRef = useRef<QuestionResult[]>([]);
  const smileFramesRef = useRef<FaceFrame[]>([]);
  const smileBaselineFramesRef = useRef<FaceFrame[]>([]);

  // 렌더링용 state
  const [phase, setPhaseState] = useState<Phase>('menu');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(BASELINE_SEC);
  // 카운트다운은 초당 한 번만 바뀌므로, 정수 초가 바뀔 때만 setState해 매 프레임(10fps)
  // 불필요한 리렌더를 막는다 (live 단계는 이미 imperative 게이지로 분리돼 있음)
  const lastCountdownRef = useRef(BASELINE_SEC);
  const updateCountdown = (sec: number) => {
    if (sec !== lastCountdownRef.current) {
      lastCountdownRef.current = sec;
      setCountdown(sec);
    }
  };
  // 라이브 게이지는 imperative 핸들로만 갱신해 10fps 동안 부모(헤더·영상·버튼)
  // 재조정을 건너뛴다. 변화 게이팅은 LiveGauge 내부 setVal 비교에서 처리.
  const gaugeRef = useRef<LiveGaugeHandle>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [qProgress, setQProgress] = useState({ index: 0, total: 0 });
  const [tensionSummary, setTensionSummary] = useState<TensionSummary | null>(null);
  const [questionResults, setQuestionResults] = useState<QuestionResult[] | null>(null);
  const [smileResult, setSmileResult] = useState<SmileResult | null>(null);

  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    phaseStartRef.current = performance.now();
    setPhaseState(p);
  };

  const stopStream = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopEverything = () => {
    runningRef.current = false;
    if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
    stopStream();
    faceDetectionService.unbind();
  };

  // 언마운트 시 정리 (ref/싱글턴만 참조하므로 의존성 없음)
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      faceDetectionService.unbind();
    };
  }, []);

  const finishLive = () => {
    runningRef.current = false;
    if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
    setTensionSummary(tensionAnalysisService.getSummary());
    stopStream();
    setPhase('completed');
  };

  const finishQuestion = () => {
    runningRef.current = false;
    if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
    setQuestionResults([...qResultsRef.current]);
    stopStream();
    setPhase('completed');
  };

  const finishSmile = () => {
    runningRef.current = false;
    if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
    const baseEye = meanEyeEngage(smileBaselineFramesRef.current);
    setSmileResult(computeSmileAuthenticity(smileFramesRef.current, baseEye));
    stopStream();
    setPhase('completed');
  };

  const beginQuestion = (idx: number) => {
    qIndexRef.current = idx;
    setCurrentQuestion(questionsRef.current[idx]);
    setQProgress({ index: idx, total: questionsRef.current.length });
    setPhase('qIntro');
  };

  // pushFrame은 항상 호출(세션 누산기 갱신)하되, 표시 갱신은 게이지 컴포넌트에 위임
  const pushLive = (frame: FaceFrame, now: number) => {
    const next = tensionAnalysisService.pushFrame(frame, now);
    gaugeRef.current?.set(next.tension, next.confidence);
  };

  const handleFrame = (frame: FaceFrame, now: number) => {
    const elapsed = (now - phaseStartRef.current) / 1000;

    switch (phaseRef.current) {
      case 'detecting':
        // 얼굴이 잡히면 시작
        if (subModeRef.current === 'smile') setPhase('smileBaseline');
        else setPhase('baseline');
        break;

      case 'baseline':
        tensionAnalysisService.recordBaselineFrame(frame, now);
        updateCountdown(Math.max(0, Math.ceil(BASELINE_SEC - elapsed)));
        if (elapsed >= BASELINE_SEC) {
          tensionAnalysisService.finalizeBaseline();
          if (subModeRef.current === 'question') beginQuestion(0);
          else setPhase('live');
        }
        break;

      case 'live':
        pushLive(frame, now);
        break;

      case 'qIntro':
        updateCountdown(Math.max(0, Math.ceil(Q_INTRO_SEC - elapsed)));
        if (elapsed >= Q_INTRO_SEC) {
          tensionAnalysisService.beginSegment(questionsRef.current[qIndexRef.current]);
          setPhase('qCapture');
        }
        break;

      case 'qCapture': {
        pushLive(frame, now);
        updateCountdown(Math.max(0, Math.ceil(Q_CAPTURE_SEC - elapsed)));
        if (elapsed >= Q_CAPTURE_SEC) {
          qResultsRef.current.push(tensionAnalysisService.endSegment());
          const next = qIndexRef.current + 1;
          if (next < questionsRef.current.length) beginQuestion(next);
          else finishQuestion();
        }
        break;
      }

      case 'smileBaseline':
        // 무표정 기준선: 흔들린 프레임은 제외하고 수집
        if (frame.headMotion < 0.02) smileBaselineFramesRef.current.push(frame);
        updateCountdown(Math.max(0, Math.ceil(SMILE_BASELINE_SEC - elapsed)));
        if (elapsed >= SMILE_BASELINE_SEC) setPhase('smileCapture');
        break;

      case 'smileCapture':
        smileFramesRef.current.push(frame);
        updateCountdown(Math.max(0, Math.ceil(SMILE_SEC - elapsed)));
        if (elapsed >= SMILE_SEC) finishSmile();
        break;
    }
  };

  const start = async (mode: SubMode) => {
    try {
      setError(null);
      subModeRef.current = mode;
      heartRateService.reset();
      tensionAnalysisService.reset();
      qIndexRef.current = 0;
      qResultsRef.current = [];
      smileFramesRef.current = [];
      smileBaselineFramesRef.current = [];
      setTensionSummary(null);
      setQuestionResults(null);
      setSmileResult(null);
      gaugeRef.current?.set(0, 1);
      if (mode === 'question') questionsRef.current = pickQuestions(QUESTION_COUNT);

      setPhase('detecting');

      // 표시는 CSS로 확대하고, 캡처는 추론·캔버스 비용을 줄이려 낮춤
      // (얼굴 랜드마크는 내부적으로 더 낮은 해상도로 처리돼 정확도 영향 거의 없음)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: perfProfile.captureWidth },
          height: { ideal: perfProfile.captureHeight },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (videoRef.current && canvasRef.current) {
        await faceDetectionService.bind(videoRef.current, canvasRef.current);
      }

      // 감지 루프 — start() 내부에 두어 렌더 단계와 분리 (performance.now 등 부수효과)
      const detectLoop = async () => {
        if (!runningRef.current) return;
        const t0 = performance.now();
        try {
          const frame = await faceDetectionService.detectFaceFrame();
          if (frame) handleFrame(frame, performance.now());
        } catch (err) {
          console.error('Tension detection error:', err);
        }
        if (runningRef.current) {
          // detect 소요 시간을 빼서 실제 주기를 목표에 맞춘다 (await 후 예약이라 백로그 없음, rPPG 샘플 간격 균일화)
          detectLoopRef.current = setTimeout(
            detectLoop,
            Math.max(16, DETECTION_INTERVAL - (performance.now() - t0))
          );
        }
      };

      runningRef.current = true;
      detectLoop();
    } catch (err) {
      console.error('Start tension error:', err);
      stopEverything();
      setError(startErrorMessage(err));
      setPhase('error');
    }
  };

  // 측정 중단 → 모드 메뉴로
  const cancel = () => {
    stopEverything();
    setPhase('menu');
  };

  const measuring =
    phase === 'detecting' ||
    phase === 'baseline' ||
    phase === 'live' ||
    phase === 'qIntro' ||
    phase === 'qCapture' ||
    phase === 'smileBaseline' ||
    phase === 'smileCapture';

  return (
    <div className="stress-analyzer hall-scene">
      <MemoryOrbs paused={measuring} />
      <div className="container">
        <header className="page-header">
          <span className="badge">
            <AnimatedEmoji emoji="🔍" size={18} label="돋보기" />
            긴장 감지
          </span>
          <h1>지금, 얼마나 긴장했을까요?</h1>
          <p className="subtitle">
            평소 표정을 잠깐 익힌 뒤, 그에 비해 얼마나 긴장하는지 읽어드려요.
            <br />
            <strong>재미로 보는 추정이며 실제 거짓말 판별이 아니에요.</strong>
          </p>
        </header>

        {phase === 'menu' && (
          <div className="card tension-menu">
            <button className="mode-card" onClick={() => start('free')}>
              <span className="mode-emoji">
                <EmotionCharacter emotion="ennui" size={44} orb />
              </span>
              <span className="mode-text">
                <b>자유 측정</b>
                <small>말하거나 가만히 있는 동안 긴장도를 실시간 게이지로</small>
              </span>
            </button>
            <button className="mode-card" onClick={() => start('question')}>
              <span className="mode-emoji">
                <EmotionCharacter emotion="embarrassment" size={44} orb />
              </span>
              <span className="mode-text">
                <b>질문 챌린지</b>
                <small>질문에 답하는 순간, 어떤 질문에서 흔들렸는지</small>
              </span>
            </button>
            <button className="mode-card" onClick={() => start('smile')}>
              <span className="mode-emoji">
                <EmotionCharacter emotion="joy" size={44} orb />
              </span>
              <span className="mode-text">
                <b>웃음 판별</b>
                <small>진짜 웃음인지 억지 웃음인지 (Duchenne 미소)</small>
              </span>
            </button>

            <button className="ghost-button" onClick={onBack}>
              ← 마음 분석으로 돌아가기
            </button>
            <p className="hint">영상은 저장되지 않고, 기기 안에서만 처리돼요</p>
          </div>
        )}

        {measuring && (
          <div className="card analyzing-state">
            <div className="video-frame">
              <video ref={videoRef} className="video-feed" autoPlay playsInline muted />
              <canvas ref={canvasRef} className="landmark-canvas" />
            </div>

            {phase === 'detecting' && (
              <div className="status-line">
                <AnimatedEmoji emoji="👀" size={24} label="두리번" />
                얼굴을 찾고 있어요… 카메라를 바라봐 주세요
              </div>
            )}

            {phase === 'baseline' && (
              <>
                <div className="countdown">
                  <span className="count-num">{countdown}</span>초
                </div>
                <div className="status-line">
                  <AnimatedEmoji emoji="😌" size={22} label="평온" />
                  편하게 숨을 고르며 평소 표정을 익히는 중이에요
                </div>
              </>
            )}

            {phase === 'live' && (
              <>
                <LiveGauge ref={gaugeRef} />
                <div className="status-line">자유롭게 말하거나 가만히 있어 보세요</div>
              </>
            )}

            {(phase === 'qIntro' || phase === 'qCapture') && (
              <>
                <div className="question-progress">
                  질문 {qProgress.index + 1} / {qProgress.total}
                </div>
                <p className="question-text" key={currentQuestion}>
                  {currentQuestion}
                </p>
                {phase === 'qIntro' ? (
                  <div className="status-line">잠시 후 측정을 시작해요…</div>
                ) : (
                  <>
                    <LiveGauge ref={gaugeRef} />
                    <div className="status-line">
                      <span className="count-num small">{countdown}</span>초 동안 답해보세요
                    </div>
                  </>
                )}
              </>
            )}

            {phase === 'smileBaseline' && (
              <>
                <div className="countdown">
                  <span className="count-num">{countdown}</span>초
                </div>
                <div className="status-line">
                  <AnimatedEmoji emoji="😐" size={22} label="무표정" />
                  무표정으로 잠깐 계세요 (평소 표정을 익혀요)
                </div>
              </>
            )}

            {phase === 'smileCapture' && (
              <>
                <div className="countdown">
                  <span className="count-num">{countdown}</span>초
                </div>
                <div className="status-line">
                  <AnimatedEmoji emoji="😄" size={22} label="웃음" />
                  카메라를 보며 활짝 웃어보세요!
                </div>
              </>
            )}

            <button className="stop-button" onClick={phase === 'live' ? finishLive : cancel}>
              {phase === 'live' ? '결과 보기' : '그만할래요'}
            </button>
          </div>
        )}

        {phase === 'completed' && tensionSummary && (
          <div className="card tension-result">
            <ResultBand band={tensionSummary.band} />
            <GaugeViewCountUp target={tensionSummary.peak} confidence={tensionSummary.confidence} />
            <div className="result-rows">
              <div className="result-row">
                <span>최고 긴장</span>
                <b><CountUp target={tensionSummary.peak} /></b>
              </div>
              <div className="result-row">
                <span>평균 긴장</span>
                <b><CountUp target={tensionSummary.average} /></b>
              </div>
              <div className="result-row">
                <span>가장 큰 신호</span>
                <b>{SIGNAL_LABELS[tensionSummary.topSignal]}</b>
              </div>
            </div>
            <ConfidenceBadge confidence={tensionSummary.confidence} />
            <ResultFooter onAgain={() => setPhase('menu')} onBack={onBack} />
          </div>
        )}

        {phase === 'completed' && questionResults && (
          <div className="card tension-result">
            <h2 className="result-title">질문별 긴장 반응</h2>
            <QuestionBars results={questionResults} />
            <p className="disclaimer">
              가장 막대가 높은 질문에서 가장 긴장했다는 뜻이에요.
              <br />
              거짓말 여부와는 무관한 재미용 결과랍니다.
            </p>
            <ResultFooter onAgain={() => setPhase('menu')} onBack={onBack} />
          </div>
        )}

        {phase === 'completed' && smileResult && (
          <div className="card tension-result">
            <div className="smile-hero">
              <AnimatedEmoji emoji={SMILE_INFO[smileResult.verdict].emoji} size={72} />
              <h2 className="result-title">{SMILE_INFO[smileResult.verdict].text}</h2>
              <p className="emotion-caption">{SMILE_INFO[smileResult.verdict].desc}</p>
            </div>
            {smileResult.verdict !== 'faint' && (
              <div className="result-rows">
                <div className="result-row">
                  <span>진짜 웃음 점수</span>
                  <b><CountUp target={smileResult.authenticity} suffix=" / 100" /></b>
                </div>
              </div>
            )}
            <p className="disclaimer">눈가 근육 동반 여부로 본 재미용 추정이에요.</p>
            <ResultFooter onAgain={() => setPhase('menu')} onBack={onBack} />
          </div>
        )}

        {phase === 'error' && (
          <div className="card error-state">
            <div className="hero-emoji">
              <AnimatedEmoji emoji="🥲" size={72} label="머쓱한 얼굴" />
            </div>
            <p className="error-message">{error}</p>
            <button className="start-button" onClick={() => setPhase('menu')}>
              다시 시도하기
            </button>
          </div>
        )}

        <BrandFooter />
      </div>
    </div>
  );
}

// 긴장 게이지 표시 (정적 결과·라이브 공용). 모듈 레벨이라 렌더마다 재생성되지 않음
function GaugeView({ tension, confidence }: { tension: number; confidence: number }) {
  const info = BAND_INFO[bandOf(tension)];
  const low = confidence < 0.5;
  const high = tension >= 66;
  return (
    <div className={`tension-gauge${low ? ' is-low' : ''}${high ? ' is-high' : ''}`}>
      {/* 66 이상이면 버럭 경광등이 위쪽에서 번진다 */}
      {high && <span className="tension-siren" aria-hidden="true" />}
      <div className="tension-scale">
        <span>편안</span>
        <span>긴장</span>
      </div>
      <div className="tension-track">
        <div className="tension-fill" style={{ width: `${tension}%` }} />
      </div>
      <div className="tension-readout">
        <EmotionCharacter emotion={info.character} size={34} orb />
        <b style={{ color: info.color }}>{tension}</b>
        <span>/ 100</span>
      </div>
      {low && (
        <p className="tension-lowsignal">신호가 약해요. 잠시 가만히 카메라를 바라봐 주세요</p>
      )}
    </div>
  );
}

// 카운트업 숫자만 소유하는 leaf — rAF마다의 setState가 이 텍스트 노드에만 갇혀
// 결과 카드 전체가 매 프레임 리렌더되지 않는다.
function CountUp({ target, suffix }: { target: number; suffix?: string }) {
  const value = useCountUp(target);
  return (
    <>
      {value}
      {suffix}
    </>
  );
}

// 결과 게이지도 자체적으로 카운트업 — 부모가 아니라 이 컴포넌트만 프레임마다 리렌더
function GaugeViewCountUp({ target, confidence }: { target: number; confidence: number }) {
  const tension = useCountUp(target);
  return <GaugeView tension={tension} confidence={confidence} />;
}

export interface LiveGaugeHandle {
  set: (tension: number, confidence: number) => void;
}

// 라이브 측정용 게이지: 자체 state를 가져 부모 리렌더와 분리된다. set()으로 값을 밀어넣고,
// 게이지가 실제로 쓰는 값(tension 정수 + confidence<0.5 여부)이 바뀐 경우에만 리렌더한다.
const LiveGauge = forwardRef<LiveGaugeHandle>(function LiveGauge(_props, ref) {
  const [val, setVal] = useState({ tension: 0, confidence: 1 });
  useImperativeHandle(
    ref,
    () => ({
      set: (tension: number, confidence: number) =>
        setVal((prev) =>
          prev.tension === tension && (prev.confidence < 0.5) === (confidence < 0.5)
            ? prev
            : { tension, confidence }
        ),
    }),
    []
  );
  return <GaugeView tension={val.tension} confidence={val.confidence} />;
});

function ResultBand({ band }: { band: TensionSummary['band'] }) {
  const info = BAND_INFO[band];
  return (
    <div className="result-band">
      <EmotionCharacter
        emotion={info.character}
        size={84}
        large={info.character === 'anger'}
        orb
        label={info.text}
      />
      <h2 className="result-title" style={{ color: info.color }}>
        {info.text}
      </h2>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const low = confidence < 0.5;
  return (
    <p className={`confidence-badge${low ? ' is-low' : ''}`}>
      {low ? '⚠️ 신호 신뢰도 낮음' : '신호 신뢰도'} {pct}%
      {low && ' — 움직임이 많았어요. 가만히 다시 재면 더 정확해요'}
    </p>
  );
}

function QuestionBars({ results }: { results: QuestionResult[] }) {
  const maxPeak = Math.max(1, ...results.map((r) => r.peak));
  // 마운트 직후 0 → 실제값으로 막대가 스윽 차오르게
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShown(true), 80);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="question-bars">
      {results.map((r, i) => {
        const isTop = r.peak === maxPeak && r.peak > 0;
        return (
          <div className={`qbar-row${isTop ? ' is-top' : ''}`} key={i}>
            <p className="qbar-question">
              {r.question}
              {isTop && <span className="qbar-flag"> 🔥 가장 흔들림</span>}
            </p>
            <div className="qbar-track">
              <div className="qbar-fill" style={{ width: shown ? `${r.peak}%` : '0%' }} />
            </div>
            <span className="qbar-value">{r.peak}</span>
          </div>
        );
      })}
    </div>
  );
}

function ResultFooter({ onAgain, onBack }: { onAgain: () => void; onBack: () => void }) {
  return (
    <>
      <button className="start-button" onClick={onAgain}>
        다시 해볼래요 <AnimatedEmoji emoji="💫" size={18} />
      </button>
      <button className="ghost-button" onClick={onBack}>
        ← 마음 분석으로 돌아가기
      </button>
    </>
  );
}
