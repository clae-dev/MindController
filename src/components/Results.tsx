import { useEffect, useState } from 'react';
import type { AnalysisSummary } from '../types/index';
import AnimatedEmoji from './AnimatedEmoji';
import '../styles/Results.css';

interface ResultsProps {
  result: AnalysisSummary;
  onReset: () => void;
}

const EMOTION_EMOJIS: Record<string, string> = {
  happy: '😊',
  sad: '😢',
  angry: '😠',
  surprised: '😲',
  neutral: '😌',
  disgusted: '🤢',
  afraid: '😨',
};

const LEVEL_INFO: Record<
  AnalysisSummary['stressLevel'],
  { text: string; emoji: string; color: string }
> = {
  low: { text: '여유로워요', emoji: '🌱', color: 'var(--sage)' },
  medium: { text: '조금 지쳐 있어요', emoji: '☁️', color: 'var(--mustard)' },
  high: { text: '많이 힘들어요', emoji: '🌧️', color: 'var(--maroon)' },
};

export default function Results({ result, onReset }: ResultsProps) {
  // 마운트 후 게이지가 0에서 결과값까지 차오르도록
  const [gaugeValue, setGaugeValue] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setGaugeValue(result.stressIndex), 80);
    return () => clearTimeout(id);
  }, [result.stressIndex]);

  const level = LEVEL_INFO[result.stressLevel];
  const emoji = EMOTION_EMOJIS[result.primaryEmotion] || '😌';

  return (
    <div className="results-container">
      <div className="results-card">
        <header className="results-header">
          <span className="badge">
            <AnimatedEmoji emoji="🍃" size={16} label="나뭇잎" />
            마음 리포트
          </span>
          <h1>오늘의 마음 결과예요</h1>
        </header>

        <div className="emotion-hero">
          <div className="emotion-circle">
            <AnimatedEmoji emoji={emoji} size={64} label={result.keyword} />
          </div>
          <p className="emotion-name">{result.keyword}</p>
          <p className="emotion-caption">이 표정이 가장 많이 보였어요</p>
        </div>

        <div className="score-section">
          <div className="score-row">
            <span className="score-title">스트레스 지수</span>
            <span className="level-chip" style={{ color: level.color }}>
              <AnimatedEmoji emoji={level.emoji} size={18} />
              {level.text}
            </span>
          </div>
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${gaugeValue}%` }} />
          </div>
          <div className="score-value">
            <b style={{ color: level.color }}>{result.stressIndex}</b>
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
          <blockquote>{result.quote.text}</blockquote>
          <figcaption>— {result.quote.author}</figcaption>
        </figure>

        <button className="reset-button" onClick={onReset}>
          한 번 더 해볼래요 <AnimatedEmoji emoji="💫" size={18} />
        </button>

        <p className="analysis-info">
          표정 분석 {result.analyzedTime}초 · 영상은 저장되지 않았어요
        </p>
      </div>
    </div>
  );
}
