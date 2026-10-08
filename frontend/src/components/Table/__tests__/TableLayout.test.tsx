import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import TableLayout from '../TableLayout'
import { useGameStore } from '../../../stores/gameStore'
import { useUIStore } from '../../../stores/uiStore'
vi.mock('../../Player/PlayerSeat', () => ({ default: ({ onLookAtCards, isActive }: { onLookAtCards?: () => void; isActive: boolean }) => <button data-active={isActive} onClick={onLookAtCards}>Peek seat</button> }))
vi.mock('../GameInfoPanel', () => ({ default: () => null }))
vi.mock('../DealingAnimation', () => ({ default: () => null }))
vi.mock('../ChipFlyAnimation', () => ({ default: () => null, WinChipAnimation: () => null }))
beforeEach(() => {
  useGameStore.getState().reset()
  useUIStore.getState().resetUI()
  useGameStore.setState({ players: [{ id: 'p1', name: 'Me', player_type: 'human', avatar: '', chips: 500, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: null }], myPlayerId: 'p1' })
})
it('requests peek without optimistically exposing cards', () => {
  const send = vi.fn(() => false)
  render(<TableLayout onCheckCards={send} />)
  fireEvent.click(screen.getByRole('button', { name: 'Peek seat' }))
  expect(send).toHaveBeenCalledOnce()
  expect(useUIStore.getState().hasLookedAtCards).toBe(false)
})

it('does not highlight an acting seat after authoritative settlement', () => {
  useGameStore.setState({ currentRound: { round_number: 1, pot: 20, current_bet: 10, dealer_index: 0,
    current_player_index: 0, actions: [], phase: 'settlement', turn_count: 1, max_turns: 10 } })
  render(<TableLayout />)
  expect(screen.getByRole('button', { name: 'Peek seat' })).toHaveAttribute('data-active', 'false')
})
