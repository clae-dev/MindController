import type { CSSProperties } from 'react';
import AnimatedEmoji from './AnimatedEmoji';

interface PlayfulItem {
  emoji: string;
  size: number;
  style: CSSProperties; // 위치 (top/left/right/bottom %)
  delay: string;
  duration: string;
  hideOnMobile?: boolean;
}

// 화면 가장자리에 둥둥 떠다니는 놀이 이모지들 — 카드 영역을 피해 배치
const ITEMS: PlayfulItem[] = [
  { emoji: '🛹', size: 36, style: { top: '9%', left: '12%' }, delay: '0s', duration: '4.2s' },
  { emoji: '🎉', size: 32, style: { top: '12%', right: '14%' }, delay: '0.8s', duration: '3.6s' },
  { emoji: '⚽', size: 30, style: { top: '42%', left: '7%' }, delay: '1.4s', duration: '4.8s', hideOnMobile: true },
  { emoji: '🏀', size: 30, style: { top: '48%', right: '7%' }, delay: '0.4s', duration: '4s', hideOnMobile: true },
  { emoji: '🪩', size: 34, style: { bottom: '14%', left: '13%' }, delay: '1s', duration: '4.5s', hideOnMobile: true },
  { emoji: '🚀', size: 32, style: { bottom: '11%', right: '12%' }, delay: '1.8s', duration: '3.8s' },
  { emoji: '🎸', size: 28, style: { bottom: '38%', right: '16%' }, delay: '2.4s', duration: '5s', hideOnMobile: true },
];

export default function PlayfulEmojis() {
  return (
    <div className="playful-layer" aria-hidden="true">
      {ITEMS.map((item) => (
        <span
          key={item.emoji}
          className={`playful-emoji${item.hideOnMobile ? ' playful-sm-hide' : ''}`}
          style={{
            ...item.style,
            animationDelay: item.delay,
            animationDuration: item.duration,
          }}
        >
          <AnimatedEmoji emoji={item.emoji} size={item.size} />
        </span>
      ))}
    </div>
  );
}
