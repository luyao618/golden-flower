import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import WelcomePage from '../WelcomePage'
import { useGameStore } from '../../stores/gameStore'
import { useSessionStore } from '../../stores/sessionStore'

// Provider/settings modals fetch separately; exercise the actual setup controls and API service.
vi.mock('../../components/Lobby/ModelConfigPanel', () => ({ default: () => null }))
vi.mock('../../components/Lobby/GameSettingsModal', () => ({ default: () => null }))
const fetchMock = vi.fn()

beforeEach(() => {
  useGameStore.getState().reset()
  useSessionStore.setState({ sessions: {} })
  useGameStore.setState({ availableModels: [
    { id: 'm1', display_name: 'Model One', provider: 'openrouter', model: 'one' },
    { id: 'm2', display_name: 'Model Two', provider: 'openrouter', model: 'two' },
  ], aiOpponents: [{ model_id: 'm1', name: '' }] })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function Destination() {
  return <div>Connected destination {useParams().id}</div>
}

function setup() {
  render(<MemoryRouter><Routes>
    <Route path="/" element={<WelcomePage />} />
    <Route path="/game/:id" element={<Destination />} />
  </Routes></MemoryRouter>)
  fireEvent.change(screen.getByPlaceholderText('人类一败涂地'), { target: { value: '验收玩家' } })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm2' } })
  fireEvent.click(screen.getByRole('button', { name: /休闲局/ }))
}

it('sends visible name, model and stakes to real create service and remembers returned identity', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ game_id: 'real-id', players: [{ id: 'human-id', player_type: 'human' }] }) })
  setup()
  fireEvent.click(screen.getByRole('button', { name: '开始游戏' }))
  await screen.findByText('Connected destination real-id')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('/api/game/create')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    player_name: '验收玩家', ai_opponents: [{ model_id: 'm2', name: 'Model Two' }],
    initial_chips: 500, ante: 5, max_bet: 100, max_turns: 8,
  })
  expect(useSessionStore.getState().sessions['real-id']).toEqual({ playerId: 'human-id' })
})

it('retains configuration and allows retry after create failure', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ detail: '创建失败，请重试' }) })
  setup()
  fireEvent.click(screen.getByRole('button', { name: '开始游戏' }))
  await screen.findByText('创建失败，请重试')
  expect(screen.getByPlaceholderText('人类一败涂地')).toHaveValue('验收玩家')
  expect(screen.getByRole('combobox')).toHaveValue('m2')
  expect(useGameStore.getState().gameConfig.initial_chips).toBe(500)
  await waitFor(() => expect(screen.getByRole('button', { name: '开始游戏' })).toBeEnabled())
  expect(useSessionStore.getState().sessions).toEqual({})
})
