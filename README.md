# 마음 들여다보기 · MindController

청소년 행사·부스 체험용 **웹 기반 표정 스트레스 분석 서비스**입니다. 웹캠 앞에서 5초면 표정을 읽어 스트레스 지수와 감정 상태, 그리고 마음에 닿는 한마디를 전해줍니다.

**라이브**: https://mindcontroller-theta.vercel.app

> 성빈센트청소년회 · 한국사회공헌협회 청년챔프단 **Butterfly**가 함께합니다.

## 🎯 주요 기능

- **5초 표정 분석** — 얼굴이 인식되면 자동으로 5초간 분석, 버튼 한 번이면 끝
- **7가지 감정 인식** — MediaPipe 블렌드셰이프(얼굴 근육 52종)로 행복·슬픔·분노·놀람·평온·불쾌·불안을 측정
- **스트레스 지수 (0~100)** — 감정 조합으로 계산, 낮음/보통/높음 3단계 판정
- **풍부한 결과 화면** — 강도별 표정 묘사("잔잔한 미소가 머무는 얼굴"), 감정 분포 차트, 맞춤 조언
- **오늘의 한마디** — 한국 명언·드라마 대사·속담 등 50여 개 문구를 스트레스 수준과 감지된 감정에 맞게 랜덤 제공 (연속 반복 방지)
- **측정할수록 정확해짐** — 측정마다 익명 통계를 기기에 누적해 분포 기반으로 판정을 자동 보정
- **프라이버시 우선** — 영상은 저장되지 않고 브라우저 안에서만 처리, 서버 전송 없음

## 🎨 UI/UX

- 하늘 + 풀밭 + 축제 가랜드 배경에 관람차·회전목마·뛰노는 아이들 이모지가 움직이는 장면
- 아이보리 에디토리얼 카드 디자인 (Noto Serif KR 세리프 헤딩, Pretendard 본문)
- Google Noto Animated Emoji를 **Lottie 벡터**로 렌더링 (webp 대비 약 10배 가벼움)
- 모바일 대응, `prefers-reduced-motion` 지원

## 🛠 기술 스택

- **Frontend**: React 19 + TypeScript + Vite
- **얼굴 인식**: MediaPipe FaceLandmarker (WASM, 블렌드셰이프 출력) — 브라우저 내 추론
- **애니메이션 이모지**: Noto Animated Emoji (Lottie) + lottie-web
- **배포**: Vercel (GitHub `master` push 시 자동 배포)

## 📦 설치 및 실행

```bash
npm install      # 의존성 설치
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 타입체크 + 프로덕션 빌드
```

## 🚀 사용 방법

1. 브라우저에서 접속 후 **"마음 들여다보기"** 버튼 클릭
2. 카메라 권한 허용
3. 얼굴이 인식되면 자동으로 5초간 분석
4. 결과 확인 (스트레스 지수·감정 분포·조언·오늘의 한마디)
5. "한 번 더 해볼래요" 버튼으로 처음으로 돌아가 다음 사람이 이용

## 📋 프로젝트 구조

```
src/
├── components/
│   ├── StressAnalyzer.tsx        # 메인 화면 + 분석 흐름 (카메라, 감지 루프, 타이머)
│   ├── Results.tsx               # 결과 화면 (게이지, 감정 분포, 명언, 자동 복귀)
│   ├── AnimatedEmoji.tsx         # Noto 애니메이션 이모지 (Lottie, 정적 폴백)
│   ├── PlayfulEmojis.tsx         # 배경 장식 (가랜드, 놀이공원, 아이들)
│   └── BrandFooter.tsx           # 운영 기관 공동 브랜딩 푸터
├── services/
│   ├── faceDetection.ts          # MediaPipe 로드/워밍업, 블렌드셰이프 → 감정 점수
│   ├── emotionAnalysis.ts        # 스트레스 지수, 표정 묘사, 명언 선택
│   └── populationCalibration.ts  # 분포 기반 자동 보정 (Welford 통계)
├── types/index.ts                # 공용 타입
└── styles/                       # 화면별 CSS (토큰은 index.css)

public/
├── models/face_landmarker.task   # 얼굴 랜드마크 모델
└── mediapipe/wasm/               # MediaPipe WASM 런타임
```

## 📊 분석 로직 개요

1. 100ms마다 프레임에서 얼굴 랜드마크 + 블렌드셰이프 추출 (딥러닝)
2. 블렌드셰이프 가중 조합으로 감정 점수 산출 — 예: 행복 = 미소×1.2 + 볼 올라감×0.4
3. 5초 평균 → 스트레스 지수 = 슬픔+분노+불쾌+불안×0.8+놀람×0.3−행복×0.5
4. 기기 누적 분포(15회 이상)에 비추어 z-점수 보정 후 단계 판정 (0~32 낮음 / 33~65 보통 / 66~100 높음)

## 📝 주의사항

- **카메라 필요** — 마이크는 사용하지 않습니다
- **HTTPS 필수** — 웹캠 권한 때문에 로컬(`localhost`) 또는 HTTPS 환경에서만 동작
- **밝은 조명** 권장 — 표정 인식 정확도에 영향
- 최신 Chrome/Edge/Safari 권장

## 🌐 배포

GitHub `master` 브랜치에 push하면 Vercel이 자동으로 프로덕션에 배포합니다.

```bash
git push origin master   # → 자동 배포
vercel --prod            # 수동 배포도 가능
```

`/models/*`, `/mediapipe/*` 정적 자산은 `vercel.json`에서 1년 불변 캐시로 설정되어 있습니다.

---

**운영**: 성빈센트청소년회 × 한국사회공헌협회 청년챔프단 Butterfly
**마지막 업데이트**: 2026-06-13