// 운영 기관 공동 브랜딩 푸터 — 첫 화면과 결과 화면 하단에 공통 표시
export default function BrandFooter() {
  return (
    <footer className="brand-footer">
      <div className="brand-logos">
        <img
          src="/logo-vincent.png"
          alt="성빈센트청소년회 로고"
          className="brand-logo"
        />
        <span className="brand-cross" aria-hidden="true">
          ×
        </span>
        <img
          src="/logo-butterfly.png"
          alt="청년챔프단 Butterfly 로고"
          className="brand-logo"
        />
      </div>
      <p className="brand-caption">
        <strong>성빈센트청소년회</strong> · 한국사회공헌협회 청년챔프단{' '}
        <strong>Butterfly</strong>가 함께합니다
      </p>
    </footer>
  );
}
