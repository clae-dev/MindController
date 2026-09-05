import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { perfProfile } from '../utils/tvMode';
import { perfStats } from '../utils/perfStats';
import type { PerfStats } from '../utils/perfStats';

/**
 * 성능 HUD — `?debug=1`일 때만 마운트된다.
 * 개발자도구가 없는 기기(스탠바이미 등 TV 브라우저)에서 백엔드·위임·추론 시간·루프 fps·
 * 실제 캡처 해상도·마지막 에러를 화면에서 바로 읽고 URL 오버라이드로 튜닝하기 위한 용도.
 */

const POLL_MS = 500;

const boxStyle: CSSProperties = {
  position: 'fixed',
  top: 8,
  left: 8,
  zIndex: 9999,
  pointerEvents: 'none',
  padding: '8px 10px',
  borderRadius: 8,
  background: 'rgba(0, 0, 0, 0.72)',
  color: '#d8ffd8',
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: perfProfile.tv ? 14 : 12,
  lineHeight: 1.45,
  whiteSpace: 'pre',
  maxWidth: '60vw',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const fmt = (n: number, digits = 1): string => (n > 0 ? n.toFixed(digits) : '-');

export default function PerfHud() {
  const [snap, setSnap] = useState<PerfStats>(() => ({ ...perfStats }));

  useEffect(() => {
    const id = setInterval(() => setSnap({ ...perfStats }), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const ua = navigator.userAgent;
  const uaTail = ua.length > 70 ? `…${ua.slice(-70)}` : ua;
  const cores = navigator.hardwareConcurrency ?? '-';

  const lines = [
    `mode     ${perfProfile.tv ? 'tv' : 'default'} (${perfProfile.tvSource})`,
    `backend  ${snap.backend}   delegate ${snap.delegate}${perfProfile.delegate === 'CPU' ? ' (forced)' : ''}`,
    `detect   ${fmt(snap.detectMs)} ms   loop ${fmt(snap.loopFps)} fps (target ${(1000 / perfProfile.detectionIntervalMs).toFixed(1)})`,
    `capture  ${perfProfile.captureWidth}x${perfProfile.captureHeight} → ${snap.captureW || '-'}x${snap.captureH || '-'}`,
    `overlay  ${perfProfile.drawOverlay ? 'on' : 'off'}   lottie ${perfProfile.lottie}`,
    `frames   ${snap.frames}   faces ${snap.faces}   errors ${snap.errors}`,
    snap.lastError ? `error    ${snap.lastError.slice(0, 90)}` : null,
    `view     ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}   cores ${cores}`,
    `ua       ${uaTail}`,
  ].filter((l): l is string => l !== null);

  return (
    <div style={boxStyle} aria-hidden="true">
      {lines.join('\n')}
    </div>
  );
}
