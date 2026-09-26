import { describe, expect, it } from 'vitest'
import {
  decodeActionResponse, decodeGameState, decodeReviewList, decodeRoundResult,
  decodeServerEvent, decodeSummary,
} from '../decoders'
import type { DecodeResult } from '../decoders'
import { createHandReplay } from '../../test/fixtures/gameReplays'
import { createReadFixtures } from '../../test/fixtures/restFixtures'

const dangerousKeys = ['__proto__', 'constructor', 'prototype']
const opaqueIds = ['ai-1', 'player/玩家:版本?x=1%2F+#', 'player/__proto__', 'constructor-1',
  'prototype:v2', 'toString', 'hasOwnProperty']
const cards = [{ suit: 'spades', rank: 14 }]

// Computed keys and a JSON round trip make __proto__ an own data property,
// unlike the special __proto__ syntax in an ordinary object literal.
function wireDictionary(key: string, value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ human: value, [key]: value }))
}

const paths: {
  path: string
  validValue: unknown
  payload: (dictionary: unknown) => unknown
  decode: (input: unknown) => DecodeResult<unknown>
}[] = [
  {
    path: 'hands_revealed', validValue: cards,
    payload: (dictionary) => ({ ...createHandReplay().result, hands_revealed: dictionary }),
    decode: decodeRoundResult,
  },
  {
    path: 'player_chip_changes', validValue: 60,
    payload: (dictionary) => ({ ...createHandReplay().result, player_chip_changes: dictionary }),
    decode: decodeRoundResult,
  },
  {
    path: 'reviews[].opponent_patterns', validValue: '谨慎',
    payload: (dictionary) => {
      const { reviews } = createReadFixtures()
      return { ...reviews, reviews: [{ ...reviews.reviews[0], opponent_patterns: dictionary }] }
    },
    decode: decodeReviewList,
  },
  {
    path: 'opponent_impressions', validValue: '谨慎',
    payload: (dictionary) => ({ ...createReadFixtures().summary, opponent_impressions: dictionary }),
    decode: decodeSummary,
  },
]

describe.each(paths)('$path dictionary keys', ({ validValue, payload, decode }) => {
  it.each(dangerousKeys)('rejects JSON-parsed own key %s even with a valid value', (key) => {
    const dictionary = wireDictionary(key, validValue)
    expect(Object.hasOwn(dictionary, key)).toBe(true)
    expect(decode(payload(dictionary))).toEqual({ ok: false })
  })

  it('preserves ordinary opaque IDs verbatim, including safe names containing reserved words', () => {
    for (const id of opaqueIds) {
      const dictionary = wireDictionary(id, validValue)
      const input = payload(dictionary)
      expect(decode(input)).toEqual({ ok: true, value: input })
      expect(Object.hasOwn(dictionary, id)).toBe(true)
    }
  })

  it('still accepts empty dictionaries', () => {
    const input = payload({})
    expect(decode(input)).toEqual({ ok: true, value: input })
  })
})

describe.each(['hands_revealed', 'player_chip_changes'] as const)('nested %s rejection', (field) => {
  it.each(dangerousKeys)('rejects own key %s through REST and WebSocket envelopes', (key) => {
    const replay = createHandReplay()
    const result = { ...replay.result, [field]: wireDictionary(key, field === 'hands_revealed' ? cards : 60) }
    const state = { ...replay.settled, round_history: [result] }
    expect(decodeGameState(state)).toEqual({ ok: false })
    expect(decodeActionResponse({ ...replay.rest.actionResponse, round_result: result })).toEqual({ ok: false })
    expect(decodeActionResponse({ ...replay.rest.actionResponse, game_state: state })).toEqual({ ok: false })
    for (const event of [{ type: 'round_ended', data: result },
      { type: 'game_state', data: state }, { type: 'game_started', data: state }]) {
      expect(decodeServerEvent(JSON.stringify(event))).toEqual({ kind: 'invalid' })
    }
  })
})
