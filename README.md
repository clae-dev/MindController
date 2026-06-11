# MindController - 스트레스 분석 시스템

부스 체험용 웹 기반 음성 + 표정 자동 분석 시스템입니다. 사용자의 1분간의 음성과 표정을 실시간으로 분석하여 스트레스 지수와 감정 상태를 제공합니다.

## 🎯 기능

- **표정 분석**: 웹캠을 통한 실시간 얼굴 표정 인식
- **음성 분석**: 마이크를 통한 음성 톤, 속도, 음량 분석
- **텍스트 분석**: 음성을 텍스트로 변환 후 감정 분석
- **스트레스 지수 계산**: 표정 + 음성 + 텍스트 종합 분석
- **실시간 결과**: 1분 분석 후 즉시 결과 제시
- **한국어 지원**: 완벽한 한국어 음성 인식 및 분석

## 🛠 기술 스택

- **Frontend**: React 19 + TypeScript
- **빌드**: Vite
- **얼굴 감지**: MediaPipe
- **음성 처리**: Web Audio API + Web Speech API
- **감정 분석**: TensorFlow.js + Naver CLOVA (선택사항)
- **API 호출**: Axios

## 📦 설치

```bash
# 프로젝트 디렉토리로 이동
cd C:\workspace\MindController

# 의존성 설치
npm install

# 개발 서버 시작
npm run dev

# 프로덕션 빌드
npm run build
```

## 🚀 사용 방법

1. `npm run dev`로 개발 서버 시작
2. 브라우저에서 `http://localhost:5173` 접속
3. "분석 시작" 버튼 클릭
4. 웹캠과 마이크 접근 권한 허용
5. 자연스럽게 1분간 대화하거나 표현하기
6. 분석 완료 후 결과 확인

## 📋 프로젝트 구조

```
src/
├── components/
│   ├── StressAnalyzer.tsx      # 메인 분석 컴포넌트
│   └── Results.tsx             # 결과 표시 컴포넌트
├── services/
│   ├── faceDetection.ts        # 얼굴 감지 및 감정 분석
│   ├── speechRecognition.ts    # 음성 인식 및 톤 분석
│   └── emotionAnalysis.ts      # 텍스트 감정 분석
├── types/
│   └── index.ts                # 타입 정의
├── styles/
│   ├── StressAnalyzer.css      # 분석 화면 스타일
│   └── Results.css             # 결과 화면 스타일
├── App.tsx
└── main.tsx
```

## 🔧 환경 설정

### 선택사항: Naver CLOVA Sentiment API

더 정확한 텍스트 감정 분석을 위해 Naver CLOVA API를 사용할 수 있습니다.

1. `.env` 파일 생성 (`.env.example` 참고)
2. Naver 개발자 센터에서 API 키 발급
3. 환경 변수 설정

```env
VITE_NAVER_CLIENT_ID=your_client_id
VITE_NAVER_CLIENT_SECRET=your_client_secret
```

## 📊 분석 결과 항목

- **스트레스 지수 (0-100)**: 낮음(0-33), 중간(34-66), 높음(67-100)
- **주요 감정**: 행복, 슬픔, 분노, 놀람, 중립, 혐오
- **감지된 키워드**: 음성 분석에서 추출된 주요 키워드
- **권장사항**: 스트레스 수준에 따른 맞춤 조언

## 🌐 배포

### Vercel 배포

```bash
npm install -g vercel
vercel
```

### 다른 호스팅 서비스

1. 프로덕션 빌드: `npm run build`
2. `dist` 폴더 배포
3. 환경 변수 설정

## 📝 주의사항

- **웹캠 & 마이크**: 정확한 분석을 위해 모두 필요합니다
- **밝은 환경**: 표정 인식을 위해 충분한 조명이 필요합니다
- **조용한 환경**: 음성 인식을 위해 배경 잡음이 적어야 합니다
- **브라우저 지원**: 최신 Chrome, Firefox, Safari 권장

## 🔄 개선 사항

- [ ] MediaPipe 모델로 더 정확한 얼굴 감지
- [ ] TensorFlow.js 감정 분류 모델 학습
- [ ] Naver CLOVA API 통합
- [ ] 사용자 통계 저장 기능
- [ ] 다국어 지원
- [ ] 모바일 최적화

---

**만든이**: Claude Code  
**마지막 업데이트**: 2026-06-12
