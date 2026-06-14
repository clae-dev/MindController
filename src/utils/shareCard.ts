import type { AnalysisSummary } from '../types/index';

// 결과 화면과 동일한 아이보리 에디토리얼 팔레트
const C = {
  bg: '#f6f3ec',
  card: '#fffefb',
  ink: '#2e2b26',
  inkSoft: '#7d776b',
  inkFaint: '#a8a193',
  line: '#e6dfd0',
  lineSoft: '#efe9dc',
  sage: '#5d8d76',
  mustard: '#c08f3c',
  maroon: '#b9543f',
  emojiBg: '#f3efe6',
  quoteBg: '#f4f1e8',
};

const LEVEL: Record<AnalysisSummary['stressLevel'], { text: string; color: string }> = {
  low: { text: '여유로워요', color: C.sage },
  medium: { text: '조금 지쳐 있어요', color: C.mustard },
  high: { text: '많이 힘들어요', color: C.maroon },
};

const EMOJI: Record<string, string> = {
  happy: '😊',
  sad: '😢',
  angry: '😠',
  surprised: '😲',
  neutral: '😌',
  disgusted: '🤢',
  fearful: '😨',
};

const SERIF = '"Noto Serif KR", serif';
const SANS = '"Pretendard Variable", Pretendard, sans-serif';

const toCodepoint = (emoji: string) =>
  [...emoji].map((ch) => ch.codePointAt(0)!.toString(16)).join('_');

const loadImage = (src: string, crossOrigin?: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

// 둥근 사각형 경로
const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

// 원형 클립 안에 cover 방식으로 이미지 그리기
const drawCircularImage = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  d: number
) => {
  const r = d / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const scale = Math.max(d / img.width, d / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
};

// 가운데 정렬 텍스트를 폭에 맞춰 줄바꿈하여 그림. 반환: 그린 줄 수
const drawWrapped = (
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  startY: number,
  maxWidth: number,
  lineHeight: number
): number => {
  // 명시적 줄바꿈(\n) 먼저, 각 단락을 다시 폭 기준으로 래핑
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    lines.push(current);
  }
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
  return lines.length;
};

/**
 * 결과를 인스타/카톡 공유용 카드 이미지(1080×1350, 4:5)로 그린다.
 * 결과 화면과 같은 톤(아이보리 + 세리프 + 기관 로고)을 유지.
 */
export async function generateShareCard(result: AnalysisSummary): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // 폰트 로드 보장 (캔버스는 미로드 폰트를 기본 폰트로 대체하므로)
  try {
    await Promise.all([
      document.fonts.load('600 52px "Noto Serif KR"'),
      document.fonts.load('700 84px "Noto Serif KR"'),
      document.fonts.load('600 30px "Pretendard Variable"'),
      document.fonts.load('400 30px "Pretendard Variable"'),
    ]);
  } catch {
    // 폰트 로드 실패 시 시스템 폰트로 폴백
  }

  // 배경 + 카드
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const pad = 44;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 44);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  const cx = W / 2;
  const contentW = W - pad * 2 - 120;

  // 상단 배지
  ctx.font = `600 30px ${SANS}`;
  ctx.fillStyle = C.inkSoft;
  ctx.fillText('🍃  마음 리포트', cx, pad + 78);

  // 감정 이모지 원
  const circleY = pad + 230;
  const r = 96;
  ctx.beginPath();
  ctx.arc(cx, circleY, r, 0, Math.PI * 2);
  ctx.fillStyle = C.emojiBg;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  const emoji = EMOJI[result.primaryEmotion] || '😌';
  try {
    const emojiImg = await loadImage(
      `https://fonts.gstatic.com/s/e/notoemoji/latest/${toCodepoint(emoji)}/512.webp`,
      'anonymous'
    );
    ctx.drawImage(emojiImg, cx - 66, circleY - 66, 132, 132);
  } catch {
    ctx.font = '120px sans-serif';
    ctx.fillText(emoji, cx, circleY + 4);
  }

  // 키워드 (표정 묘사)
  let y = circleY + r + 78;
  ctx.font = `700 50px ${SERIF}`;
  ctx.fillStyle = C.ink;
  const kwLines = drawWrapped(ctx, result.keyword, cx, y, contentW, 64);
  y += kwLines * 64 + 6;

  // 보조 설명
  ctx.font = `400 28px ${SANS}`;
  ctx.fillStyle = C.inkFaint;
  const detailLines = drawWrapped(ctx, result.emotionDetail, cx, y, contentW, 40);
  y += detailLines * 40 + 56;

  // 스트레스 지수
  const lv = LEVEL[result.stressLevel];
  ctx.font = `700 88px ${SERIF}`;
  ctx.fillStyle = lv.color;
  const numText = `${result.stressIndex}`;
  const numW = ctx.measureText(numText).width;
  ctx.textAlign = 'left';
  const groupStart = cx - (numW + 14 + 70) / 2;
  ctx.fillText(numText, groupStart, y);
  ctx.font = `400 34px ${SANS}`;
  ctx.fillStyle = C.inkFaint;
  ctx.fillText('/ 100', groupStart + numW + 14, y + 18);
  ctx.textAlign = 'center';
  y += 78;

  // 게이지 바
  const gw = contentW;
  const gx = cx - gw / 2;
  const gh = 18;
  roundRect(ctx, gx, y, gw, gh, gh / 2);
  ctx.fillStyle = C.lineSoft;
  ctx.fill();
  const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  grad.addColorStop(0, C.sage);
  grad.addColorStop(0.55, C.mustard);
  grad.addColorStop(1, C.maroon);
  const fillW = Math.max(gh, gw * (result.stressIndex / 100));
  roundRect(ctx, gx, y, fillW, gh, gh / 2);
  ctx.fillStyle = grad;
  ctx.fill();
  y += gh + 44;

  // 수준 텍스트
  ctx.font = `700 34px ${SANS}`;
  ctx.fillStyle = lv.color;
  ctx.fillText(lv.text, cx, y);
  y += 70;

  // 오늘의 한마디 박스
  const boxX = pad + 40;
  const boxW = W - pad * 2 - 80;
  ctx.font = `600 34px ${SERIF}`;
  const quoteLineH = 50;
  // 줄 수 미리 측정해 박스 높이 산정
  const measureLines = (text: string, maxW: number) => {
    let total = 0;
    for (const para of text.split('\n')) {
      const words = para.split(' ');
      let cur = '';
      let n = 1;
      for (const word of words) {
        const test = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(test).width > maxW && cur) {
          n += 1;
          cur = word;
        } else {
          cur = test;
        }
      }
      total += n;
    }
    return total;
  };
  const qLineCount = measureLines(result.quote.text, boxW - 96);
  const boxPadV = 40;
  const boxH = boxPadV * 2 + 36 + qLineCount * quoteLineH + 40; // 라벨 + 인용 + 출처
  roundRect(ctx, boxX, y, boxW, boxH, 24);
  ctx.fillStyle = C.quoteBg;
  ctx.fill();
  ctx.strokeStyle = C.lineSoft;
  ctx.lineWidth = 2;
  ctx.stroke();

  let qy = y + boxPadV + 14;
  ctx.font = `700 24px ${SANS}`;
  ctx.fillStyle = C.sage;
  ctx.fillText('오늘의 한마디', cx, qy);
  qy += 50;
  ctx.font = `600 34px ${SERIF}`;
  ctx.fillStyle = C.ink;
  const qn = drawWrapped(ctx, result.quote.text, cx, qy, boxW - 96, quoteLineH);
  qy += qn * quoteLineH + 6;
  ctx.font = `600 26px ${SANS}`;
  ctx.fillStyle = C.inkSoft;
  ctx.fillText(`— ${result.quote.author}`, cx, qy);

  // 하단: 기관 로고 + 출처
  const footY = H - pad - 86;
  try {
    const [vincent, butterfly] = await Promise.all([
      loadImage('/logo-vincent.png'),
      loadImage('/logo-butterfly.png'),
    ]);
    const d = 60;
    drawCircularImage(ctx, vincent, cx - 48, footY, d);
    ctx.font = `400 26px ${SANS}`;
    ctx.fillStyle = C.inkFaint;
    ctx.fillText('×', cx, footY);
    drawCircularImage(ctx, butterfly, cx + 48, footY, d);
  } catch {
    // 로고 로드 실패 시 생략
  }
  ctx.font = `600 24px ${SANS}`;
  ctx.fillStyle = C.inkSoft;
  ctx.fillText('성빈센트청소년회 × 청년챔프단 Butterfly', cx, footY + 58);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('카드 생성 실패'))),
      'image/png'
    );
  });
}

// 브라우저에서 Blob을 파일로 내려받기
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 결과 카드를 공유한다.
 * - 파일 공유 지원 기기(주로 모바일): 공유 시트 → 인스타/카톡 등 선택
 * - 미지원(주로 데스크톱): 이미지 다운로드로 폴백
 * 반환: 'shared' | 'downloaded' | 'cancelled'
 */
export async function shareResultCard(
  result: AnalysisSummary
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await generateShareCard(result);
  const file = new File([blob], 'mind-report.png', { type: 'image/png' });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: '마음 리포트',
        text: `제 마음 리포트예요! 스트레스 지수 ${result.stressIndex}점 · ${result.keyword}`,
      });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
      // 공유 실패 시 다운로드로 폴백
      downloadBlob(blob, 'mind-report.png');
      return 'downloaded';
    }
  }

  downloadBlob(blob, 'mind-report.png');
  return 'downloaded';
}
