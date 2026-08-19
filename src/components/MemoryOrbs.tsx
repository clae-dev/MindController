import { memo } from 'react';
import type { CSSProperties } from 'react';
import EmotionCharacter, { CHARACTER_GLOW } from './EmotionCharacter';
import type { CharacterKey } from './EmotionCharacter';

interface OrbItem {
  key: CharacterKey;
  size: number;
  style: CSSProperties; // 위치 (top/left/right/bottom %)
  delay: string;
  duration: string;
  hideOnMobile?: boolean;
}

// 기억 구슬 홀에 떠다니는 감정 캐릭터 구슬 — 카드 영역(중앙)을 피해 배치.
// 감정 7종 + 조연 2종(부럽·당황). 이미지 9장이 전부라 대기 화면에서
// 네트워크 요청이 사실상 없다(이전 Lottie 방식과 달리 원격 fetch 없음).
const ITEMS: OrbItem[] = [
  // 위쪽
  { key: 'joy', size: 54, style: { top: '7%', right: '8%' }, delay: '0s', duration: '5.5s' },
  { key: 'sadness', size: 42, style: { top: '13%', left: '8%' }, delay: '0.7s', duration: '4.4s' },
  { key: 'envy', size: 34, style: { top: '9%', left: '23%' }, delay: '1.5s', duration: '5s', hideOnMobile: true },
  { key: 'fear', size: 32, style: { top: '20%', right: '20%' }, delay: '2.1s', duration: '4.2s', hideOnMobile: true },
  // 가운데 (카드 옆)
  { key: 'disgust', size: 30, style: { top: '41%', left: '7%' }, delay: '0.3s', duration: '3.6s', hideOnMobile: true },
  { key: 'anxiety', size: 36, style: { top: '37%', right: '7%' }, delay: '2.2s', duration: '4.8s' },
  // 아래쪽 (구슬 선반 근처)
  { key: 'anger', size: 40, style: { bottom: '15%', left: '7%' }, delay: '0s', duration: '6s' },
  { key: 'ennui', size: 38, style: { bottom: '14%', right: '8%' }, delay: '1.2s', duration: '5.5s', hideOnMobile: true },
  { key: 'embarrassment', size: 28, style: { bottom: '7%', left: '24%' }, delay: '0.9s', duration: '4.6s', hideOnMobile: true },
];

interface MemoryOrbsProps {
  /** 분석 중에는 true로 넘겨 둥실 모션을 멈춰 추론에 자원을 양보 */
  paused?: boolean;
}

// props가 paused뿐이라 memo로 부모의 잦은 리렌더(라이브 틱 등)에도 재조정을 건너뜀
function MemoryOrbs({ paused = false }: MemoryOrbsProps) {
  return (
    <div className="memory-orbs" aria-hidden="true">
      {ITEMS.map((item) => (
        <span
          key={item.key}
          className={`memory-orb${item.hideOnMobile ? ' memory-orb-sm-hide' : ''}`}
          style={{
            ...item.style,
            width: item.size,
            height: item.size,
            ['--glow' as string]: CHARACTER_GLOW[item.key],
            animationDelay: item.delay,
            animationDuration: item.duration,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        >
          <EmotionCharacter emotion={item.key} size={item.size} />
        </span>
      ))}
    </div>
  );
}

export default memo(MemoryOrbs);
