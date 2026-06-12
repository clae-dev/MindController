import { useEffect, useState } from 'react';
import type { AnalysisSummary } from '../types/index';
import { EMOTION_NAMES } from '../services/emotionAnalysis';
import AnimatedEmoji from './AnimatedEmoji';
import BrandFooter from './BrandFooter';
import PlayfulEmojis from './PlayfulEmojis';
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
  fearful: '😨',
};

// 감정 분포 바 색상 (차분한 톤)
const EMOTION_COLORS: Record<string, string> = {
  happy: 'var(--sage)',
  sad: '#7b8aa6',
  angry: 'var(--maroon)',
  surprised: 'var(--mustard)',
  neutral: 'var(--ink-faint)',
  disgusted: '#8a9a5b',
  fearful: '#9a86b5',
};

const LEVEL_INFO: Record<
  AnalysisSummary['stressLevel'],
  { text: string; emoji: string; color: string }
> = {
  low: { text: '여유로워요', emoji: '🌱', color: 'var(--sage)' },
  medium: { text: '조금 지쳐 있어요', emoji: '☁️', color: 'var(--mustard)' },
  high: { text: '많이 힘들어요', emoji: '🌧️', color: 'var(--maroon)' },
};

const AUTO_RESET_SECONDS = 15; // 결과 확인 후 자동으로 첫 화면으로 돌아가는 시간

export default function Results({ result, onReset }: ResultsProps) {
  // 마운트 후 게이지가 0에서 결과값까지 차오르도록
  const [gaugeValue, setGaugeValue] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_RESET_SECONDS);

  useEffect(() => {
    const id = setTimeout(() => setGaugeValue(result.stressIndex), 80);
    return () => clearTimeout(id);
  }, [result.stressIndex]);

  // 자동 초기화 카운트다운
  useEffect(() => {
    const id = setInterval(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) onReset();
  }, [secondsLeft, onReset]);

  const level = LEVEL_INFO[result.stressLevel];
  const emoji = EMOTION_EMOJIS[result.primaryEmotion] || '😌';

  // 감정 분포: 상위 3개 (1% 미만 제외)
  const spectrum = (Object.entries(result.emotionScores) as [string, number][])
    .map(([key, value]) => ({ key, value: Math.round(value) }))
    .filter((e) => e.value >= 1)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return (
    <div className="results-container sky-scene">
      <PlayfulEmojis />
      <div className="results-card">
        <header className="results-header">
          <span className="badge">
            <AnimatedEmoji emoji="🍃" size={16} label="나뭇잎" />
            마음 리포트
          </span>
          <h1>
            오늘의 마음 결과예요
            {result.stressLevel === 'low' && (
              <span className="header-party" aria-hidden="true">
                <AnimatedEmoji emoji="🥳" size={26} />
              </span>
            )}
          </h1>
        </header>

        <div className="emotion-hero">
          <div className="emotion-circle">
            <AnimatedEmoji emoji={emoji} size={64} label={result.keyword} />
          </div>
          <p className="emotion-name">{result.keyword}</p>
          <p className="emotion-caption">{result.emotionDetail}</p>
        </div>

        {spectrum.length > 0 && (
          <div className="spectrum-section">
            <p className="spectrum-title">감정 분포</p>
            {spectrum.map((e) => (
              <div className="spectrum-row" key={e.key}>
                <span className="spectrum-label">
                  <AnimatedEmoji emoji={EMOTION_EMOJIS[e.key] || '😌'} size={16} />
                  {EMOTION_NAMES[e.key] || e.key}
                </span>
                <div className="spectrum-track">
                  <div
                    className="spectrum-fill"
                    style={{
                      width: `${e.value}%`,
                      background: EMOTION_COLORS[e.key] || 'var(--ink-faint)',
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
          표정 분석 {result.analyzedTime}초 · 영상은 저장되지 않았어요 ·{' '}
          {secondsLeft}초 후 처음으로 돌아가요
        </p>
      </div>
      <BrandFooter />
    </div>
  );
}
