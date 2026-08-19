import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { EmotionScores } from '../types/index';
import EmotionCharacter, {
  EMOTION_CHARACTER,
  CHARACTER_GLOW,
  CHARACTER_NAME,
} from './EmotionCharacter';

const ORDER: Array<keyof EmotionScores> = [
  'happy',
  'sad',
  'angry',
  'disgusted',
  'surprised',
  'fearful',
  'neutral',
];

export interface EmotionConsoleHandle {
  update(scores: EmotionScores): void;
}

/**
 * 마음 본부 콘솔 — 감정 7종 레버.
 * 측정 중 10fps로 들어오는 점수를 DOM에 직접 반영한다. 부모(StressAnalyzer)를
 * 리렌더하지 않도록 TensionDetector의 LiveGauge와 같은 imperative 핸들 패턴을 쓴다.
 */
const EmotionConsole = forwardRef<EmotionConsoleHandle>(function EmotionConsole(
  _props,
  ref
) {
  const fills = useRef<Array<HTMLSpanElement | null>>([]);
  const levers = useRef<Array<HTMLDivElement | null>>([]);
  const dominant = useRef<number>(0);

  useImperativeHandle(
    ref,
    () => ({
      update(scores) {
        let best = -1;
        let bestIndex = 0;

        ORDER.forEach((key, i) => {
          const value = Math.max(0, Math.min(100, scores[key]));
          const fill = fills.current[i];
          if (fill) fill.style.height = `${value}%`;
          if (value > best) {
            best = value;
            bestIndex = i;
          }
        });

        // 우세 감정이 바뀔 때만 클래스를 갈아끼운다 (매 틱 DOM 변경 최소화)
        if (bestIndex !== dominant.current) {
          levers.current[dominant.current]?.classList.remove('is-on');
          levers.current[bestIndex]?.classList.add('is-on');
          dominant.current = bestIndex;
        }
      },
    }),
    []
  );

  return (
    <div className="emotion-console">
      <p className="console-title">감정 콘솔</p>
      <div className="console-levers">
        {ORDER.map((key, i) => {
          const character = EMOTION_CHARACTER[key];
          return (
            <div
              key={key}
              className={`lever${i === 0 ? ' is-on' : ''}`}
              ref={(el) => {
                levers.current[i] = el;
              }}
              style={{ ['--glow' as string]: CHARACTER_GLOW[character] }}
            >
              <EmotionCharacter
                emotion={key}
                size={30}
                className="lever-face"
              />
              <span className="lever-track">
                <span
                  className="lever-fill"
                  ref={(el) => {
                    fills.current[i] = el;
                  }}
                />
              </span>
              <span className="lever-name">{CHARACTER_NAME[character]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default EmotionConsole;
