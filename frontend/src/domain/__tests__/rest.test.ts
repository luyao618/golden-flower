import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  decodeChatList, decodeModelCatalog, decodeModels, decodeNarrative, decodeReviewList,
  decodeServerEvent, decodeSummary, decodeThoughtList,
} from '../decoders'
import type { ActionRecordDTO, CardDTO, PlayerDTO, PlayerActionRequestDTO } from '../game'
import type { ClientCommand, LiveChatDTO, ServerEvent } from '../events'
import type { ThoughtRecordDTO } from '../rest'
import { createReadFixtures } from '../../test/fixtures/restFixtures'

describe('nullable REST read contracts', () => {
  it('checks nullable types and distinct REST/WS target fields at compile time', () => {
    expectTypeOf<PlayerDTO['hand']>().toEqualTypeOf<CardDTO[] | null>()
    expectTypeOf<PlayerDTO['model_id']>().toEqualTypeOf<string | null>()
    expectTypeOf<ThoughtRecordDTO['confidence']>().toEqualTypeOf<number | null>()
    expectTypeOf<ActionRecordDTO['amount']>().toEqualTypeOf<number | null>()
    expectTypeOf<ActionRecordDTO['target_id']>().toEqualTypeOf<string | null>()
    expectTypeOf<PlayerActionRequestDTO>().toHaveProperty('target_id')
    expectTypeOf<Extract<ClientCommand, { type: 'player_action' }>['data']>().toHaveProperty('target')
    expectTypeOf<Extract<ClientCommand, { type: 'player_action' }>['data']>().not.toHaveProperty('target_id')
    expectTypeOf<PlayerActionRequestDTO>().not.toHaveProperty('amount')
    expectTypeOf<Extract<ServerEvent, { type: 'chat_message' }>['data']>().toEqualTypeOf<LiveChatDTO>()
    expectTypeOf<LiveChatDTO>().not.toHaveProperty('round_number')
    expectTypeOf<LiveChatDTO>().not.toHaveProperty('inner_thought')
  })

  it('reads empty and sparse journals without turning missing confidence into zero', () => {
    const { thoughts, emptyThoughts } = createReadFixtures()
    expect(decodeThoughtList(thoughts)).toEqual({ ok: true, value: thoughts })
    expect(decodeThoughtList(emptyThoughts)).toEqual({ ok: true, value: emptyThoughts })
    expect(thoughts.thoughts[0].confidence).toBeNull()
    expect(emptyThoughts.round_number).toBeNull()
  })

  it('keeps null narrative/review fields and nested summary statistics', () => {
    const { narrative, reviews, summary, emptySummary } = createReadFixtures()
    expect(decodeNarrative(narrative)).toEqual({ ok: true, value: narrative })
    expect(decodeReviewList(reviews)).toEqual({ ok: true, value: reviews })
    expect(decodeSummary(summary)).toEqual({ ok: true, value: summary })
    expect(decodeSummary(emptySummary)).toEqual({ ok: true, value: emptySummary })
    expect(summary.stats?.rounds_played).toBe(1)
    expect(decodeSummary({ ...summary, stats: undefined, rounds_played: 1 })).toEqual({ ok: false })
    expect(decodeSummary({ ...summary, stats: { ...summary.stats, fold_rate: '0.5' } })).toEqual({ ok: false })
    expect(decodeReviewList({ ...reviews, reviews: [{ ...reviews.reviews[0], rounds_reviewed: ['1'] }] }))
      .toEqual({ ok: false })
    expect(decodeNarrative({ ...narrative, outcome: undefined })).toEqual({ ok: false })
  })

  it('keeps archive/live chat IDs and times distinct, including valid repeated text', () => {
    const { chat, liveChat } = createReadFixtures()
    expect(decodeChatList(chat)).toEqual({ ok: true, value: chat })
    for (const message of liveChat) {
      expect(decodeServerEvent({ type: 'chat_message', data: message }).kind).toBe('event')
      expect(message).not.toHaveProperty('round_number')
      expect(message).not.toHaveProperty('inner_thought')
    }
    expect(chat.messages[0].id).not.toBe(liveChat[0].id)
    expect(chat.messages[0].timestamp).not.toBe(liveChat[0].timestamp)
    expect(chat.messages.map((m) => m.content)).toEqual(liveChat.map((m) => m.content))
    expect(liveChat[0].content).toBe(liveChat[1].content)
    expect(liveChat[0].id).not.toBe(liveChat[1].id)
    expect(chat.messages[0].inner_thought).toBe('仅存档，不公开展示')
    expect(decodeChatList({ ...chat, messages: [{ ...chat.messages[0], id: 1 }] })).toEqual({ ok: false })
  })

  it('preserves IDs and original metadata for all providers, and nullable catalog context length', () => {
    const { models, catalog } = createReadFixtures()
    expect(decodeModels(models)).toEqual({ ok: true, value: models })
    expect(decodeModelCatalog(catalog)).toEqual({ ok: true, value: catalog })
    expect(models.map((m) => m.provider)).toEqual(['openrouter', 'siliconflow', 'azure_openai', 'zhipu', 'github_copilot'])
    expect(catalog.models[0].context_length).toBeNull()
    expect(decodeModelCatalog({ ...catalog, models: [{ ...catalog.models[0], context_length: undefined }] }))
      .toEqual({ ok: false })
    expect(decodeModels([{ ...models[0], openrouter_id: null }])).toEqual({ ok: false })
  })

  it('preserves the Copilot registry provider independently of the model ID prefix', () => {
    // backend/app/config.py COPILOT_MODELS, returned by /api/models when connected.
    const registeredModel = { id: 'copilot-gpt4o', model: 'gpt-4o',
      provider: 'github_copilot', display_name: 'Copilot GPT-4o' }
    expect(createReadFixtures().models.find((model) => model.id === registeredModel.id)).toEqual(registeredModel)
    expect(decodeModels(JSON.parse(JSON.stringify([registeredModel]))))
      .toEqual({ ok: true, value: [registeredModel] })
  })
})
