import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import { perfProfile } from '../utils/tvMode';

// lottie-web(약 50KB gzip)은 메인 번들에서 분리해, 애니메이션 이모지가 실제로
// 마운트될 때만 동적 로드한다. 로드 전/실패 시엔 텍스트 이모지로 폴백된다.
// canvas 렌더러(경량 빌드)를 쓴다 — SVG 렌더러는 플레이어마다 SVG DOM을 매 프레임
// 변형해 대기/결과 화면에 여러 개가 동시에 돌면 무겁다. canvas는 DOM 변형이 없다.
const loadLottie = () =>
  import('lottie-web/build/player/lottie_light_canvas').then((m) => m.default);

interface AnimatedEmojiProps {
  emoji: string;
  size?: number;
  label?: string;
  /** true면 애니메이션을 멈춰 메인 스레드를 양보 (분석 중 추론에 자원 집중) */
  paused?: boolean;
  /** false면 Lottie를 아예 로드하지 않고 정적 이모지로 렌더 (대기 화면 동시 플레이어 수 감소). 래퍼의 CSS 모션은 유지됨 */
  animated?: boolean;
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

// 정지 모드: TV 모드(저사양)이거나 시스템이 모션 축소를 원하면 첫 프레임만 그리고 재생하지 않는다.
// 텍스트 이모지 폴백 대신 Lottie 첫 프레임을 쓰는 이유는 TV 브라우저에 컬러 이모지 폰트가 없을 수 있어서.
const isStill = () => perfProfile.lottie === 'still' || prefersReducedMotion();

/**
 * Google Noto Animated Emoji를 Lottie(벡터)로 렌더링.
 * webp(평균 수백 KB~2.7MB) 대신 lottie.json(평균 20~60KB)을 사용해
 * 첫 화면 다운로드를 약 10MB → 1MB대로 줄인다.
 * 세트에 없는 이모지는 일반 텍스트 이모지로 폴백.
 */
export default function AnimatedEmoji({
  emoji,
  size = 28,
  label,
  paused = false,
  animated = true,
}: AnimatedEmojiProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<AnimationItem | null>(null);
  // 비동기 로드 완료 시점에 최신 paused 값을 읽기 위한 ref (초기값은 마운트 시점 paused)
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!animated || failed || !containerRef.current) return;

    const url = `https://fonts.gstatic.com/s/e/notoemoji/latest/${toCodepoint(emoji)}/lottie.json`;
    let cancelled = false;

    Promise.all([loadLottie(), loadLottieData(url)])
      .then(([lottie, data]) => {
        if (cancelled || !containerRef.current) return;
        const anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'canvas',
          loop: true,
          autoplay: !isStill() && !pausedRef.current,
          animationData: data,
        });
        // 정지 모드: 휴식 포즈(0프레임)를 한 번만 렌더 — 이후 rAF 루프 없음
        if (isStill()) anim.goToAndStop(0, true);
        animationRef.current = anim;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      animationRef.current?.destroy();
      animationRef.current = null;
    };
  }, [emoji, failed, animated]);

  // paused 토글에 반응 (정지 모드면 재생하지 않음)
  useEffect(() => {
    const anim = animationRef.current;
    if (!anim) return;
    if (paused) anim.pause();
    else if (!isStill()) anim.play();
  }, [paused]);

  // Lottie 실패했거나 정적 모드면 텍스트 이모지로 렌더 (Lottie 플레이어 미생성)
  if (failed || !animated) {
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
