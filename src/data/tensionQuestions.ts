/**
 * 긴장 챌린지용 가벼운 질문 풀. 진실/거짓을 판별하는 것이 아니라
 * "답하는 순간 긴장하는지"를 보는 재미용 질문이다.
 */

export const TENSION_QUESTIONS: string[] = [
  '지금 긴장하고 있나요?',
  '오늘 거짓말을 한 적이 있나요?',
  '비밀을 숨기고 있나요?',
  '방금 한 말은 진심인가요?',
  '몰래 좋아하는 사람이 있나요?',
  '다이어트 중 몰래 야식을 먹은 적 있나요?',
  '읽고 답 안 한 메시지가 있나요?',
  '지금 이 결과가 신경 쓰이나요?',
  '최근에 약속을 어긴 적 있나요?',
  '카메라 앞이라 떨리나요?',
];

const LAST_KEY = 'mc-last-tension-questions-v1';

// 직전에 쓰지 않은 질문을 우선해 count개 무작위 선택
export function pickQuestions(count: number): string[] {
  let lastUsed: string[] = [];
  try {
    lastUsed = JSON.parse(localStorage.getItem(LAST_KEY) ?? '[]');
  } catch {
    lastUsed = [];
  }

  const fresh = TENSION_QUESTIONS.filter((q) => !lastUsed.includes(q));
  const pool = fresh.length >= count ? fresh : [...TENSION_QUESTIONS];

  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));

  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(picked));
  } catch {
    // 저장 실패는 무시
  }
  return picked;
}
