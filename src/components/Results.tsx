import type { AnalysisSummary } from '../types/index';
import '../styles/Results.css';

interface ResultsProps {
  result: AnalysisSummary;
  onReset: () => void;
}

export default function Results({ result, onReset }: ResultsProps) {
  const getStressColor = (level: string) => {
    switch (level) {
      case 'low':
        return '#4CAF50'; // 초록색
      case 'medium':
        return '#FF9800'; // 주황색
      case 'high':
        return '#F44336'; // 빨강색
      default:
        return '#999';
    }
  };

  const getEmotionEmoji = (emotion: string) => {
    const emojis: Record<string, string> = {
      happy: '😊',
      sad: '😢',
      angry: '😠',
      surprised: '😲',
      neutral: '😐',
      disgusted: '🤢',
      afraid: '😨',
    };
    return emojis[emotion] || '😐';
  };

  const getStressLevelText = (level: string) => {
    switch (level) {
      case 'low':
        return '낮음';
      case 'medium':
        return '중간';
      case 'high':
        return '높음';
      default:
        return '알 수 없음';
    }
  };

  return (
    <div className="results-container">
      <div className="results-card">
        <h1>📊 분석 결과</h1>

        {/* 스트레스 지수 */}
        <div className="stress-section">
          <h2>스트레스 지수</h2>
          <div className="stress-gauge">
            <div
              className="stress-meter"
              style={{
                background: `linear-gradient(to right, #4CAF50 0%, #FF9800 50%, #F44336 100%)`,
                position: 'relative',
              }}
            >
              <div
                className="stress-pointer"
                style={{
                  left: `${result.stressIndex}%`,
                  background: getStressColor(result.stressLevel),
                }}
              />
            </div>
            <div className="stress-value">
              <span className="number">{result.stressIndex}</span>
              <span className="label">/100</span>
            </div>
          </div>
          <p className="stress-level">
            스트레스 수준: <strong>{getStressLevelText(result.stressLevel)}</strong>
          </p>
        </div>

        {/* 주요 감정 */}
        <div className="emotion-section">
          <h2>주요 감정</h2>
          <div className="emotion-display">
            <span className="emotion-emoji">{getEmotionEmoji(result.primaryEmotion)}</span>
            <span className="emotion-text">{result.primaryEmotion}</span>
          </div>
        </div>

        {/* 감지된 키워드 */}
        <div className="keyword-section">
          <h2>감지된 키워드</h2>
          <div className="keyword-badge">{result.keyword}</div>
        </div>

        {/* 권장사항 */}
        <div className="recommendation-section">
          <h2>💡 조언</h2>
          <p className="recommendation-text">{result.recommendation}</p>
        </div>

        {/* 버튼 */}
        <div className="action-buttons">
          <button className="reset-button" onClick={onReset}>
            다시 분석하기
          </button>
        </div>

        {/* 분석 정보 */}
        <div className="analysis-info">
          <small>분석 시간: {result.analyzedTime}초</small>
        </div>
      </div>
    </div>
  );
}
