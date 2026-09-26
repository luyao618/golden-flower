import { describe, expect, it } from 'vitest'
import {
  decodeActionResponse, decodeCreateGameResponse, decodeEndGameResponse,
  decodeGameState, decodeServerEvent, decodeStartGameResponse,
} from '../decoders'
import type { ServerEvent } from '../events'
import {
  createCompareReplay, createFinishedReplay, createHandReplay, createStartReplay,
  createShowdownReplay, protocolCases,
} from '../../test/fixtures/gameReplays'

const types = (events: ServerEvent[]) => events.map((event) => event.type)

describe('backend-shaped replay fixtures', () => {
  it('conserves all 6,000 chips throughout the six-seat start fixture', () => {
    const replay = createStartReplay(5)
    const total = replay.waiting.players.reduce((sum, player) => sum + player.chips, 0)
    expect(total).toBe(6000)
    expect(replay.humanTurn.players.reduce((sum, player) => sum + player.chips, 0)).toBe(5890)
    expect(replay.humanTurn.current_round?.pot).toBe(110)
    for (const snapshot of [replay.waiting, replay.dealt, replay.humanTurn,
      ...replay.start.flatMap((event) => event.type === 'game_state' ? [event.data] : [])]) {
      expect(snapshot.players.reduce((sum, player) => sum + player.chips, 0)
        + (snapshot.current_round?.pot ?? 0)).toBe(total)
    }
  })

  it.each([1, 2, 3, 4, 5] as const)('creates and starts with %i AI opponents in server seat order', (count) => {
    const replay = createStartReplay(count)
    expect(replay.waiting.players).toHaveLength(count + 1)
    expect(replay.waiting.current_round).toBeNull()
    expect(replay.rest.createRequest.ai_opponents.map((ai) => ai.model_id))
      .toEqual(replay.rest.createResponse.players.slice(1).map((ai) => ai.model_id))
    expect(decodeCreateGameResponse(replay.rest.createResponse).ok).toBe(true)
    expect(decodeStartGameResponse(replay.rest.startResponse).ok).toBe(true)
    expect(decodeGameState(replay.rest.viewerResponse).ok).toBe(true)
    expect(types(replay.connect)).toEqual(['game_state'])
    expect(types(replay.start).slice(0, 3)).toEqual(['round_started', 'game_state', 'cards_dealt'])
    expect(types(replay.start).filter((type) => type === 'ai_thinking')).toHaveLength(count)
    expect(types(replay.start).filter((type) => type === 'turn_changed')).toHaveLength(1)
    expect(types(replay.start)).not.toContain('game_started')
    expect(replay.dealt.current_round).toMatchObject({ phase: 'betting', dealer_index: 0,
      current_player_index: 1, pot: (count + 1) * 10, turn_count: 0 })
    expect(replay.humanTurn.current_round?.pot).toBe((count + 1) * 10 + count * 10)
    expect(replay.humanTurn.players.map((p) => p.chips)).toEqual([990, ...Array<number>(count).fill(980)])
    expect(replay.dealt.players[0]).toMatchObject({ status: 'active_blind', hand: expect.any(Array) })
    expect(replay.dealt.players.slice(1).every((p) => p.hand === null)).toBe(true)
  })

  it('replays peek, call, raise and fold before a settling compare', () => {
    const replay = createHandReplay()
    expect(types(replay.peek)).toEqual(['player_acted', 'game_state', 'turn_changed'])
    expect(replay.seen.players[0].status).toBe('active_seen')
    expect(replay.seen.current_round?.actions).toEqual(replay.humanTurn.current_round?.actions)
    expect(replay.seen.players.map((p) => p.chips)).toEqual(replay.humanTurn.players.map((p) => p.chips))
    expect(replay.seen.current_round?.current_player_index).toBe(0)
    expect(replay.beforeCompare.current_round?.actions.map((a) => [a.action, a.amount]))
      .toEqual([['call', 10], ['call', 10], ['call', 20], ['raise', 20], ['fold', 0]])
    expect(replay.beforeCompare.current_round?.current_bet).toBe(20)
    expect(replay.beforeCompare.players[2].status).toBe('folded')
    expect(replay.rest.actionRequest).toEqual({ player_id: 'human', action: 'compare', target_id: 'ai-1' })
    expect(replay.compareCommand).toEqual({ type: 'player_action', data: { action: 'compare', target: 'ai-1' } })
    expect(decodeActionResponse(replay.rest.actionResponse).ok).toBe(true)
    expect(decodeEndGameResponse(replay.rest.endResponse).ok).toBe(true)
  })

  it('captures already-paid snapshot → result → duplicate snapshot without a second payout', () => {
    const replay = createHandReplay()
    expect(types(replay.settlement)).toEqual(['player_acted', 'game_state', 'round_ended', 'game_state'])
    expect(replay.settlement[1]).toEqual(replay.settlement[3])
    expect(replay.settlement[1]).not.toBe(replay.settlement[3])
    expect(replay.settled.players.map((p) => p.chips)).toEqual([1060, 960, 980])
    expect(replay.settled.current_round).toMatchObject({ phase: 'settlement', pot: 130 })
    expect(replay.settled.round_history).toEqual([replay.result])
    expect(replay.result.player_chip_changes).toEqual({ human: 60, 'ai-1': -40, 'ai-2': -20 })
    expect(replay.result.win_method).toBe('其他玩家全部弃牌')
    expect(replay.result.hands_revealed).toBeNull()
    expect(replay.settled.players.reduce((sum, p) => sum + p.chips, 0)).toBe(3000)
    expect(replay.rest.actionResponse.game_state).toEqual(replay.settled)
    expect(replay.nextHand[0]).toMatchObject({ type: 'round_started', data: { round_number: 2, dealer_index: 1 } })
    expect(replay.nextHand[1]).toMatchObject({ type: 'game_state', data: {
      round_history: [replay.result], current_round: { phase: 'betting', pot: 30 },
    } })
    expect(types(replay.duplicateDelivery)).toEqual([
      'player_acted', 'game_state', 'round_ended', 'game_state', 'round_ended', 'game_state',
    ])
  })

  it('captures an off-turn WS peek without fabricating a turn notification or action record', () => {
    const { before, after, events } = createHandReplay().offTurnPeek
    expect(types(events)).toEqual(['player_acted', 'game_state'])
    expect(before.current_round?.current_player_index).toBe(1)
    expect(after.current_round).toEqual(before.current_round)
    expect(after.players[0]).toEqual({ ...before.players[0], status: 'active_seen' })
  })

  it('restores blind/seen/settled snapshots without replaying cards, comparisons or AI activity', () => {
    const replay = createHandReplay()
    expect(types(replay.reconnect.blind)).toEqual(['game_state', 'turn_changed'])
    expect(types(replay.reconnect.seen)).toEqual(['game_state', 'turn_changed'])
    expect(types(replay.reconnect.settled)).toEqual(['game_state'])
    expect(types(replay.reconnect.aiTurn)).toEqual(['game_state'])
    expect(replay.reconnect.seen[0]).toMatchObject({ data: { players: [
      expect.objectContaining({ id: 'human', status: 'active_seen' }),
      expect.objectContaining({ hand: null }), expect.objectContaining({ hand: null }),
    ] } })
  })

  it('keeps AI-vs-AI compare cards private while allowing the hand to continue', () => {
    const spectator = createCompareReplay('human')
    const participant = createCompareReplay('ai-1')
    expect(types(spectator.events)).toEqual(['player_acted', 'game_state', 'turn_changed'])
    expect(spectator.events[0]).toMatchObject({ data: { compare_result: {
      winner_id: 'ai-1', loser_id: 'ai-2', winner_cards: null, loser_cards: null,
      winner_hand: null, loser_hand: null,
    } } })
    expect(participant.events[0]).toMatchObject({ data: { compare_result: {
      winner_cards: expect.any(Array), loser_cards: expect.any(Array),
      winner_hand: expect.any(String), loser_hand: expect.any(String),
    } } })
    expect(spectator.after.current_round?.phase).toBe('betting')
    expect(spectator.after.round_history).toEqual([])
    expect(spectator.after.players.slice(1).every((p) => p.hand === null)).toBe(true)
    expect(participant.after.players.filter((p) => p.id !== 'ai-1').every((p) => p.hand === null)).toBe(true)
  })

  it('represents forced showdown reveals separately and does not claim natural turn-limit progression', () => {
    const replay = createShowdownReplay()
    expect(replay.setup).toBe('manually seeded turn limit (backend B01)')
    expect(types(replay.events)).toEqual(['player_acted', 'game_state', 'round_ended', 'game_state'])
    expect(replay.result.win_method).toBe('最大轮数到达，强制比牌')
    expect(Object.keys(replay.result.hands_revealed ?? {})).toEqual(['human', 'ai-1'])
    expect(replay.after.players.slice(1).every((p) => p.hand === null)).toBe(true)
  })

  it('places game_ended after both final snapshots, with no invented game ID in its data', () => {
    const replay = createFinishedReplay()
    expect(types(replay.events)).toEqual(['player_acted', 'game_state', 'round_ended', 'game_state', 'game_ended'])
    expect(replay.after.status).toBe('finished')
    expect(replay.after.current_round?.phase).toBe('game_over')
    expect(replay.after.players.map((p) => p.chips)).toEqual([200, 0])
    expect(replay.events.at(-1)).toEqual({ type: 'game_ended', data: {
      final_standings: [{ id: 'human', name: '玩家', chips: 200 }, { id: 'ai-1', name: '对手1', chips: 0 }],
    } })
  })

  it('makes fresh deterministic data on every call, including independent duplicate snapshots', () => {
    const first = createHandReplay()
    const second = createHandReplay()
    expect(first).toEqual(second)
    first.settled.players[0].chips = -1
    expect(second.settled.players[0].chips).toBe(1060)
    expect(first.settlement[1]).toMatchObject({ data: { players: [
      expect.objectContaining({ chips: 1060 }), expect.anything(), expect.anything(),
    ] } })
  })

  it('decodes every replayed event after a JSON wire round trip', () => {
    const hand = createHandReplay()
    const events = [
      ...hand.connect, ...hand.start, ...hand.peek, ...hand.actions, ...hand.settlement, ...hand.nextHand,
      ...hand.offTurnPeek.events, ...hand.duplicateDelivery,
      ...Object.values(hand.reconnect).flat(), ...createCompareReplay('human').events,
      ...createCompareReplay('ai-1').events, ...createShowdownReplay().events, ...createFinishedReplay().events,
    ]
    for (const event of events) {
      expect(decodeServerEvent(JSON.stringify(event))).toEqual({ kind: 'event', event })
    }
  })

  it.each(protocolCases)('handles $name without throwing or retaining raw diagnostics', ({ input, kind }) => {
    expect(decodeServerEvent(input).kind).toBe(kind)
  })
})
