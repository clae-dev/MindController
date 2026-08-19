import type { CSSProperties } from 'react';

/**
 * 앱의 감정 7종 ↔ 감정 캐릭터.
 * 원본 이미지를 원형으로 잘라 알파를 넣어둬서, 그대로 두면 기억 구슬이 된다.
 */
export type CharacterKey =
  | 'joy'
  | 'sadness'
  | 'anger'
  | 'disgust'
  | 'fear'
  | 'anxiety'
  | 'ennui'
  | 'envy'
  | 'embarrassment';

/** EmotionScores의 키 → 캐릭터 */
export const EMOTION_CHARACTER: Record<string, CharacterKey> = {
  happy: 'joy',
  sad: 'sadness',
  angry: 'anger',
  disgusted: 'disgust',
  surprised: 'fear',
  fearful: 'anxiety',
  neutral: 'ennui',
};

/** 캐릭터별 발광색 — 구슬 글로우와 게이지에 함께 쓴다 */
export const CHARACTER_GLOW: Record<CharacterKey, string> = {
  joy: 'var(--joy)',
  sadness: 'var(--sad)',
  anger: 'var(--anger)',
  disgust: 'var(--disgust)',
  fear: 'var(--fear)',
  anxiety: 'var(--anxiety)',
  ennui: 'var(--ennui)',
  envy: '#2fb6a8',
  embarrassment: '#e87ba8',
};

/** 캐릭터 한글 이름 (화면 문구용) */
export const CHARACTER_NAME: Record<CharacterKey, string> = {
  joy: '기쁨',
  sadness: '슬픔',
  anger: '버럭',
  disgust: '까칠',
  fear: '소심',
  anxiety: '불안',
  ennui: '평온',
  envy: '부럽',
  embarrassment: '당황',
};

/** 감정 키로 바로 발광색을 얻는다 (분포 바 등에서 사용) */
export const emotionGlow = (emotion: string): string => {
  const key = EMOTION_CHARACTER[emotion];
  return key ? CHARACTER_GLOW[key] : 'var(--ink-faint)';
};

interface EmotionCharacterProps {
  /** 감정 키(happy…) 또는 캐릭터 키(joy…) 둘 다 받는다 */
  emotion: string;
  size?: number;
  /** 히어로/경보처럼 크게 쓸 때 512px 원본을 사용 */
  large?: boolean;
  /** 구슬 유리 반사와 글로우를 입힌다 */
  orb?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const resolve = (emotion: string): CharacterKey =>
  (EMOTION_CHARACTER[emotion] as CharacterKey | undefined) ??
  (emotion as CharacterKey);

export default function EmotionCharacter({
  emotion,
  size = 48,
  large = false,
  orb = false,
  label,
  className,
  style,
}: EmotionCharacterProps) {
  const key = resolve(emotion);
  const glow = CHARACTER_GLOW[key] ?? 'var(--ink-faint)';
  // -lg 원본은 기쁨·버럭만 준비돼 있다
  const src =
    large && (key === 'joy' || key === 'anger')
      ? `/characters/${key}-lg.webp`
      : `/characters/${key}.webp`;

  return (
    <span
      className={`emotion-character${orb ? ' is-orb' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, ['--glow' as string]: glow, ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
