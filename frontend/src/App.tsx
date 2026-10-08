import { BrowserRouter, Routes, Route } from 'react-router-dom'
import WelcomePage from './pages/WelcomePage'
import LobbyPage from './pages/LobbyPage'
import GamePage from './pages/GamePage'
import ResultPage from './pages/ResultPage'
import ErrorPopup from './components/ErrorPopup'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="/game/:id" element={<GamePage />} />
        <Route path="/result/:id" element={<ResultPage />} />
      </Routes>
      <ErrorPopup />
    </BrowserRouter>
  )
}
