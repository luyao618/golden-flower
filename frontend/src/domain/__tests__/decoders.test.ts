import { describe, expect, it } from 'vitest'
import {
  decodeActionResponse,
  decodeGameState,
  decodeModels,
  decodeServerEvent,
  decodeSettings,
  decodeThoughtList,
} from '../decoders'
import { createCompareReplay, createHandReplay, protocolCases } from '../../test/fixtures/gameReplays'

const waiting = {
  game_id: 'game-1', status: 'waiting', current_round: null, round_history: [],
  config: { initial_chips: 1000, ante: 10, max_bet: 200, max_turns: 10 },
  players: [{
    id: 'human', name: '玩家', avatar: 'avatar_human', player_type: 'human',
    chips: 1000, status: 'active_blind', hand: null, model_id: null,
    total_bet_this_round: 0,
  }],
}

describe('defensive wire decoding', () => {
  it('keeps explicit nulls and accepts additive fields without normalizing facts', () => {
    const input = { ...waiting, future_field: 'allowed' }
    const result = decodeGameState(input)
    expect(result).toEqual({ ok: true, value: input })
    expect(input.players[0].hand).toBeNull()
  })

  it.each([
    null, [], {}, { ...waiting, current_round: undefined },
    { ...waiting, status: 'paused' },
    { ...waiting, players: [{ ...waiting.players[0], hand: undefined }] },
    { ...waiting, players: [{ ...waiting.players[0], chips: '1000' }] },
    { ...waiting, players: [{ ...waiting.players[0], chips: NaN }] },
    { ...waiting, players: [{ ...waiting.players[0], chips: 1.5 }] },
    { ...waiting, players: [{ ...waiting.players[0], hand: [{ suit: 'stars', rank: 14 }] }] },
    { ...waiting, players: [{ ...waiting.players[0], hand: [{ suit: 'hearts', rank: 15 }] }] },
  ])('rejects malformed nested state without throwing: %j', (input) => {
    expect(decodeGameState(input)).toEqual({ ok: false })
  })

  it('distinguishes unknown event types from malformed envelopes and known payloads', () => {
    expect(decodeServerEvent({ type: 'future_event', data: { secret: 'discard' } }))
      .toEqual({ kind: 'unknown', type: 'future_event' })
    for (const input of ['{bad json', 'null', '[]', '{}', '{"type":"error"}',
      { type: 'error', data: { message: 5 } }, { type: 'game_state', data: null }]) {
      expect(decodeServerEvent(input)).toEqual({ kind: 'invalid' })
    }
    for (const type of ['toString', 'constructor', '__proto__']) {
      expect(decodeServerEvent({ type, data: {} })).toEqual({ kind: 'unknown', type })
    }
  })

  it('validates required payload fields for every known event, including dormant builders', () => {
    const replay = createHandReplay()
    const inputs: unknown[] = [...replay.start, ...replay.peek, ...replay.actions, ...replay.settlement,
      { type: 'game_ended', data: { final_standings: [] } },
      ...protocolCases.filter((entry) => entry.kind === 'event').map((entry) => entry.input)]
    const checkedTypes = new Set<string>()
    for (const input of inputs) {
      const decoded = decodeServerEvent(input)
      if (decoded.kind !== 'event') throw new Error('Expected a valid fixture event')
      checkedTypes.add(decoded.event.type)
      for (const key of Object.keys(decoded.event.data)) {
        const data = Object.fromEntries(Object.entries(decoded.event.data).filter(([field]) => field !== key))
        expect(decodeServerEvent({ type: decoded.event.type, data })).toEqual({ kind: 'invalid' })
      }
    }
    expect(checkedTypes.size).toBe(13)
  })

  it('accepts explicit nullable action records and rejects malformed nested comparison/results', () => {
    const replay = createHandReplay()
    const action = replay.beforeCompare.current_round?.actions[0]
    const round = { ...replay.beforeCompare.current_round,
      actions: [{ ...action, amount: null, target_id: null }] }
    expect(decodeGameState({ ...replay.beforeCompare, current_round: round }).ok).toBe(true)
    expect(decodeGameState({ ...replay.beforeCompare, current_round: {
      ...round, actions: [{ ...action, timestamp: Infinity }],
    } }).ok).toBe(false)
    const compare = createCompareReplay('human').events[0]
    expect(decodeServerEvent(compare).kind).toBe('event')
    expect(decodeServerEvent({ ...compare, data: { ...compare.data,
      compare_result: { winner_id: 'ai-1' },
    } })).toEqual({ kind: 'invalid' })
    expect(decodeServerEvent({ type: 'round_ended', data: {
      ...replay.result, player_chip_changes: { human: '60' },
    } })).toEqual({ kind: 'invalid' })
    expect(decodeServerEvent({ type: 'round_ended', data: {
      ...replay.result, hands_revealed: { human: [{ suit: 'spades', rank: 1 }] },
    } })).toEqual({ kind: 'invalid' })
    const futureWording = { ...replay.result, win_method: '新的服务端描述' }
    expect(decodeServerEvent({ type: 'round_ended', data: futureWording }))
      .toEqual({ kind: 'event', event: { type: 'round_ended', data: futureWording } })
  })

  it('decodes JSON frames, including the dormant game_started event', () => {
    const event = { type: 'game_started', data: waiting }
    expect(decodeServerEvent(JSON.stringify(event))).toEqual({ kind: 'event', event })
    expect(decodeServerEvent({ type: 'cards_dealt', data: { your_cards: null } }))
      .toEqual({ kind: 'event', event: { type: 'cards_dealt', data: { your_cards: null } } })
  })

  it('preserves unknown action names in turn hints without expanding command types', () => {
    const event = { type: 'turn_changed', data: {
      current_player: '玩家', current_player_id: 'human', available_actions: ['fold', 'future_action'],
    } }
    expect(decodeServerEvent(event)).toEqual({ kind: 'event', event })
  })

  it('requires nullable REST action fields instead of inventing empty snapshots', () => {
    const action = { success: true, action: 'fold', player_id: 'human', amount: 0,
      message: '', compare_result: null, round_ended: false, round_result: null, game_state: null }
    expect(decodeActionResponse(action)).toEqual({ ok: true, value: action })
    expect(decodeActionResponse({ ...action, game_state: undefined })).toEqual({ ok: false })
  })

  it('preserves nullable recorded thoughts and raw output as plain wire data', () => {
    const thought = {
      id: 1, game_id: 'game-1', agent_id: 'ai-1', round_number: 1, turn_number: 1,
      decision: 'call', decision_target: null, hand_evaluation: null, opponent_analysis: null,
      risk_assessment: null, chat_analysis: null, reasoning: null, confidence: null,
      emotion: null, table_talk: null, raw_response: '<b>untrusted model text</b>', created_at: null,
    }
    const input = { game_id: 'game-1', agent_id: 'ai-1', round_number: null, thoughts: [thought], count: 1 }
    expect(decodeThoughtList(input)).toEqual({ ok: true, value: input })
    expect(decodeThoughtList({ ...input, thoughts: [{ ...thought, confidence: undefined }] }))
      .toEqual({ ok: false })
    expect(decodeThoughtList({ ...input, thoughts: [{ ...thought, confidence: '0.5' }] }))
      .toEqual({ ok: false })
  })

  it('keeps a null token limit and opaque registered model IDs verbatim', () => {
    const settings = { llm_max_tokens: null, ai_thinking_mode: 'fast', llm_timeout: 30,
      llm_max_retries: 0, llm_temperature: 0.7 }
    expect(decodeSettings(settings)).toEqual({ ok: true, value: settings })
    expect(decodeSettings({ ...settings, llm_max_tokens: undefined })).toEqual({ ok: false })
    const models = [{ id: 'custom/id:版本?x=1%2F+#', model: 'vendor/original-model',
      display_name: '模型', provider: 'openrouter', openrouter_id: 'vendor/original-model' }]
    expect(decodeModels(models)).toEqual({ ok: true, value: models })
    expect(decodeModels([{ ...models[0], id: null }])).toEqual({ ok: false })
  })
})
