import { describe, expect, it } from 'vitest'
import { decodeServerEvent } from '../../../domain/decoders'
import type { GameStateDTO } from '../../../domain/game'
import { createHandReplay } from '../../../test/fixtures/gameReplays'
import { gameReducer } from '../reducer'
import { createGameSession } from '../state'
import { selectActions, selectCompareTargets, selectCurrentActor } from '../selectors'

const hand = createHandReplay()
function synchronized(snapshot: GameStateDTO, actions: string[] = ['fold', 'call', 'raise', 'compare', 'check_cards']) {
  let state = createGameSession({ gameId: snapshot.game_id, playerId: snapshot.players[0].id })
  state = gameReducer(state, { type: 'connection.started', generation: 1 })
  state = gameReducer(state, { type: 'connection.opened', generation: 1 })
  state = gameReducer(state, { type: 'server.message', generation: 1,
    message: decodeServerEvent({ type: 'game_state', data: snapshot }) })
  return gameReducer(state, { type: 'server.message', generation: 1,
    message: decodeServerEvent({ type: 'turn_changed', data: {
      current_player: snapshot.players[0].name, current_player_id: snapshot.players[0].id,
      available_actions: actions,
    } }) })
}

describe('snapshot selectors (labels and guards, never an engine)', () => {
  it.each([
    ['active_blind', 10, 20, null], ['active_seen', 20, 40, 20],
  ] as const)('derives %s call/raise/compare payments from the base', (status, call, raise, compare) => {
    const snapshot = structuredClone(hand.humanTurn)
    snapshot.players[0].status = status
    const actions = selectActions(synchronized(snapshot))
    expect(actions.call.cost).toBe(call)
    expect(actions.raise.cost).toBe(raise)
    expect(actions.compare.cost).toBe(compare)
    expect(actions.fold.cost).toBe(0)
    expect(actions.check_cards.cost).toBe(0)
    expect(actions.call.enabled).toBe(true)
    expect(actions.raise.enabled).toBe(true)
    expect(actions.compare.enabled).toBe(status === 'active_seen')
    expect(actions.check_cards.enabled).toBe(status === 'active_blind')
  })

  it.each([
    [19, 200, false, false, false], [20, 200, true, false, true],
    [39, 200, true, false, true], [40, 20, true, true, true],
    [40, 19, true, false, true],
  ])('guards chips=%i and base cap=%i without authorizing absent actions', (chips, cap, call, raise, compare) => {
    const snapshot = structuredClone(hand.seen)
    snapshot.players[0].chips = chips
    snapshot.config.max_bet = cap
    const actions = selectActions(synchronized(snapshot))
    expect(actions.call.enabled).toBe(call)
    expect(actions.raise.enabled).toBe(raise)
    expect(actions.compare.enabled).toBe(compare)
    const refused = selectActions(synchronized(snapshot, ['fold', 'unknown_future_action']))
    expect(refused.call.enabled).toBe(false)
    expect(refused.raise.enabled).toBe(false)
    expect(refused.compare.enabled).toBe(false)
    expect(refused.fold.enabled).toBe(true)
  })

  it('preserves opaque identities and server seat order; excludes self and inactive compare targets', () => {
    const snapshot = structuredClone(hand.seen)
    snapshot.players[0].id = 'viewer/opaque:人?+#'
    snapshot.players[1].id = 'toString'
    snapshot.players[2].status = 'folded'
    const state = synchronized(snapshot)
    expect(selectCurrentActor(state)?.id).toBe(snapshot.players[0].id)
    expect(selectCompareTargets(state).map((p) => p.id)).toEqual(['toString'])
    expect(state.snapshot?.players[1].model_id).toBe(snapshot.players[1].model_id)
    expect(gameReducer(state, { type: 'command.requested', generation: 1, id: 1,
      command: { type: 'player_action', data: { action: 'compare', target: snapshot.players[0].id } } })).toBe(state)
    expect(gameReducer(state, { type: 'command.requested', generation: 1, id: 1,
      command: { type: 'player_action', data: { action: 'compare', target: 'toString' } } }).command.status).toBe('sending')
    snapshot.players[1].status = 'compare_lost'
    expect(selectActions(synchronized(snapshot)).compare.enabled).toBe(false)
  })

  it.each(['folded', 'compare_lost', 'out'] as const)('disables actions for %s players', (status) => {
    const snapshot = structuredClone(hand.seen)
    snapshot.players[0].status = status
    expect(Object.values(selectActions(synchronized(snapshot))).every((action) => !action.enabled)).toBe(true)
  })

  it.each(['waiting', 'dealing', 'comparing', 'settlement', 'game_over'] as const)('never acts during %s', (phase) => {
    const snapshot = structuredClone(hand.seen)
    if (!snapshot.current_round) throw new Error('Missing round')
    snapshot.current_round.phase = phase
    expect(Object.values(selectActions(synchronized(snapshot))).every((action) => !action.enabled)).toBe(true)
  })

  it('handles null rounds and out-of-range actor indices conservatively', () => {
    expect(selectCurrentActor(synchronized(hand.waiting))).toBeNull()
    expect(selectActions(synchronized(hand.waiting)).call.cost).toBeNull()
    const snapshot = structuredClone(hand.humanTurn)
    if (!snapshot.current_round) throw new Error('Missing round')
    snapshot.current_round.current_player_index = 999
    const state = synchronized(snapshot)
    expect(selectCurrentActor(state)).toBeNull()
    expect(selectActions(state).call.enabled).toBe(false)
  })
})
