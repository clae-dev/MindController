import { useEffect, useState } from 'react';

/**
 * 0에서 target까지 부드럽게 카운트업하는 값. 결과 숫자가 또르륵 차오르는 연출용.
 * requestAnimationFrame 콜백의 타임스탬프만 사용하므로 순수성 문제 없음.
 */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let raf = 0;
    let startTs = 0;

    const tick = (ts: number) => {
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
