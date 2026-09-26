import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Shell from './Shell'
import Status from '../ui/Status'
import '../styles/web-game.css'

const HomePage = lazy(() => import('./pages/HomePage'))
const ScenarioPage = lazy(() => import('./pages/ScenarioPage'))
const UnavailablePage = lazy(() => import('./pages/UnavailablePage'))

export default function WebGameApp() {
  useEffect(() => {
    const previous = document.documentElement.lang
    document.documentElement.lang = 'zh-CN'
    return () => { document.documentElement.lang = previous }
  }, [])

  return <BrowserRouter>
    <div className="gf-app">
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Suspense fallback={<Status>正在打开牌室…</Status>}><HomePage /></Suspense>} />
          <Route path="scenarios" element={<Navigate to="/scenarios/waiting" replace />} />
          <Route path="scenarios/:scenarioId" element={<Suspense fallback={<Status>正在打开场景…</Status>}><ScenarioPage /></Suspense>} />
          <Route path="game/:id" element={<Suspense fallback={<Status>正在打开页面…</Status>}><UnavailablePage kind="live" /></Suspense>} />
          <Route path="result/:id" element={<Suspense fallback={<Status>正在打开页面…</Status>}><UnavailablePage kind="live" /></Suspense>} />
          <Route path="*" element={<Suspense fallback={<Status>正在打开页面…</Status>}><UnavailablePage /></Suspense>} />
        </Route>
      </Routes>
    </div>
  </BrowserRouter>
}
