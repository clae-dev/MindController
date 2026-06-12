import { useEffect, useRef, useState } from 'react';
import lottie from 'lottie-web/build/player/lottie_light';

interface AnimatedEmojiProps {
  emoji: string;
  size?: number;
  label?: string;
}

// 이모지 문자열 → Noto Animated Emoji URL 코드포인트 (fe0f 포함, '_' 연결)
const toCodepoint = (emoji: string) =>
  [...emoji].map((ch) => ch.codePointAt(0)!.toString(16)).join('_');

// 같은 이모지를 여러 곳에서 써도 JSON은 한 번만 다운로드
const lottieDataCache = new Map<string, Promise<unknown>>();

const loadLottieData = (url: string): Promise<unknown> => {
  let cached = lottieDataCache.get(url);
  if (!cached) {
    cached = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`lottie fetch failed: ${res.status}`);
      return res.json();
    });
    // 실패한 항목은 캐시에서 제거해 다음 마운트 때 재시도 가능하게
    cached.catch(() => lottieDataCache.delete(url));
    lottieDataCache.set(url, cached);
  }
  return cached;
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Google Noto Animated Emoji를 Lottie(벡터)로 렌더링.
 * webp(평균 수백 KB~2.7MB) 대신 lottie.json(평균 20~60KB)을 사용해
 * 첫 화면 다운로드를 약 10MB → 1MB대로 줄인다.
 * 세트에 없는 이모지는 일반 텍스트 이모지로 폴백.
 */
export default function AnimatedEmoji({ emoji, size = 28, label }: AnimatedEmojiProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed || !containerRef.current) return;

    const url = `https://fonts.gstatic.com/s/e/notoemoji/latest/${toCodepoint(emoji)}/lottie.json`;
    let cancelled = false;
    let animation: ReturnType<typeof lottie.loadAnimation> | null = null;

    loadLottieData(url)
      .then((data) => {
        if (cancelled || !containerRef.current) return;
        animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: !prefersReducedMotion(),
          animationData: data,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [emoji, failed]);

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

  return (
    <span
      ref={containerRef}
      role="img"
      aria-label={label ?? emoji}
      style={{ display: 'inline-flex', width: size, height: size }}
    />
  );
}
