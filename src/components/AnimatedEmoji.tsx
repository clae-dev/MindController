import { useState } from 'react';

interface AnimatedEmojiProps {
  emoji: string;
  size?: number;
  label?: string;
}

// 이모지 문자열 → Noto Animated Emoji URL 코드포인트 (fe0f 포함, '_' 연결)
const toCodepoint = (emoji: string) =>
  [...emoji].map((ch) => ch.codePointAt(0)!.toString(16)).join('_');

/**
 * Google Noto Animated Emoji (fonts.gstatic.com) 렌더링.
 * 애니메이션 세트에 없는 이모지는 onError로 일반 텍스트 이모지에 폴백.
 */
export default function AnimatedEmoji({ emoji, size = 28, label }: AnimatedEmojiProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        role="img"
        aria-label={label ?? emoji}
        style={{ fontSize: size * 0.82, lineHeight: 1 }}
      >
        {emoji}
      </span>
    );
  }

  const cp = toCodepoint(emoji);
  const base = `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/512`;

  return (
    <picture style={{ display: 'inline-flex' }}>
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img
        src={`${base}.gif`}
        alt={label ?? emoji}
        width={size}
        height={size}
        style={{ display: 'block' }}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </picture>
  );
}
