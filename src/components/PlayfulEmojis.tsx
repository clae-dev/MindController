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

// 하늘 + 축제 + 놀이터에서 뛰노는 아이들 — 카드 영역(중앙)을 피해 배치
// 🏃🤸 등 사람 이모지는 Noto 애니메이션 세트에 없어 정적 이모지로 폴백됨
const ITEMS: PlayfulItem[] = [
  // 하늘
  { emoji: '🌞', size: 46, style: { top: '6%', right: '7%' }, delay: '0s', duration: '5.5s' },
  { emoji: '🪁', size: 38, style: { top: '13%', left: '9%' }, delay: '0.7s', duration: '4.4s' },
  { emoji: '🎉', size: 36, style: { top: '8%', left: '22%' }, delay: '1.5s', duration: '5s', hideOnMobile: true },
  { emoji: '🎊', size: 32, style: { top: '17%', right: '19%' }, delay: '2.1s', duration: '4.2s', hideOnMobile: true },
  { emoji: '🦋', size: 30, style: { top: '40%', left: '8%' }, delay: '0.3s', duration: '3.6s', hideOnMobile: true },
  { emoji: '🎈', size: 30, style: { top: '36%', right: '8%' }, delay: '2.2s', duration: '4.8s' },
  { emoji: '🪅', size: 30, style: { top: '26%', right: '6%' }, delay: '1s', duration: '3.8s', hideOnMobile: true },
  // 놀이공원 (언덕 위)
  { emoji: '🎡', size: 60, style: { bottom: '16%', left: '6%' }, delay: '0s', duration: '6s' },
  { emoji: '🎠', size: 48, style: { bottom: '15%', right: '7%' }, delay: '1.2s', duration: '5.5s', hideOnMobile: true },
  // 풀밭에서 뛰노는 아이들
  { emoji: '🏃‍♂️', size: 34, style: { bottom: '8%', left: '22%' }, delay: '0.4s', duration: '2.6s' },
  { emoji: '🤸‍♀️', size: 32, style: { bottom: '5%', right: '24%' }, delay: '1.1s', duration: '3s', hideOnMobile: true },
  { emoji: '💃', size: 34, style: { bottom: '10%', right: '13%' }, delay: '0.8s', duration: '3.2s' },
  { emoji: '⚽', size: 28, style: { bottom: '5%', left: '33%' }, delay: '0s', duration: '2.8s' },
  { emoji: '🐇', size: 28, style: { bottom: '12%', left: '14%' }, delay: '1.7s', duration: '3.4s', hideOnMobile: true },
  { emoji: '🌼', size: 24, style: { bottom: '3.5%', right: '38%' }, delay: '0.9s', duration: '4.6s', hideOnMobile: true },
];

// 축제 가랜드 깃발 색 (4색 반복)
const PENNANT_COUNT = 16;

export default function PlayfulEmojis() {
  return (
    <div className="playful-layer" aria-hidden="true">
      <div className="bunting">
        {Array.from({ length: PENNANT_COUNT }, (_, i) => (
          <span key={i} className={`pennant pennant-${i % 4}`} />
        ))}
      </div>
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
