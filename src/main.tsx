import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTvModeToDocument, perfProfile } from './utils/tvMode'
import { installErrorHooks } from './utils/perfStats'
import './index.css'
import App from './App.tsx'

// 첫 페인트부터 html[data-tv] CSS가 적용되도록 React 마운트 전에 토글
applyTvModeToDocument()
if (perfProfile.debug) installErrorHooks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
