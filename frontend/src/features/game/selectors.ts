import type { GameAction, PlayerStatus } from '../../domain/game'
import { isCommandPending } from './state'
import type { FinalReceipt, GameSession, RoundResult } from './state'

export function isActive(status: PlayerStatus): boolean {
  return status === 'active_blind' || status === 'active_seen'
}

export function selectOwnPlayer(state: GameSession) {
  return state.snapshot?.players.find((player) => player.id === state.identity.playerId) ?? null
}

export function selectCurrentActor(state: GameSession) {
  const snapshot = state.snapshot
  return snapshot?.current_round ? snapshot.players[snapshot.current_round.current_player_index] ?? null : null
}

/** Also normalizes duplicate entries in snapshots. Opaque identities never become object keys. */
export function upsertRoundResults(results: readonly RoundResult[]): RoundResult[] {
  return [...new Map(results.map((result) => [result.round_number, result])).values()]
    .sort((left, right) => left.round_number - right.round_number)
}

export function selectRoundResults(state: GameSession): readonly RoundResult[] {
  // A delayed event cannot override a result already present in the authoritative snapshot.
  return upsertRoundResults([...state.presentation.resultEvents, ...(state.snapshot?.round_history ?? [])])
}

export function selectVisibleCards(state: GameSession, playerId: string) {
  const round = state.snapshot?.current_round
  const player = state.snapshot?.players.find((candidate) => candidate.id === playerId)
  if (!round || !player) return null
  const result = selectRoundResults(state).find((item) => item.round_number === round.round_number)
  const supplied = result?.hands_revealed
  if (supplied && Object.hasOwn(supplied, playerId)) return supplied[playerId]
  const reveal = state.presentation.reveals.find((item) =>
    item.roundNumber === round.round_number && item.playerId === playerId)
  if (reveal) return reveal.cards
  return playerId === state.identity.playerId && player.status === 'active_seen' ? player.hand : null
}

/** Candidates only; server turn eligibility still governs whether compare can be sent. */
export function selectCompareTargets(state: GameSession) {
  const own = selectOwnPlayer(state)
  if (!own || own.status !== 'active_seen' || state.snapshot?.current_round?.phase !== 'betting') return []
  return state.snapshot.players.filter((player) => player.id !== own.id && isActive(player.status))
}

export type DisabledReason = 'offline' | 'synchronizing' | 'command_pending' | 'no_round' | 'inactive'
  | 'not_your_turn' | 'waiting_for_turn' | 'server_disallowed' | 'insufficient_chips' | 'raise_cap'
  | 'seen_required' | 'already_seen' | 'no_targets' | 'finished'

export interface ActionOption {
  readonly cost: number | null
  readonly enabled: boolean
  readonly reason: DisabledReason | null
}

function sessionBlock(state: GameSession): DisabledReason | null {
  if (state.connection.status !== 'open') return 'offline'
  if (state.connection.sync !== 'ready' || !state.snapshot) return 'synchronizing'
  if (isCommandPending(state.command)) return 'command_pending'
  if (state.snapshot.status === 'finished' || state.receipt) return 'finished'
  return null
}

export function selectCanStartRound(state: GameSession): boolean {
  if (sessionBlock(state) || !selectOwnPlayer(state)) return false
  const snapshot = state.snapshot
  return (snapshot?.status === 'waiting' && snapshot.current_round === null) ||
    snapshot?.current_round?.phase === 'settlement'
}

export function selectActions(state: GameSession): Record<GameAction, ActionOption> {
  const own = selectOwnPlayer(state)
  const round = state.snapshot?.current_round
  const active = own && isActive(own.status)
  const call = round && active ? round.current_bet * (own.status === 'active_seen' ? 2 : 1) : null
  const costs: Record<GameAction, number | null> = {
    fold: 0, check_cards: 0, call, raise: call === null ? null : call * 2,
    compare: own?.status === 'active_seen' ? call : null,
  }
  const reasonFor = (action: GameAction): DisabledReason | null => {
    const blocked = sessionBlock(state)
    if (blocked) return blocked
    if (!round || round.phase !== 'betting') return 'no_round'
    if (!own || !active) return 'inactive'
    // The existing WS contract explicitly allows free off-turn peek without turn_changed.
    if (action === 'check_cards') return own.status === 'active_blind' ? null : 'already_seen'
    if (selectCurrentActor(state)?.id !== own.id) return 'not_your_turn'
    if (!state.eligibility || state.eligibility.roundNumber !== round.round_number ||
      state.eligibility.playerId !== own.id) return 'waiting_for_turn'
    if (!state.eligibility.actions.includes(action)) return 'server_disallowed'
    if (action === 'compare' && own.status !== 'active_seen') return 'seen_required'
    if (action === 'compare' && selectCompareTargets(state).length === 0) return 'no_targets'
    if (action === 'raise' && round.current_bet * 2 > state.snapshot!.config.max_bet) return 'raise_cap'
    const cost = costs[action]
    if (cost !== null && cost > own.chips) return 'insufficient_chips'
    return null
  }
  const option = (action: GameAction): ActionOption => {
    const reason = reasonFor(action)
    return { cost: costs[action], enabled: reason === null, reason }
  }
  return { fold: option('fold'), call: option('call'), raise: option('raise'),
    check_cards: option('check_cards'), compare: option('compare') }
}

export function selectFinalReceipt(state: GameSession, gameId: string): FinalReceipt | null {
  return state.receipt?.gameId === gameId ? state.receipt : null
}
