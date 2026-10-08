import { beforeEach, expect, it } from 'vitest'
import { useSessionStore } from '../sessionStore'
import { useGameStore } from '../gameStore'

beforeEach(() => {
  sessionStorage.clear()
  useSessionStore.setState({ sessions: {} })
})

it('rehydrates only game-specific identity after runtime is reset', async () => {
  useSessionStore.getState().remember('g1', 'p1')
  useGameStore.getState().reset()
  // Clear memory without writing over the persisted identity.
  const stored = sessionStorage.getItem('golden-flower-session-v1')!
  useSessionStore.setState({ sessions: {} })
  sessionStorage.setItem('golden-flower-session-v1', stored)
  await useSessionStore.persist.rehydrate()
  expect(useSessionStore.getState().sessions.g1).toEqual({ playerId: 'p1' })
  expect(useSessionStore.getState().sessions.g2).toBeUndefined()
  expect(JSON.parse(stored).state).toEqual({ sessions: { g1: { playerId: 'p1' } } })
})

it('forgets only the chosen game', () => {
  useSessionStore.getState().remember('g1', 'p1')
  useSessionStore.getState().remember('g2', 'p2')
  useSessionStore.getState().forget('g1')
  expect(useSessionStore.getState().sessions).toEqual({ g2: { playerId: 'p2' } })
})
