import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import ResultPage from '../ResultPage'
import { useGameStore } from '../../stores/gameStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { GameState } from '../../types/game'

vi.mock('../../components/Settlement/AgentSummaryCard', () => ({ default: () => null }))
const fetchMock = vi.fn()
const snapshot: GameState = {
  game_id: 'g1', status: 'finished', config: { initial_chips: 500, ante: 10, max_bet: 200, max_turns: 10 },
  players: [{ id: 'p1', name: 'Remembered player', player_type: 'human', avatar: '', chips: 500,
    status: 'active_blind', hand: null, model_id: null, total_bet_this_round: 0 }],
  current_round: null, round_history: [],
}
const ok = (body: GameState) => ({ ok: true, json: async () => body })

beforeEach(() => {
  useGameStore.getState().reset()
  useSessionStore.setState({ sessions: {} })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function Navigation() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/result/g2')}>Switch result</button>
}
function openResult() {
  return render(<MemoryRouter initialEntries={['/result/g1']}><Navigation /><Routes>
    <Route path="/result/:id" element={<ResultPage />} />
    <Route path="/" element={<div>Home</div>} />
  </Routes></MemoryRouter>)
}

it('requires remembered identity even when another game is cached', () => {
  useGameStore.getState().setGameState({ ...snapshot, game_id: 'other' })
  openResult()
  expect(screen.getByText(/缺少.*身份/)).toBeInTheDocument()
  expect(screen.queryByText('Remembered player')).not.toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '返回大厅' }))
  expect(screen.getByText('Home')).toBeInTheDocument()
})

it('loads a cold result URL only with the remembered viewer', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockResolvedValue(ok(snapshot))
  openResult()
  await screen.findByText('Remembered player')
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1?player_id=p1')
})

it.each([403, 404])('recovers from a rejected viewer or expired result (%s)', async (status) => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ detail: '会话不可用' }) })
  openResult()
  await screen.findByText('会话不可用')
  expect(screen.queryByText('Remembered player')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /重试|重连/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '返回大厅' })).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledOnce()
})

it.each([
  { ...snapshot, game_id: 'other' },
  { ...snapshot, players: [{ ...snapshot.players[0], id: 'other-player' }] },
])('rejects a snapshot that does not match the remembered session', async (response) => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockResolvedValue(ok(response))
  openResult()
  await screen.findByText(/身份不匹配/)
  expect(screen.queryByText('Remembered player')).not.toBeInTheDocument()
})

it('never renders cached players or a late result from a different route', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  useSessionStore.getState().remember('g2', 'p2')
  useGameStore.getState().setGameState({ ...snapshot, game_id: 'cached' })
  let resolveOld!: (value: ReturnType<typeof ok>) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce(ok({ ...snapshot, game_id: 'g2', players: [{ ...snapshot.players[0], id: 'p2', name: 'New player' }] }))
  openResult()
  expect(screen.queryByText('Remembered player')).not.toBeInTheDocument()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Switch result' }))
  await screen.findByText('New player')
  expect(fetchMock.mock.calls[1][0]).toBe('/api/game/g2?player_id=p2')
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () => resolveOld(ok(snapshot)))
  expect(screen.queryByText('Remembered player')).not.toBeInTheDocument()
  expect(screen.getByText('New player')).toBeInTheDocument()
})
