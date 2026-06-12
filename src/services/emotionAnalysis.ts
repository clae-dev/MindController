import type { EmotionScores, Quote } from '../types/index';

// 스트레스 수준별 응원 문구 · 명언
const QUOTES: Record<'low' | 'medium' | 'high', Quote[]> = {
  low: [
    { text: '행복은 습관이다. 그것을 몸에 지니라.', author: '엘버트 허버드' },
    { text: '오늘이라는 날은 두 번 다시 오지 않는다.', author: '단테' },
    { text: '웃음은 마음의 조깅이다.', author: '노먼 커즌스' },
    { text: '작은 것에 감사하는 사람이 큰 행복을 얻는다.', author: '괴테' },
    { text: '지금의 평온함을 오래 기억해 두세요. 당신이 만든 풍경이에요.', author: '오늘의 마음' },
  ],
  medium: [
    { text: '휴식은 게으름이 아니라 회복이다.', author: '존 러벅' },
    { text: '천천히 가는 것을 두려워하지 말고, 멈춰 서는 것을 두려워하라.', author: '중국 속담' },
    { text: '나무는 바람이 불 때 뿌리를 더 깊이 내린다.', author: '작자 미상' },
    { text: '쉼표는 문장을 망치지 않는다. 오히려 숨을 고르게 한다.', author: '오늘의 마음' },
    { text: '오늘 하루쯤 천천히 걸어도, 당신의 길은 사라지지 않아요.', author: '오늘의 마음' },
  ],
  high: [
    { text: '이 또한 지나가리라.', author: '페르시아 격언' },
    { text: '가장 어두운 시간은 해 뜨기 직전이다.', author: '토머스 풀러' },
    { text: '밤이 깊을수록 별은 더 밝게 빛난다.', author: '도스토옙스키' },
    { text: '멈추지 않는 한, 얼마나 천천히 가는지는 중요하지 않다.', author: '공자' },
    { text: '오늘 많이 힘들었다는 건, 그만큼 버텨냈다는 뜻이에요.', author: '오늘의 마음' },
  ],
};

export class EmotionAnalysisService {
  async analyzeEmotionFromText(text: string): Promise<{
    emotion: string;
    keyword: string;
    confidence: number;
  }> {
    if (!text.trim()) {
      return {
        emotion: 'neutral',
        keyword: '특별한 감정 없음',
        confidence: 0,
      };
    }

    try {
      // Naver CLOVA API를 사용하거나, 간단한 키워드 기반 분석 사용
      // 실제 구현에서는 Naver API 호출
      return this.analyzeWithKeywords(text);
    } catch (error) {
      console.error('Failed to analyze emotion:', error);
      return {
        emotion: 'neutral',
        keyword: '분석 오류',
        confidence: 0,
      };
    }
  }

  private analyzeWithKeywords(text: string): {
    emotion: string;
    keyword: string;
    confidence: number;
  } {
    // 한국어 감정 키워드 사전
    const emotionKeywords = {
      happy: ['행복', '좋다', '즐겁다', '기쁘다', '행운', '축하', '최고'],
      sad: ['슬프다', '우울', '외로움', '낙심', '후회', '안타깝다'],
      angry: ['화난다', '분노', '화', '억울', '짜증', '불쾌'],
      surprised: ['놀라다', '깜짝', '예상외', '충격'],
      fearful: ['두렵다', '무서워', '걱정', '불안', '공포'],
      disgusted: ['혐오', '싫다', '역겨움', '답답'],
    };

    let maxScore = 0;
    let primaryEmotion = 'neutral';
    let detectedKeyword = '';

    for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          maxScore++;
          primaryEmotion = emotion;
          detectedKeyword = keyword;
        }
      }
    }

    const confidence = Math.min((maxScore / (text.length / 3)) * 100, 100);

    return {
      emotion: primaryEmotion,
      keyword: detectedKeyword || text.substring(0, 20),
      confidence: maxScore > 0 ? confidence : 0,
    };
  }

  // 표정만으로 스트레스 지수 계산 (음성/텍스트 없이)
  calculateStressFromFace(emotionScores: Partial<EmotionScores>): number {
    const negative =
      (emotionScores.sad || 0) +
      (emotionScores.angry || 0) +
      (emotionScores.disgusted || 0);
    const surprised = (emotionScores.surprised || 0) * 0.3;
    const positive = (emotionScores.happy || 0) * 0.5;

    const stress = negative + surprised - positive;
    return Math.min(Math.max(stress, 0), 100);
  }

  calculateStressFromAnalysis(
    emotionScores: Record<string, number>,
    voiceTone: Record<string, number>,
    textSentiment: { emotion: string; confidence: number }
  ): number {
    // 여러 지표로 스트레스 지수 계산
    const emotionStress = this.getEmotionStress(emotionScores);
    const voiceStress = voiceTone.stressLevel || 0;
    const sentimentStress = this.getSentimentStress(textSentiment);

    // 가중치 적용
    const totalStress = (emotionStress * 0.3 + voiceStress * 0.4 + sentimentStress * 0.3);
    return Math.min(Math.max(totalStress, 0), 100);
  }

  private getEmotionStress(scores: Record<string, number>): number {
    const stressEmotions = ['sad', 'angry', 'afraid', 'disgusted'];
    let totalStress = 0;

    for (const emotion of stressEmotions) {
      totalStress += scores[emotion] || 0;
    }

    return Math.min(totalStress / stressEmotions.length, 100);
  }

  private getSentimentStress(sentiment: { emotion: string; confidence: number }): number {
    const negativeEmotions = ['sad', 'angry', 'fearful', 'disgusted'];
    const isNegative = negativeEmotions.includes(sentiment.emotion);

    return isNegative ? sentiment.confidence : 0;
  }

  getQuote(level: 'low' | 'medium' | 'high'): Quote {
    const pool = QUOTES[level];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // 문장 사이 줄바꿈(\n)은 결과 화면에서 white-space: pre-line으로 표시됨
  getRecommendation(stressIndex: number, _emotion: string): string {
    if (stressIndex < 33) {
      return '현재 상태가 양호합니다.\n긍정적인 마음으로 하루를 보내세요! 😊';
    } else if (stressIndex < 66) {
      return '약간의 스트레스가 있습니다.\n깊은 숨을 쉬고 휴식을 취해보세요. 🧘‍♀️';
    } else {
      return '높은 스트레스 상태입니다.\n전문가의 도움을 고려해보세요. 💬';
    }
  }
}

export const emotionAnalysisService = new EmotionAnalysisService();
