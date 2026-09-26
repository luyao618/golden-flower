import { lazy, Suspense } from 'react'
import LoadBoundary from './LoadBoundary'

// Keep the literal build-time condition here: Vite eliminates the other import
// tree, including its CSS, fixtures, stores and transport side effects.
const SelectedApp = import.meta.env.VITE_WEB_GAME_REBUILD === '1'
  ? lazy(() => import('./WebGameApp'))
  : lazy(() => import('./LegacyApp'))

export default function AppEntry() {
  return <LoadBoundary>
    <Suspense fallback={<p role="status">正在打开牌室…</p>}>
      <SelectedApp />
    </Suspense>
  </LoadBoundary>
}
