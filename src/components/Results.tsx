import { useEffect, useState } from 'react';
import type { AnalysisSummary } from '../types/index';
import { EMOTION_NAMES } from '../services/emotionAnalysis';
import { useCountUp } from '../hooks/useCountUp';
import AnimatedEmoji from './AnimatedEmoji';
import BrandFooter from './BrandFooter';
import MemoryOrbs from './MemoryOrbs';
import EmotionCharacter, {
  EMOTION_CHARACTER,
  CHARACTER_NAME,
  emotionGlow,
} from './EmotionCharacter';
import '../styles/Results.css';

interface ResultsProps {
  result: AnalysisSummary;
  onReset: () => void;
}

const LEVEL_INFO: Record<
  AnalysisSummary['stressLevel'],
  { text: string; emoji: string; color: string }
> = {
  low: { text: '여유로워요', emoji: '🌱', color: 'var(--sage)' },
  medium: { text: '조금 지쳐 있어요', emoji: '☁️', color: 'var(--mustard)' },
  high: { text: '많이 힘들어요', emoji: '🌧️', color: 'var(--maroon)' },
};

// 카운트업 숫자만 소유하는 leaf — rAF마다의 setState가 이 텍스트 노드에만 갇혀
// 결과 카드 전체가 매 프레임 리렌더되지 않는다.
function CountUp({ target }: { target: number }) {
  const value = useCountUp(target);
  return <>{value}</>;
}

export default function Results({ result, onReset }: ResultsProps) {
  // 마운트 후 게이지가 0에서 결과값까지 차오르도록
  const [gaugeValue, setGaugeValue] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setGaugeValue(result.stressIndex), 80);
    return () => clearTimeout(id);
  }, [result.stressIndex]);

  const level = LEVEL_INFO[result.stressLevel];
  // 오늘의 기억 구슬 = 가장 강한 감정의 캐릭터
  const orbCharacter = EMOTION_CHARACTER[result.primaryEmotion] ?? 'ennui';
  const orbGlow = emotionGlow(result.primaryEmotion);

  // 감정 분포: 상위 3개 (1% 미만 제외)
  const spectrum = (Object.entries(result.emotionScores) as [string, number][])
    .map(([key, value]) => ({ key, value: Math.round(value) }))
    .filter((e) => e.value >= 1)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return (
    <div className="results-container hall-scene">
      <MemoryOrbs />
      <div className="results-card">
        <header className="results-header">
          <span className="badge" style={{ color: level.color }}>
            <AnimatedEmoji emoji={level.emoji} size={16} />
            {level.text}
          </span>
          <h1>
            오늘의 기억 구슬
            {result.stressLevel === 'low' && (
              <span className="header-party" aria-hidden="true">
                <AnimatedEmoji emoji="🥳" size={26} />
              </span>
            )}
          </h1>
        </header>

        <div className="emotion-hero">
          <div
            className="emotion-circle"
            style={{ ['--glow' as string]: orbGlow }}
          >
            <EmotionCharacter
              emotion={orbCharacter}
              size={136}
              large
              orb
              label={result.keyword}
            />
          </div>
          <p className="emotion-name">
            {CHARACTER_NAME[orbCharacter]} 구슬
          </p>
          <p className="emotion-caption">{result.emotionDetail}</p>
        </div>

        {result.heartRate && (
          <div className="heart-card">
            <span className="heart-emoji">
              <AnimatedEmoji emoji="❤️" size={30} label="심박" />
            </span>
            <span className="heart-bpm">
              <b>{result.heartRate.bpm}</b> bpm
            </span>
            <span className="heart-label">{result.heartRate.label}</span>
          </div>
        )}

        {spectrum.length > 0 && (
          <div className="spectrum-section">
            <p className="spectrum-title">감정 분포</p>
            {spectrum.map((e) => (
              <div className="spectrum-row" key={e.key}>
                <span className="spectrum-label">
                  <EmotionCharacter emotion={e.key} size={26} orb />
                  {EMOTION_NAMES[e.key] || e.key}
                </span>
                <div className="spectrum-track">
                  <div
                    className="spectrum-fill"
                    style={{
                      width: `${e.value}%`,
                      background: emotionGlow(e.key),
                      boxShadow: `0 0 12px -1px ${emotionGlow(e.key)}`,
                    }}
                  />
                </div>
                <span className="spectrum-value">{e.value}%</span>
              </div>
            ))}
          </div>
        )}

        <div className="score-section">
          <div className="score-row">
            <span className="score-title">본부 상태</span>
            <span className="level-chip" style={{ color: level.color }}>
              <AnimatedEmoji emoji={level.emoji} size={18} />
              {level.text}
            </span>
          </div>
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${gaugeValue}%` }} />
          </div>
          <div className="score-value">
            <b style={{ color: level.color }}><CountUp target={result.stressIndex} /></b>
            <span>/ 100</span>
          </div>
        </div>

        <div className="advice-card">
          <span className="advice-emoji">
            <AnimatedEmoji emoji="💬" size={24} label="조언" />
          </span>
          <p>{result.recommendation}</p>
        </div>

        <figure className="quote-card">
          <span className="quote-mark" aria-hidden="true">
            “
          </span>
          <p className="quote-label">구슬 라벨</p>
          <blockquote>{result.quote.text}</blockquote>
          <figcaption>{result.quote.author}</figcaption>
        </figure>

        <button className="reset-button" onClick={onReset}>
          구슬 보관하고 다시 하기
        </button>

        <p className="analysis-info">
          표정 분석 {result.analyzedTime}초 · 영상은 저장되지 않았어요
          {result.calibrationCount >= 15 && (
            <>
              <br />
              지금까지 {result.calibrationCount}번의 측정으로 보정된 결과예요 🌱
            </>
          )}
        </p>
      </div>
      <BrandFooter />
    </div>
  );
}
