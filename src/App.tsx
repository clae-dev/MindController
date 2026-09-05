import StressAnalyzer from './components/StressAnalyzer'
import PerfHud from './components/PerfHud'
import { perfProfile } from './utils/tvMode'
import './App.css'

function App() {
  return (
    <>
      {/* ?debug=1 — 개발자도구 없는 기기(TV)용 성능 HUD */}
      {perfProfile.debug && <PerfHud />}
      <StressAnalyzer />
    </>
  )
}

export default App
