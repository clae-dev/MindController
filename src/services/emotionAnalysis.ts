import axios from 'axios';

interface NaverSentimentResponse {
  sentiment: string;
  confidence: number;
}

export class EmotionAnalysisService {
  private clientId: string;
  private clientSecret: string;

  constructor() {
    // 환경 변수에서 Naver API 키 가져오기
    this.clientId = import.meta.env.VITE_NAVER_CLIENT_ID || '';
    this.clientSecret = import.meta.env.VITE_NAVER_CLIENT_SECRET || '';
  }

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
  calculateStressFromFace(emotionScores: Record<string, number>): number {
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

  getRecommendation(stressIndex: number, emotion: string): string {
    if (stressIndex < 33) {
      return '현재 상태가 양호합니다. 긍정적인 마음으로 하루를 보내세요! 😊';
    } else if (stressIndex < 66) {
      return '약간의 스트레스가 있습니다. 깊은 숨을 쉬고 휴식을 취해보세요. 🧘‍♀️';
    } else {
      return '높은 스트레스 상태입니다. 전문가의 도움을 고려해보세요. 💬';
    }
  }
}

export const emotionAnalysisService = new EmotionAnalysisService();
