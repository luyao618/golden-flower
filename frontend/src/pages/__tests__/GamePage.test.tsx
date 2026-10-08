import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import GamePage from '../GamePage'
import { useGameStore } from '../../stores/gameStore'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { GameState, ServerEvent } from '../../types/game'

// Leave session/API/game hooks real; replace only the socket and animation-heavy children.
const transport = vi.hoisted(() => ({
  status: 'connected', terminalCloseCode: null as number | null, sendAction: vi.fn(() => true), sendChatMessage: vi.fn(() => true),
  sendStartRound: vi.fn(() => true), disconnect: vi.fn(), reconnect: vi.fn(),
  config: null as null | { gameId: string; playerId: string; onMessage: (event: ServerEvent) => void },
}))
vi.mock('../../hooks/useWebSocket', () => ({ useWebSocket: (config: typeof transport.config) => {
  transport.config = config
  return { ...transport, status: config ? transport.status : 'disconnected' }
} }))
vi.mock('../../components/Table/TableLayout', () => ({ default: () => <div>Real table</div> }))
vi.mock('../../components/Table/ChatPanel', () => ({ default: () => null }))
vi.mock('../../components/Thought', () => ({ ThoughtDrawer: () => null }))
vi.mock('../../components/CopilotErrorModal', () => ({ default: () => null }))
const fetchMock = vi.fn()
const snapshot: GameState = {
  game_id: 'g1', status: 'playing', config: { initial_chips: 500, ante: 10, max_bet: 200, max_turns: 10 },
  players: [
    { id: 'p1', name: 'Me', player_type: 'human', avatar: '', chips: 490, status: 'active_seen', hand: [{ suit: 'hearts', rank: 14 }, { suit: 'spades', rank: 13 }, { suit: 'clubs', rank: 12 }], model_id: null, total_bet_this_round: 10 },
    { id: 'p2', name: 'AI', player_type: 'ai', avatar: '', chips: 490, status: 'active_blind', hand: null, model_id: 'm1', total_bet_this_round: 10 },
  ],
  current_round: { round_number: 1, pot: 20, current_bet: 10, dealer_index: 1, current_player_index: 0, actions: [], phase: 'betting', turn_count: 1, max_turns: 10 }, round_history: [],
}

beforeEach(() => {
  useGameStore.getState().reset()
  useUIStore.getState().resetUI()
  useSessionStore.setState({ sessions: {} })
  transport.config = null
  transport.status = 'connected'
  transport.terminalCloseCode = null
  transport.sendChatMessage.mockReturnValue(true)
  vi.clearAllMocks()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function Navigation() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/game/g2')}>Switch route</button>
}
function openGame(id = 'g1') {
  return render(<MemoryRouter initialEntries={[`/game/${id}`]}><Navigation /><Routes>
    <Route path="/game/:id" element={<GamePage />} />
    <Route path="/" element={<div>Home</div>} />
  </Routes></MemoryRouter>)
}
const ok = (body: GameState) => ({ ok: true, json: async () => body })

it('shows missing identity without guessing a human, debug GET or mock table', async () => {
  openGame('unknown')
  await screen.findByText(/缺少.*身份/)
  expect(screen.queryByText('Real table')).not.toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(transport.config).toBeNull()
  expect(useGameStore.getState().players).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '返回大厅' }))
  expect(screen.getByText('Home')).toBeInTheDocument()
})

it('reloads with the remembered viewer, restores seen cards and waits for server legal actions', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockResolvedValue(ok(snapshot))
  openGame()
  await screen.findByText('Real table')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1?player_id=p1')
  expect(transport.config).toMatchObject({ gameId: 'g1', playerId: 'p1' })
  act(() => transport.config!.onMessage({ type: 'game_state', data: snapshot }))
  expect(useUIStore.getState().hasLookedAtCards).toBe(true)
  expect(useUIStore.getState().showPlayerCards).toBe(true)
  expect(useGameStore.getState().myCards).toEqual(snapshot.players[0].hand)
  expect(useGameStore.getState().availableActions).toEqual([])
  act(() => transport.config!.onMessage({ type: 'turn_changed', data: { current_player_id: 'p1', available_actions: ['call', 'fold'] } }))
  expect(screen.getByRole('button', { name: /跟注/ })).toBeEnabled()
})

it('shows an expired game honestly and can retry a transient load error', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValueOnce(ok(snapshot))
  openGame()
  await screen.findByText('网络暂不可用')
  expect(transport.config).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByText('Real table')
})

it('404 is missing, never a loading spinner forever', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: '游戏不存在' }) })
  openGame()
  await screen.findByText(/游戏不存在/)
  expect(screen.queryByText('Real table')).not.toBeInTheDocument()
  expect(transport.config).toBeNull()
})

it('cancels old route loading and ignores a late response', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  useSessionStore.getState().remember('g2', 'p3')
  let resolveOld!: (value: ReturnType<typeof ok>) => void
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce(ok({ ...snapshot, game_id: 'g2', players: [{ ...snapshot.players[0], id: 'p3' }] }))
  openGame()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Switch route' }))
  await screen.findByText('Real table')
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () => resolveOld(ok(snapshot)))
  expect(useGameStore.getState().gameId).toBe('g2')
  expect(transport.config).toMatchObject({ gameId: 'g2', playerId: 'p3' })
})

it('offers next hand from settled snapshot and sends only WS start', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  const settled = { ...snapshot, current_round: { ...snapshot.current_round!, phase: 'settlement' as const } }
  fetchMock.mockResolvedValue(ok(settled))
  openGame()
  await screen.findByText('Real table')
  act(() => transport.config!.onMessage({ type: 'game_state', data: settled }))
  fireEvent.click(screen.getByRole('button', { name: '开始下一局' }))
  expect(transport.sendStartRound).toHaveBeenCalledOnce()
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('disables buttons for a pending start until server acknowledgement', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  const waiting = { ...snapshot, status: 'waiting' as const, current_round: null }
  fetchMock.mockResolvedValue(ok(waiting))
  openGame()
  await screen.findByText('Real table')
  act(() => transport.config!.onMessage({ type: 'game_state', data: waiting }))
  fireEvent.click(screen.getByRole('button', { name: '开始第一局' }))
  expect(screen.getByRole('button', { name: '开始第一局' })).toBeDisabled()
  expect(screen.getByText('等待服务器确认…')).toBeInTheDocument()
})


it.each([100, 1000])('unlocks a peek only on acknowledgement after %s ms', async (delay) => {
  useSessionStore.getState().remember('g1', 'p1')
  const blind = { ...snapshot, players: snapshot.players.map(p => ({ ...p, status: 'active_blind' as const, hand: null })) }
  fetchMock.mockResolvedValue(ok(blind))
  openGame()
  await screen.findByText('Real table')
  act(() => transport.config!.onMessage({ type: 'game_state', data: blind }))
  act(() => transport.config!.onMessage({ type: 'turn_changed', data: { current_player_id: 'p1', available_actions: ['check_cards', 'call'] } }))
  vi.useFakeTimers()
  fireEvent.click(screen.getByRole('button', { name: /看牌/ }))
  act(() => vi.advanceTimersByTime(delay))
  expect(screen.getByRole('button', { name: /跟注/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /跟注/ }))
  expect(transport.sendAction).toHaveBeenCalledTimes(1)
  act(() => transport.config!.onMessage({ type: 'player_acted', data: { player_id: 'p1', action: 'check_cards', amount: 0 } }))
  expect(screen.getByRole('button', { name: /跟注/ })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: /跟注/ }))
  expect(transport.sendAction).toHaveBeenLastCalledWith('call', undefined)
  expect(transport.sendAction).toHaveBeenCalledTimes(2)
})

it.each([4001, 4003, 4004])('offers only lobby recovery for terminal WS %s', async (code) => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockResolvedValue(ok(snapshot))
  openGame()
  await screen.findByText('Real table')
  transport.status = 'terminal'
  transport.terminalCloseCode = code
  act(() => transport.config!.onMessage({ type: 'game_state', data: snapshot }))
  expect(screen.getByText(/请返回大厅创建新游戏/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /重试|重连/ })).not.toBeInTheDocument()
  expect(screen.queryByText('Real table')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回大厅' }))
  expect(screen.getByText('Home')).toBeInTheDocument()
  expect(transport.reconnect).not.toHaveBeenCalled()
})

it('preserves the draft through collapse and failed send, clearing it after success', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  fetchMock.mockResolvedValue(ok(snapshot))
  openGame()
  await screen.findByText('Real table')
  const toggle = screen.getByRole('button', { name: '牌桌聊天' })
  if (!useUIStore.getState().isChatPanelExpanded) fireEvent.click(toggle)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unsent draft' } })
  fireEvent.click(toggle)
  // Wait longer than the exit animation that used to unmount ChatInput.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
  fireEvent.click(toggle)
  expect(screen.getByRole('textbox')).toHaveValue('unsent draft')
  transport.sendChatMessage.mockReturnValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  fireEvent.click(toggle)
  fireEvent.click(toggle)
  expect(screen.getByRole('textbox')).toHaveValue('unsent draft')
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(transport.sendChatMessage).toHaveBeenLastCalledWith('unsent draft')
  expect(screen.getByRole('textbox')).toHaveValue('')
})
