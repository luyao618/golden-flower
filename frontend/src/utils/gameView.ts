import type { GameState, Player, RoundState } from '../types/game'

export function canStartHand(game: GameState | null): boolean {
  return game !== null && game.status !== 'finished' &&
    (!game.current_round || game.current_round.phase === 'settlement')
}

export function canPeek(game: GameState | null, player: Player | undefined): boolean {
  return game?.status === 'playing' && game.current_round?.phase === 'betting' &&
    player?.status === 'active_blind'
}

export function getActionCost(
  action: 'call' | 'raise' | 'compare', round: RoundState, player: Player,
): number {
  const call = player.status === 'active_blind' ? round.current_bet :
    player.status === 'active_seen' ? round.current_bet * 2 : 0
  return action === 'raise' ? call * 2 :
    action === 'compare' && player.status !== 'active_seen' ? 0 : call
}

export function getTablePhase(game: GameState | null) {
  if (!game) return 'loading' as const
  if (game.status === 'finished') return 'finished' as const
  if (canStartHand(game)) return 'ready' as const
  return 'betting' as const
}
