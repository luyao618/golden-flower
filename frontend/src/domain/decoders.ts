import type {
  ActionRecordDTO, ActionResponseDTO, CardDTO, CompareResultDTO, CreateGameResponseDTO,
  EndGameResponseDTO, GameConfigDTO, GameStateDTO, PlayerDTO, PlayerIdentityDTO,
  RoundResultDTO, RoundStateDTO, StandingDTO, StartGameResponseDTO,
} from './game'
import type { LiveChatDTO, ServerEvent, ServerEventData } from './events'
import type {
  ChatListDTO, ChatMessageDTO, ExperienceReviewDTO, ModelCatalogDTO, ModelDTO,
  NarrativeDTO, ReviewListDTO, SettingsDTO, SummaryDTO, SummaryStatsDTO,
  ThoughtListDTO, ThoughtRecordDTO,
} from './rest'
import type {
  AddedModelDTO, CopilotConnectDTO, CopilotModelDTO, CopilotPollDTO, CopilotStatusDTO,
  KeyProvider, MessageDTO, ProviderConfigDTO, ProviderConfigResponseDTO, ProviderStatusDTO,
  RemovedModelDTO, VerifyKeyDTO,
} from './providers'

type Guard<T> = (value: unknown) => value is T
export type DecodeResult<T> = { ok: true, value: T } | { ok: false }

const string: Guard<string> = (v): v is string => typeof v === 'string'
const number: Guard<number> = (v): v is number => typeof v === 'number' && Number.isFinite(v)
const integer: Guard<number> = (v): v is number => number(v) && Number.isSafeInteger(v)
const boolean: Guard<boolean> = (v): v is boolean => typeof v === 'boolean'
const record: Guard<Record<string, unknown>> = (v): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const nullable = <T>(guard: Guard<T>): Guard<T | null> => (v): v is T | null => v === null || guard(v)
const optional = <T>(guard: Guard<T>): Guard<T | undefined> => (v): v is T | undefined =>
  v === undefined || guard(v)
const array = <T>(guard: Guard<T>): Guard<T[]> => (v): v is T[] => Array.isArray(v) && v.every(guard)
// Reject prototype-related keys before consumers copy or merge these records.
const dictionary = <T>(guard: Guard<T>): Guard<Record<string, T>> => (v): v is Record<string, T> =>
  record(v) && !Object.hasOwn(v, '__proto__') && !Object.hasOwn(v, 'constructor') &&
  !Object.hasOwn(v, 'prototype') && Object.values(v).every(guard)
const oneOf = <T extends string | number>(...values: T[]): Guard<T> => (v): v is T =>
  values.some((item) => item === v)

/** Require every declared field to pass; allow additive server fields. No coercion/defaults. */
const object = <T>(fields: { [K in keyof T]-?: Guard<T[K]> }): Guard<T> => (v): v is T => {
  if (!record(v)) return false
  for (const key in fields) {
    if (!fields[key](Object.hasOwn(v, key) ? v[key] : undefined)) return false
  }
  return true
}
const decoder = <T>(guard: Guard<T>) => (value: unknown): DecodeResult<T> =>
  guard(value) ? { ok: true, value } : { ok: false }

const action = oneOf('fold', 'call', 'raise', 'check_cards', 'compare')
const card = object<CardDTO>({
  suit: oneOf('hearts', 'diamonds', 'clubs', 'spades'),
  rank: oneOf(2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14),
})
const identityFields = {
  id: string, name: string, avatar: string, player_type: oneOf('human', 'ai'),
  chips: integer, model_id: nullable(string),
}
const player = object<PlayerDTO>({
  ...identityFields, status: oneOf('active_blind', 'active_seen', 'folded', 'compare_lost', 'out'),
  hand: nullable(array(card)), total_bet_this_round: integer,
})
const config = object<GameConfigDTO>({ initial_chips: integer, ante: integer, max_bet: integer, max_turns: integer })
const actionRecord = object<ActionRecordDTO>({
  player_id: string, player_name: string, action, amount: nullable(integer),
  target_id: nullable(string), timestamp: number,
})
const round = object<RoundStateDTO>({
  round_number: integer, pot: integer, current_bet: integer, dealer_index: integer,
  current_player_index: integer, actions: array(actionRecord),
  phase: oneOf('waiting', 'dealing', 'betting', 'comparing', 'settlement', 'game_over'),
  turn_count: integer, max_turns: integer,
})
const roundResult = object<RoundResultDTO>({
  round_number: integer, winner_id: string, winner_name: string, pot: integer,
  win_method: string, hands_revealed: nullable(dictionary(array(card))),
  player_chip_changes: dictionary(integer),
})
const gameState = object<GameStateDTO>({
  game_id: string, players: array(player), current_round: nullable(round),
  round_history: array(roundResult), config, status: oneOf('waiting', 'playing', 'finished'),
})
const compareResult = object<CompareResultDTO>({
  winner_id: string, winner_name: string, loser_id: string, loser_name: string,
  winner_hand: nullable(string), loser_hand: nullable(string),
  winner_cards: nullable(array(card)), loser_cards: nullable(array(card)),
})
const standing = object<StandingDTO>({ id: string, name: string, chips: integer })

export const decodeGameState = decoder(gameState)
export const decodeRoundResult = decoder(roundResult)
export const decodeCreateGameResponse = decoder(object<CreateGameResponseDTO>({
  game_id: string, message: string, players: array(object<PlayerIdentityDTO>(identityFields)),
}))
export const decodeStartGameResponse = decoder(object<StartGameResponseDTO>({
  message: string, round_number: integer, dealer_index: integer, pot: integer,
  current_player_index: integer, game_state: gameState,
}))
export const decodeActionResponse = decoder(object<ActionResponseDTO>({
  success: boolean, action, player_id: string, amount: integer, message: string,
  compare_result: nullable(compareResult), round_ended: boolean,
  round_result: nullable(roundResult), game_state: nullable(gameState),
}))
export const decodeEndGameResponse = decoder(object<EndGameResponseDTO>({
  message: string, game_id: string, final_standings: array(standing),
}))

const liveChatFields = {
  id: string, player_id: string, player_name: string,
  message_type: oneOf('action_talk', 'bystander_react', 'player_message', 'system_message'),
  content: string, timestamp: number,
}
const actorFields = { player_id: string, player_name: string }
const eventData: { [K in keyof ServerEventData]: Guard<ServerEventData[K]> } = {
  game_state: gameState,
  game_started: gameState,
  round_started: object({ round_number: integer, dealer: string, dealer_index: integer,
    pot: integer, current_bet: integer, max_turns: integer }),
  cards_dealt: object({ your_cards: nullable(array(card)) }),
  turn_changed: object({ current_player: string, current_player_id: string, available_actions: array(string) }),
  player_acted: object({ ...actorFields, action, amount: integer,
    compare_result: nullable(compareResult), is_fallback: boolean }),
  chat_message: object<LiveChatDTO>(liveChatFields),
  round_ended: roundResult,
  game_ended: object({ final_standings: array(standing) }),
  ai_thinking: object(actorFields),
  ai_reviewing: object({ ...actorFields, trigger: string }),
  error: object({ message: string }),
  copilot_error: object({ message: string, error_code: string }),
}
const eventType = (v: string): v is keyof ServerEventData => Object.hasOwn(eventData, v)
const serverEvent: Guard<ServerEvent> = (v): v is ServerEvent =>
  record(v) && string(v.type) && eventType(v.type) && eventData[v.type](v.data)

export type DecodedServerEvent =
  | { kind: 'event', event: ServerEvent }
  | { kind: 'unknown', type: string }
  | { kind: 'invalid' }

/** Accept a parsed JSON value or a text frame. Diagnostics never retain private/raw payloads.
 * This is structural validation, not redaction, game legality, or a transport controller.
 */
export function decodeServerEvent(input: unknown): DecodedServerEvent {
  let value: unknown = input
  if (typeof input === 'string') {
    try { value = JSON.parse(input) } catch { return { kind: 'invalid' } }
  }
  if (!record(value) || !Object.hasOwn(value, 'type') || !string(value.type) ||
    !Object.hasOwn(value, 'data')) return { kind: 'invalid' }
  if (!eventType(value.type)) return { kind: 'unknown', type: value.type }
  return serverEvent(value) ? { kind: 'event', event: value } : { kind: 'invalid' }
}

const reportIdentity = { id: integer, game_id: string, agent_id: string }
const nullableText = nullable(string)
const thought = object<ThoughtRecordDTO>({
  ...reportIdentity, round_number: integer, turn_number: integer, decision: string,
  hand_evaluation: nullableText, opponent_analysis: nullableText, risk_assessment: nullableText,
  chat_analysis: nullableText, reasoning: nullableText, confidence: nullable(number), emotion: nullableText,
  decision_target: nullableText, table_talk: nullableText, raw_response: nullableText, created_at: nullableText,
})
export const decodeThoughtList = decoder(object<ThoughtListDTO>({
  game_id: string, agent_id: string, round_number: nullable(integer), thoughts: array(thought), count: integer,
}))
export const decodeNarrative = decoder(object<NarrativeDTO>({
  ...reportIdentity, round_number: integer, narrative: string, outcome: nullableText, created_at: nullableText,
}))
const review = object<ExperienceReviewDTO>({
  ...reportIdentity, trigger: string, triggered_at_round: integer, rounds_reviewed: nullable(array(integer)),
  self_analysis: nullableText, opponent_patterns: nullable(dictionary(string)), strategy_adjustment: nullableText,
  confidence_shift: nullable(number), strategy_context: nullableText, created_at: nullableText,
})
export const decodeReviewList = decoder(object<ReviewListDTO>({
  game_id: string, agent_id: string, reviews: array(review), count: integer,
}))
const stats = object<SummaryStatsDTO>({
  rounds_played: integer, rounds_won: integer, total_chips_won: integer, total_chips_lost: integer,
  biggest_win: integer, biggest_loss: integer, fold_rate: number,
})
export const decodeSummary = decoder(object<SummaryDTO>({
  ...reportIdentity, stats: nullable(stats), key_moments: nullable(array(string)),
  opponent_impressions: nullable(dictionary(string)), self_reflection: nullableText,
  chat_strategy_summary: nullableText, learning_journey: nullableText, narrative_summary: nullableText,
  created_at: nullableText,
}))
const archivedChat = object<ChatMessageDTO>({
  ...liveChatFields, game_id: string, round_number: integer, related_action: nullableText,
  trigger_event: nullableText, inner_thought: nullableText, created_at: nullableText,
})
export const decodeChatList = decoder(object<ChatListDTO>({
  game_id: string, round_number: nullable(integer), messages: array(archivedChat), count: integer,
}))
export const decodeSettings = decoder(object<SettingsDTO>({
  llm_max_tokens: nullable(integer), ai_thinking_mode: oneOf('detailed', 'fast', 'turbo'),
  llm_timeout: integer, llm_max_retries: integer, llm_temperature: number,
}))
export const decodeModels = decoder(array(object<ModelDTO>({
  id: string, model: string, display_name: string, provider: string,
  openrouter_id: optional(string), siliconflow_id: optional(string), azure_id: optional(string), zhipu_id: optional(string),
})))
export const decodeModelCatalog = decoder(object<ModelCatalogDTO>({
  models: array(object({ id: string, name: string, context_length: nullable(integer),
    pricing: object({ prompt: string, completion: string }) })), total: integer,
}))

export const decodeAddedModels = decoder(object<{ models: ModelDTO[] }>({
  models: (v): v is ModelDTO[] => decodeModels(v).ok,
}))
const providerConfig = object<ProviderConfigDTO>({ api_host: optional(string), api_version: optional(string) })
export const decodeProviders = decoder(array(object<ProviderStatusDTO>({
  provider: string, name: string, configured: boolean, key_preview: nullable(string),
  extra_config: optional(providerConfig),
})))
export const decodeVerifyKey = decoder(object<VerifyKeyDTO>({ valid: boolean, message: string }))
export const decodeProviderConfig = decoder(object<ProviderConfigResponseDTO>({
  message: string, provider: string, extra_config: providerConfig,
}))
export const decodeMessage = decoder(object<MessageDTO>({ message: string }))
export const decodeRemovedModel = decoder(object<RemovedModelDTO>({ message: string, model_id: string }))
const addedModelBase = object({ message: string, model_id: string, display_name: string })
const originalIds = { openrouter: 'openrouter_id', siliconflow: 'siliconflow_id',
  azure_openai: 'azure_id', zhipu: 'zhipu_id' } as const
export function decodeAddedModel<P extends KeyProvider>(provider: P, value: unknown): DecodeResult<AddedModelDTO<P>> {
  const guard = (v: unknown): v is AddedModelDTO<P> =>
    record(v) && Object.hasOwn(v, originalIds[provider]) && string(v[originalIds[provider]]) && addedModelBase(v)
  return decoder(guard)(value)
}
export const decodeCancelledSummaries = decoder(object<{ game_id: string, cancelled: number }>({
  game_id: string, cancelled: integer,
}))
const copilotModels = array(object<CopilotModelDTO>({ id: string, model: string, display_name: string }))
export const decodeCopilotConnect = decoder(object<CopilotConnectDTO>({
  user_code: string, verification_uri: string, expires_in: integer,
}))
const copilotPending = object({ status: oneOf('pending'), slow_down: optional(boolean), interval: optional(integer) })
const copilotConnected = object({ status: oneOf('connected'), models: copilotModels })
export const decodeCopilotPoll = decoder((v: unknown): v is CopilotPollDTO => copilotPending(v) || copilotConnected(v))
export const decodeCopilotStatus = decoder(object<CopilotStatusDTO>({
  connected: boolean, has_valid_token: boolean, models: copilotModels,
}))
