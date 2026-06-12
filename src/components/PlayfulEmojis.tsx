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

// 하늘에 나는 것들 + 풀밭에서 노는 것들 — 카드 영역(중앙)을 피해 배치
const ITEMS: PlayfulItem[] = [
  // 하늘
  { emoji: '🌞', size: 46, style: { top: '6%', right: '7%' }, delay: '0s', duration: '5.5s' },
  { emoji: '🪁', size: 38, style: { top: '9%', left: '9%' }, delay: '0.7s', duration: '4.4s' },
  { emoji: '🐦', size: 28, style: { top: '22%', right: '18%' }, delay: '1.6s', duration: '4s', hideOnMobile: true },
  { emoji: '🦋', size: 30, style: { top: '38%', left: '8%' }, delay: '0.3s', duration: '3.6s' },
  { emoji: '🎈', size: 30, style: { top: '34%', right: '8%' }, delay: '2.2s', duration: '4.8s', hideOnMobile: true },
  // 풀밭
  { emoji: '⚽', size: 32, style: { bottom: '7%', left: '18%' }, delay: '0.5s', duration: '3s' },
  { emoji: '🏀', size: 30, style: { bottom: '12%', right: '20%' }, delay: '1.2s', duration: '2.8s', hideOnMobile: true },
  { emoji: '🛹', size: 36, style: { bottom: '14%', left: '7%' }, delay: '1.8s', duration: '3.4s', hideOnMobile: true },
  { emoji: '🐇', size: 32, style: { bottom: '6%', right: '9%' }, delay: '0s', duration: '3.2s' },
  { emoji: '🌼', size: 26, style: { bottom: '4%', left: '36%' }, delay: '0.9s', duration: '4.6s', hideOnMobile: true },
  { emoji: '🌷', size: 26, style: { bottom: '5%', right: '33%' }, delay: '1.4s', duration: '4.2s', hideOnMobile: true },
  { emoji: '🐝', size: 24, style: { bottom: '11%', left: '31%' }, delay: '2.6s', duration: '3s', hideOnMobile: true },
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
