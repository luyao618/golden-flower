import { describe, expect, it } from 'vitest'
import { decodeServerEvent } from '../../../domain/decoders'
import type { ServerEvent } from '../../../domain/events'
import type { GameStateDTO } from '../../../domain/game'
import {
  createCompareReplay, createFinishedReplay, createHandReplay, createShowdownReplay,
  createStartReplay, protocolCases,
} from '../../../test/fixtures/gameReplays'
import { gameReducer } from '../reducer'
import { createGameSession, MAX_EFFECTS } from '../state'
import type { GameSession, SessionAction } from '../state'
import {
  selectActions, selectCanStartRound, selectCurrentActor, selectFinalReceipt,
  selectRoundResults, selectVisibleCards,
} from '../selectors'

const hand = createHandReplay()
const identity = { gameId: hand.waiting.game_id, playerId: 'human' }
const snapshot = (data: GameStateDTO): ServerEvent => ({ type: 'game_state', data })
const receive = (state: GameSession, event: ServerEvent, generation = state.connection.generation) =>
  gameReducer(state, { type: 'server.message', generation, message: decodeServerEvent(JSON.stringify(event)) })
const replay = (state: GameSession, events: ServerEvent[]) => events.reduce((s, event) => receive(s, event), state)
function connect(playerId = 'human', generation = 1): GameSession {
  let state = createGameSession({ ...identity, playerId })
  state = gameReducer(state, { type: 'connection.started', generation })
  return gameReducer(state, { type: 'connection.opened', generation })
}
const ready = () => replay(connect(), [...hand.connect, ...hand.start])
const request = (state: GameSession, command: Extract<SessionAction, { type: 'command.requested' }>['command'], id = 1) =>
  gameReducer(state, { type: 'command.requested', generation: state.connection.generation, id, command })
const call = { type: 'player_action', data: { action: 'call' } } as const
const peek = { type: 'player_action', data: { action: 'check_cards' } } as const

describe('authoritative replay reducer', () => {
  it.each([1, 2, 3, 4, 5] as const)('replays start with %i opponents without deriving game facts from events', (count) => {
    const fixture = createStartReplay(count)
    let state = receive(connect(), snapshot(fixture.waiting))
    expect(selectCanStartRound(state)).toBe(true)
    state = request(state, fixture.startCommand)
    state = receive(state, fixture.start[0])
    expect(state.snapshot).toEqual(fixture.waiting)
    expect(state.command.status).toBe('sending')
    state = replay(state, fixture.start.slice(1))
    expect(state.snapshot).toEqual(fixture.humanTurn)
    expect(state.command.status).toBe('acknowledged')
    expect(selectCurrentActor(state)?.id).toBe('human')
    expect(selectActions(state).call.enabled).toBe(true)
    expect(selectVisibleCards(state, 'human')).toBeNull()
  })

  it('replays the full hand and duplicate settlement without double payout or history', () => {
    let state = replay(ready(), [...hand.peek, ...hand.actions])
    for (const event of hand.duplicateDelivery) {
      state = receive(state, event)
      if (event.type === 'game_state' || selectRoundResults(state).length) {
        expect(state.snapshot?.players.map((p) => p.chips)).toEqual([1060, 960, 980])
        expect(selectRoundResults(state)).toEqual([hand.result])
      }
    }
    expect(state.snapshot).toEqual(hand.settled)
    expect(selectCanStartRound(state)).toBe(true)
  })

  it('upserts result-first delivery without spending chips, then lets snapshots replace every fact', () => {
    let state = receive(connect(), snapshot(hand.beforeCompare))
    const original = state.snapshot
    state = receive(state, { type: 'round_ended', data: hand.result })
    state = receive(state, { type: 'round_ended', data: { ...hand.result, win_method: 'corrected event' } })
    expect(state.snapshot).toBe(original)
    expect(selectRoundResults(state)).toHaveLength(1)
    expect(selectRoundResults(state)[0].win_method).toBe('corrected event')
    state = receive(state, snapshot(hand.settled))
    expect(selectRoundResults(state)).toEqual([hand.result])
    state = receive(state, { type: 'round_ended', data: { ...hand.result, pot: 999 } })
    expect(selectRoundResults(state)).toEqual([hand.result])
    state = receive(state, snapshot(hand.waiting))
    expect(state.snapshot).toEqual(hand.waiting)
    expect(selectRoundResults(state)).toEqual([])
    expect(selectCurrentActor(state)).toBeNull()
  })

  it('normalizes duplicate snapshot history by round and owns inputs without mutation', () => {
    const input = structuredClone(hand.settled)
    input.round_history = [hand.result, { ...hand.result, win_method: 'server correction' }]
    const before = structuredClone(input)
    const message = decodeServerEvent(snapshot(input))
    const state = gameReducer(connect(), { type: 'server.message', generation: 1, message })
    expect(input).toEqual(before)
    expect(state.snapshot?.round_history).toHaveLength(1)
    input.players[0].chips = -1
    expect(state.snapshot?.players[0].chips).toBe(1060)
    expect(selectRoundResults(state)[0].win_method).toBe('server correction')
  })

  it('does not mutate previous states or decoded events during a complete replay', () => {
    function freeze(value: unknown): void {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
      Object.freeze(value)
      Object.values(value).forEach(freeze)
    }
    let state = connect()
    for (const event of [...hand.connect, ...hand.start, ...hand.peek, ...hand.actions, ...hand.settlement, ...hand.nextHand]) {
      freeze(state)
      freeze(event)
      state = receive(state, event)
    }
    expect(state.snapshot?.current_round?.round_number).toBe(2)
  })

  it('keeps the next round when old effects finish or old results arrive', () => {
    let state = replay(ready(), [...hand.peek, ...hand.actions, ...hand.settlement])
    const oldEffects = state.presentation.effects
    expect(oldEffects.length).toBeGreaterThan(0)
    state = replay(state, hand.nextHand)
    const nextSnapshot = state.snapshot
    for (const effect of oldEffects) {
      state = gameReducer(state, { type: 'effect.finished', generation: 1, effect })
    }
    state = receive(state, { type: 'round_ended', data: hand.result })
    expect(state.snapshot).toBe(nextSnapshot)
    expect(state.snapshot?.current_round?.round_number).toBe(2)
    expect(state.presentation.effects.every((effect) => effect.roundNumber === 2)).toBe(true)
    expect(selectVisibleCards(state, 'human')).toBeNull()
  })

  it('bounds effects; finishing them cannot change facts, commands or legal actions', () => {
    let state = ready()
    const actorEvent = hand.actions[0]
    for (let i = 0; i < 100; i++) state = receive(state, actorEvent)
    expect(state.presentation.effects.length).toBeLessThanOrEqual(MAX_EFFECTS)
    const before = state
    for (const effect of state.presentation.effects) {
      state = gameReducer(state, { type: 'effect.finished', generation: 1, effect })
    }
    expect(state.presentation.effects).toEqual([])
    expect(state.snapshot).toBe(before.snapshot)
    expect(state.command).toBe(before.command)
    expect(selectActions(state)).toEqual(selectActions(before))
  })

  it('checks the complete effect scope and never replays old effects on reconnect', () => {
    let state = ready()
    const effect = state.presentation.effects[0]
    expect(effect).toBeDefined()
    for (const patch of [{ gameId: 'other' }, { roundNumber: 999 }, { generation: 999 }]) {
      expect(gameReducer(state, { type: 'effect.finished', generation: 1, effect: { ...effect, ...patch } })).toBe(state)
    }
    state = gameReducer(state, { type: 'connection.started', generation: 2 })
    state = gameReducer(state, { type: 'connection.opened', generation: 2 })
    state = replay(state, hand.reconnect.settled)
    expect(state.presentation.effects).toEqual([])
    expect(gameReducer(state, { type: 'effect.finished', generation: 1, effect })).toBe(state)
    expect(state.snapshot).toEqual(hand.settled)
  })

  it('ignores stale generations, closed sockets and snapshots for another identity', () => {
    let state = request(ready(), call)
    state = gameReducer(state, { type: 'connection.started', generation: 2 })
    expect(state.command.status).toBe('uncertain')
    expect(state.presentation.effects).toEqual([])
    const stale: SessionAction[] = [
      { type: 'connection.started', generation: 1 },
      { type: 'connection.opened', generation: 1 },
      { type: 'connection.closed', generation: 1 },
      { type: 'command.sent', generation: 1, id: 1 },
      { type: 'command.failed', generation: 1, id: 1, delivery: 'not_sent', message: 'late' },
      { type: 'command.timed_out', generation: 1, id: 1 },
      ...hand.settlement.map((event): SessionAction => ({ type: 'server.message', generation: 1,
        message: decodeServerEvent(event) })),
    ]
    for (const action of stale) expect(gameReducer(state, action)).toBe(state)
    expect(receive(state, snapshot(hand.settled), 2)).toBe(state)
    state = gameReducer(state, { type: 'connection.opened', generation: 2 })
    expect(receive(state, snapshot({ ...hand.settled, game_id: 'other' }))).toBe(state)
    state = gameReducer(state, { type: 'connection.closed', generation: 2 })
    expect(receive(state, snapshot(hand.settled))).toBe(state)
  })

  it('requires a fresh snapshot and matching turn notification after reconnect', () => {
    let state = gameReducer(ready(), { type: 'connection.started', generation: 2 })
    state = gameReducer(state, { type: 'connection.opened', generation: 2 })
    state = receive(state, hand.start[hand.start.length - 1])
    expect(selectActions(state).call.enabled).toBe(false)
    state = receive(state, snapshot(hand.humanTurn))
    expect(selectActions(state).call.enabled).toBe(false)
    state = receive(state, hand.start[hand.start.length - 1])
    expect(selectActions(state).call.enabled).toBe(true)
    state = receive(state, snapshot(hand.called))
    state = receive(state, hand.start[hand.start.length - 1])
    expect(selectActions(state).call.enabled).toBe(false)
  })

  it('ignores unknown events and freezes on malformed messages until a valid snapshot', () => {
    let state = ready()
    for (const fixture of protocolCases.filter((item) => item.kind === 'unknown')) {
      expect(gameReducer(state, { type: 'server.message', generation: 1,
        message: decodeServerEvent(fixture.input) })).toBe(state)
    }
    state = gameReducer(state, { type: 'server.message', generation: 1,
      message: decodeServerEvent({ type: 'game_state', data: null }) })
    expect(state.connection.sync).toBe('error')
    expect(selectActions(state).check_cards.enabled).toBe(false)
    expect(state.snapshot).toEqual(hand.humanTurn)
    state = replay(state, hand.reconnect.blind)
    expect(state.connection.sync).toBe('ready')
    expect(selectActions(state).call.enabled).toBe(true)
  })

  it('supports dormant game_started and rejects snapshots without the viewer', () => {
    let state = receive(connect(), { type: 'game_started', data: hand.waiting })
    expect(state.snapshot).toEqual(hand.waiting)
    state = receive(state, snapshot({ ...hand.humanTurn, players: hand.humanTurn.players.slice(1) }))
    expect(state.connection.sync).toBe('error')
    expect(state.snapshot).toEqual(hand.waiting)
    expect(selectCanStartRound(state)).toBe(false)
  })
})

describe('confirmed visibility and receipts', () => {
  it('does not reveal blind cards on deal, command, action notification or timer completion', () => {
    let state = request(ready(), peek)
    state = receive(state, { type: 'cards_dealt', data: { your_cards: hand.seen.players[0].hand } })
    state = receive(state, hand.peek[0])
    expect(selectVisibleCards(state, 'human')).toBeNull()
    expect(state.command.status).toBe('sending')
    state = receive(state, hand.peek[1])
    expect(selectVisibleCards(state, 'human')).toEqual(hand.seen.players[0].hand)
    expect(state.command.status).toBe('acknowledged')
    expect(state.snapshot?.current_round?.actions).toEqual(hand.humanTurn.current_round?.actions)
  })

  it('restores visibility only from seen state or supplied reveals; null means unavailable', () => {
    expect(selectVisibleCards(replay(connect(), hand.reconnect.blind), 'human')).toBeNull()
    expect(selectVisibleCards(replay(connect(), hand.reconnect.seen), 'human')).toEqual(hand.seen.players[0].hand)
    const noCards = structuredClone(hand.seen)
    noCards.players[0].hand = null
    expect(selectVisibleCards(receive(connect(), snapshot(noCards)), 'human')).toBeNull()
    const unscoped = structuredClone(hand.seen)
    unscoped.players[1].hand = hand.seen.players[0].hand
    unscoped.players[1].status = 'active_seen'
    expect(selectVisibleCards(receive(connect(), snapshot(unscoped)), 'ai-1')).toBeNull()
  })

  it('shows participant comparison cards, hides spectator cards and drops missed reveals on reconnect', () => {
    const spectator = createCompareReplay('human')
    let state = replay(receive(connect(), snapshot(spectator.before)), spectator.events)
    expect(selectVisibleCards(state, 'ai-1')).toBeNull()
    const participant = createCompareReplay('ai-1')
    state = replay(receive(connect('ai-1'), snapshot(participant.before)), participant.events)
    expect(selectVisibleCards(state, 'ai-2')).not.toBeNull()
    state = gameReducer(state, { type: 'connection.started', generation: 2 })
    state = gameReducer(state, { type: 'connection.opened', generation: 2 })
    state = receive(state, snapshot(participant.after))
    expect(selectVisibleCards(state, 'ai-2')).toBeNull()
  })

  it('reveals only supplied forced-showdown hands and never ends a round from turn count', () => {
    const fixture = createShowdownReplay()
    let state = receive(connect(), snapshot(fixture.before))
    expect(state.snapshot?.current_round?.phase).toBe('betting')
    state = replay(state, fixture.events)
    expect(selectVisibleCards(state, 'ai-1')).toEqual(fixture.result.hands_revealed?.['ai-1'])
    expect(selectVisibleCards(state, 'ai-2')).toBeNull()
  })

  it('allows eliminated humans to start another hand and keeps final receipts redacted and game scoped', () => {
    const settled = structuredClone(hand.settled)
    settled.players[0].chips = 0
    settled.players[0].status = 'out'
    let state = receive(connect(), snapshot(settled))
    expect(selectCanStartRound(state)).toBe(true)
    expect(selectFinalReceipt(state, identity.gameId)).toBeNull()
    const fixture = createFinishedReplay()
    state = replay(receive(connect(), snapshot(fixture.before)), fixture.events)
    expect(selectCanStartRound(state)).toBe(false)
    expect(selectFinalReceipt(state, 'other')).toBeNull()
    expect(selectFinalReceipt(state, identity.gameId)).toEqual({ gameId: identity.gameId,
      standings: [{ id: 'human', name: '玩家', chips: 200 }, { id: 'ai-1', name: '对手1', chips: 0 }] })
    expect(selectFinalReceipt(receive(connect(), snapshot(fixture.after)), identity.gameId))
      .toEqual(selectFinalReceipt(state, identity.gameId))
  })
})

describe('conservative command lifecycle', () => {
  it('keeps a start pending through duplicate boundary snapshots and never automatically starts again', () => {
    for (const boundary of [hand.waiting, hand.settled]) {
      let state = request(receive(connect(), snapshot(boundary)), hand.startCommand)
      state = receive(state, snapshot(boundary))
      expect(state.command.status).toBe('sending')
      expect(selectCanStartRound(state)).toBe(false)
      state = gameReducer(state, { type: 'command.sent', generation: 1, id: 1 })
      expect(state.command.status).toBe('awaiting_server')
      expect(request(state, hand.startCommand, 2)).toBe(state)
    }
  })

  it('locks before send, rejects duplicate requests, and requires snapshot progress to acknowledge', () => {
    let state = request(ready(), call)
    expect(state.command.status).toBe('sending')
    expect(request(state, call, 2)).toBe(state)
    state = gameReducer(state, { type: 'command.sent', generation: 1, id: 1 })
    expect(state.command.status).toBe('awaiting_server')
    state = receive(state, hand.actions[0])
    expect(state.command.status).toBe('awaiting_server')
    state = receive(state, snapshot(hand.humanTurn))
    expect(state.command.status).toBe('awaiting_server')
    state = receive(state, snapshot(hand.called))
    expect(state.command.status).toBe('acknowledged')
    expect(selectActions(state).call.enabled).toBe(false)
  })

  it('acknowledges off-turn peek from confirmed status without a record or turn event', () => {
    let state = receive(connect(), snapshot(hand.offTurnPeek.before))
    expect(selectActions(state).check_cards.enabled).toBe(true)
    expect(selectActions(state).call.enabled).toBe(false)
    state = request(state, peek)
    state = replay(state, hand.offTurnPeek.events)
    expect(state.command.status).toBe('acknowledged')
    expect(selectActions(state).check_cards.enabled).toBe(false)
  })

  it('retains uncertain delivery across disconnect/reconnect and never resends or unlocks on an unchanged snapshot', () => {
    let state = request(ready(), call)
    state = gameReducer(state, { type: 'connection.closed', generation: 1 })
    expect(state.command.status).toBe('uncertain')
    state = gameReducer(state, { type: 'connection.started', generation: 2 })
    state = gameReducer(state, { type: 'connection.opened', generation: 2 })
    state = replay(state, hand.reconnect.blind)
    expect(state.command.status).toBe('uncertain')
    expect(request(state, call, 2)).toBe(state)
    state = receive(state, snapshot(hand.called))
    expect(state.command.status).toBe('acknowledged')
  })

  it('does not mistake another player, old action, wrong compare target or new round for proof', () => {
    let state = replay(ready(), [...hand.peek, ...hand.actions])
    state = request(state, hand.compareCommand)
    const wrong = structuredClone(hand.settled)
    const last = wrong.current_round?.actions.at(-1)
    if (!last) throw new Error('Missing fixture action')
    last.target_id = 'ai-2'
    state = receive(state, snapshot(wrong))
    expect(state.command.status).not.toBe('acknowledged')
    state = replay(state, hand.nextHand)
    expect(state.command.status).toBe('uncertain')
    let calling = request(ready(), call)
    calling = receive(calling, hand.start.find((event) => event.type === 'player_acted')!)
    calling = receive(calling, snapshot(hand.humanTurn))
    expect(calling.command.status).toBe('sending')
  })

  it('requires an unchanged action prefix and ignores late send callbacks after acknowledgement', () => {
    let state = request(ready(), call)
    const conflicting = structuredClone(hand.called)
    if (!conflicting.current_round) throw new Error('Missing fixture round')
    conflicting.current_round.actions[0].timestamp += 1
    state = receive(state, snapshot(conflicting))
    expect(state.command.status).toBe('sending')
    state = receive(state, snapshot(hand.called))
    expect(state.command.status).toBe('acknowledged')
    expect(gameReducer(state, { type: 'command.sent', generation: 1, id: 1 })).toBe(state)
    expect(gameReducer(state, { type: 'command.failed', generation: 1, id: 1,
      delivery: 'unknown', message: 'Late callback' })).toBe(state)
  })

  it('compares action-prefix facts independently of JSON object property order', () => {
    let state = request(ready(), call)
    const reordered = structuredClone(hand.called)
    if (!reordered.current_round) throw new Error('Missing fixture round')
    reordered.current_round.actions = reordered.current_round.actions.map((record) => ({
      action: record.action, timestamp: record.timestamp, target_id: record.target_id,
      amount: record.amount, player_name: record.player_name, player_id: record.player_id,
    }))
    state = receive(state, snapshot(reordered))
    expect(state.command.status).toBe('acknowledged')
  })

  it('never treats an ambiguous send failure as rejection, nor a provider warning as command failure', () => {
    let state = request(ready(), call)
    state = receive(state, { type: 'copilot_error', data: { message: 'Provider unavailable', error_code: 'test' } })
    expect(state.command.status).toBe('sending')
    state = gameReducer(state, { type: 'command.failed', generation: 1, id: 1,
      delivery: 'unknown', message: 'May have been written' })
    expect(state.command.status).toBe('uncertain')
    expect(selectActions(state).check_cards.enabled).toBe(false)
    expect(gameReducer(state, { type: 'command.sent', generation: 1, id: 1 })).toBe(state)
  })

  it('rejects definitely unsent commands; timeouts and uncorrelated server errors remain uncertain', () => {
    let state = request(ready(), call)
    state = gameReducer(state, { type: 'command.failed', generation: 1, id: 1,
      delivery: 'not_sent', message: 'Not written' })
    expect(state.command.status).toBe('rejected')
    // A fresh notification is required before another spending command.
    state = replay(state, hand.reconnect.blind)
    state = request(state, call, 2)
    state = gameReducer(state, { type: 'command.timed_out', generation: 1, id: 1 })
    expect(state.command.status).toBe('sending')
    state = gameReducer(state, { type: 'command.timed_out', generation: 1, id: 2 })
    expect(state.command.status).toBe('uncertain')
    expect(state.snapshot).toEqual(hand.humanTurn)
    state = receive(state, { type: 'error', data: { message: 'Uncorrelated failure' } })
    expect(state.command.status).toBe('uncertain')
    expect(state.notice).toEqual({ kind: 'server_error', message: 'Uncorrelated failure' })
  })
})
