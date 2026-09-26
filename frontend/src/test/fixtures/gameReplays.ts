import type {
  ActionRecordDTO, ActionResponseDTO, CardDTO, CompareResultDTO, CreateGameRequestDTO,
  CreateGameResponseDTO, EndGameResponseDTO, GameAction, GameStateDTO, PlayerActionRequestDTO,
  PlayerDTO, RoundResultDTO, RoundStateDTO, StartGameResponseDTO,
} from '../../domain/game'
import type { ClientCommand, ServerEvent, ServerEventData } from '../../domain/events'

/** Synthetic, deterministic wire examples; provenance and limitations are in README.md. */
const gameId = 'fixture-game'
const timestamp = 1_790_424_000
const modelId = 'registry/opaque:模型?revision=2%2F+#'
const humanCards: CardDTO[] = [
  { suit: 'spades', rank: 14 }, { suit: 'spades', rank: 13 }, { suit: 'spades', rank: 12 },
]
const aiCards: CardDTO[] = [
  { suit: 'hearts', rank: 10 }, { suit: 'clubs', rank: 10 }, { suit: 'diamonds', rank: 4 },
]
const losingCards: CardDTO[] = [
  { suit: 'clubs', rank: 9 }, { suit: 'diamonds', rank: 7 }, { suit: 'hearts', rank: 2 },
]

const copy = <T>(value: T): T => structuredClone(value)
const event = <K extends keyof ServerEventData>(type: K, data: ServerEventData[K]) =>
  ({ type, data: copy(data) })
const snapshot = (state: GameStateDTO) => event('game_state', state)
const currentRound = (state: GameStateDTO): RoundStateDTO => {
  if (!state.current_round) throw new Error('Fixture needs an active round')
  return state.current_round
}
const player = (state: GameStateDTO, id: string): PlayerDTO => {
  const found = state.players.find((p) => p.id === id)
  if (!found) throw new Error(`Missing fixture player: ${id}`)
  return found
}

// Copies explicit facts, not an implementation of game rules or a replay reducer.
function changed(state: GameStateDTO, round: Partial<RoundStateDTO>, players: Record<string, Partial<PlayerDTO>>): GameStateDTO {
  const next = copy(state)
  next.current_round = { ...currentRound(next), ...copy(round) }
  for (const [id, patch] of Object.entries(players)) Object.assign(player(next, id), copy(patch))
  return next
}

function recorded(state: GameStateDTO, id: string, action: GameAction, amount: number, target: string | null = null): ActionRecordDTO[] {
  const actions = currentRound(state).actions
  return [...copy(actions), { player_id: id, player_name: player(state, id).name,
    action, amount, target_id: target, timestamp: timestamp + actions.length + 1 }]
}

function acted(state: GameStateDTO, id: string, action: GameAction, amount: number,
  compare: CompareResultDTO | null = null, fallback = false) {
  return event('player_acted', { player_id: id, player_name: player(state, id).name,
    action, amount, compare_result: compare, is_fallback: fallback })
}

function humanTurn(state: GameStateDTO) {
  const seen = player(state, 'human').status === 'active_seen'
  return event('turn_changed', { current_player: '玩家', current_player_id: 'human',
    available_actions: seen ? ['fold', 'call', 'raise', 'compare'] : ['fold', 'call', 'check_cards', 'raise'] })
}

function startEvents(state: GameStateDTO): ServerEvent[] {
  const round = currentRound(state)
  return [event('round_started', { round_number: round.round_number,
    dealer: state.players[round.dealer_index].name, dealer_index: round.dealer_index,
    pot: round.pot, current_bet: round.current_bet, max_turns: round.max_turns }),
  snapshot(state), event('cards_dealt', { your_cards: player(state, 'human').hand })]
}

function settlementEvents(action: ServerEvent, state: GameStateDTO, result: RoundResultDTO): ServerEvent[] {
  return [action, snapshot(state), event('round_ended', result), snapshot(state)]
}

export function createStartReplay(aiCount: 1 | 2 | 3 | 4 | 5 = 2) {
  const waiting: GameStateDTO = {
    game_id: gameId, status: 'waiting', current_round: null, round_history: [],
    config: { initial_chips: 1000, ante: 10, max_bet: 200, max_turns: 10 },
    players: Array.from({ length: aiCount + 1 }, (_, index): PlayerDTO => ({
      id: index === 0 ? 'human' : `ai-${index}`, name: index === 0 ? '玩家' : `对手${index}`,
      avatar: index === 0 ? 'avatar_human' : `avatar_${index}`, player_type: index === 0 ? 'human' : 'ai',
      chips: 1000, model_id: index === 0 ? null : modelId, status: 'active_blind',
      hand: null, total_bet_this_round: 0,
    })),
  }
  const dealt: GameStateDTO = { ...copy(waiting), status: 'playing', current_round: {
    round_number: 1, pot: (aiCount + 1) * 10, current_bet: 10, dealer_index: 0,
    current_player_index: 1, actions: [], phase: 'betting', turn_count: 0, max_turns: 10,
  } }
  for (const p of dealt.players) {
    p.chips = 990
    p.total_bet_this_round = 10
  }
  dealt.players[0].hand = copy(humanCards)

  const start = startEvents(dealt)
  let state = copy(dealt)
  for (let index = 1; index <= aiCount; index++) {
    const id = `ai-${index}`
    start.push(event('ai_thinking', { player_id: id, player_name: player(state, id).name }))
    state = changed(state, { pot: currentRound(state).pot + 10,
      current_player_index: index === aiCount ? 0 : index + 1,
      actions: recorded(state, id, 'call', 10) }, { [id]: { chips: 980, total_bet_this_round: 20 } })
    start.push(acted(state, id, 'call', 10), snapshot(state))
  }
  start.push(humanTurn(state))

  const createRequest: CreateGameRequestDTO = { ...waiting.config, player_name: '玩家',
    ai_opponents: waiting.players.slice(1).map((p) => ({ model_id: modelId, name: p.name })) }
  const createResponse: CreateGameResponseDTO = { game_id: gameId, message: `游戏已创建，共 ${aiCount + 1} 名玩家`,
    players: waiting.players.map(({ id, name, avatar, player_type, chips, model_id }) =>
      ({ id, name, avatar, player_type, chips, model_id })) }
  // Alternative REST start response, not an HTTP call made after the WS start above.
  const startResponse: StartGameResponseDTO = { message: '第 1 局开始', round_number: 1,
    dealer_index: 0, pot: currentRound(dealt).pot, current_player_index: 1, game_state: copy(dealt) }
  return { waiting, dealt, humanTurn: state, connect: [snapshot(waiting)], start,
    startCommand: { type: 'start_round' } satisfies ClientCommand,
    rest: { createRequest, createResponse, viewerResponse: copy(waiting), startResponse } }
}

export function createHandReplay() {
  const base = createStartReplay()
  // WS peek is free, retains the turn, and DOES NOT add an ActionRecord.
  const seen = changed(base.humanTurn, {}, { human: { status: 'active_seen' } })
  const peek = [acted(seen, 'human', 'check_cards', 0), snapshot(seen), humanTurn(seen)]
  const called = changed(seen, { pot: 70, current_player_index: 1,
    actions: recorded(seen, 'human', 'call', 20) }, { human: { chips: 970, total_bet_this_round: 30 } })
  const raised = changed(called, { pot: 90, current_bet: 20, current_player_index: 2,
    actions: recorded(called, 'ai-1', 'raise', 20) }, { 'ai-1': { chips: 960, total_bet_this_round: 40 } })
  const beforeCompare = changed(raised, { current_player_index: 0,
    actions: recorded(raised, 'ai-2', 'fold', 0) }, { 'ai-2': { status: 'folded' } })
  const actions: ServerEvent[] = [acted(called, 'human', 'call', 20), snapshot(called),
    event('ai_thinking', { player_id: 'ai-1', player_name: '对手1' }),
    acted(raised, 'ai-1', 'raise', 20), snapshot(raised),
    event('chat_message', { id: 'live-talk-1', player_id: 'ai-1', player_name: '对手1',
      message_type: 'action_talk', content: '我跟你玩。', timestamp: timestamp + 4.5 }),
    event('ai_thinking', { player_id: 'ai-2', player_name: '对手2' }),
    acted(beforeCompare, 'ai-2', 'fold', 0, null, true), snapshot(beforeCompare), humanTurn(beforeCompare)]
  const compare: CompareResultDTO = { winner_id: 'human', winner_name: '玩家', loser_id: 'ai-1', loser_name: '对手1',
    winner_hand: '♠A ♠K ♠Q (同花顺A-K-Q)', loser_hand: '♥10 ♣10 ♦4 (对10)',
    winner_cards: copy(humanCards), loser_cards: copy(aiCards) }
  const result: RoundResultDTO = { round_number: 1, winner_id: 'human', winner_name: '玩家', pot: 130,
    win_method: '其他玩家全部弃牌', hands_revealed: null,
    player_chip_changes: { human: 60, 'ai-1': -40, 'ai-2': -20 } }
  const settled = changed(beforeCompare, { pot: 130, phase: 'settlement',
    actions: recorded(beforeCompare, 'human', 'compare', 40, 'ai-1') },
  { human: { chips: 1060, total_bet_this_round: 70 }, 'ai-1': { status: 'compare_lost' } })
  settled.round_history = [copy(result)]
  const settlement = settlementEvents(acted(settled, 'human', 'compare', 40, compare), settled, result)
  const next = changed(settled, { round_number: 2, pot: 30, current_bet: 10, phase: 'betting',
    dealer_index: 1, current_player_index: 2, actions: [], turn_count: 0 }, {
    human: { chips: 1050, total_bet_this_round: 10, status: 'active_blind', hand: copy(losingCards) },
    'ai-1': { chips: 950, total_bet_this_round: 10, status: 'active_blind' },
    'ai-2': { chips: 970, total_bet_this_round: 10, status: 'active_blind' },
  })
  const nextHand = [...startEvents(next), event('ai_thinking', { player_id: 'ai-2', player_name: '对手2' })]
  const actionRequest: PlayerActionRequestDTO = { player_id: 'human', action: 'compare', target_id: 'ai-1' }
  const actionResponse: ActionResponseDTO = { success: true, action: 'compare', player_id: 'human', amount: 40,
    message: '玩家 与 对手1 比牌，玩家 获胜', compare_result: copy(compare), round_ended: true,
    round_result: copy(result), game_state: copy(settled) }
  // Alternative explicit end at this settled, still-playing boundary (not after natural finish).
  const endResponse: EndGameResponseDTO = { message: '游戏已结束', game_id: gameId,
    final_standings: [settled.players[0], settled.players[2], settled.players[1]]
      .map(({ id, name, chips }) => ({ id, name, chips })) }
  const offTurnBlind = copy(base.dealt)
  const offTurnSeen = changed(offTurnBlind, {}, { human: { status: 'active_seen' } })
  return { ...base, seen, called, beforeCompare, settled, result, peek, actions, settlement, nextHand,
    compareCommand: { type: 'player_action', data: { action: 'compare', target: 'ai-1' } } satisfies ClientCommand,
    rest: { ...base.rest, actionRequest, actionResponse, endResponse },
    offTurnPeek: { before: offTurnBlind, after: offTurnSeen,
      events: [acted(offTurnSeen, 'human', 'check_cards', 0), snapshot(offTurnSeen)] },
    // Fault injection for future reducers, NOT an additional normal backend emission.
    duplicateDelivery: [...copy(settlement), event('round_ended', result), snapshot(settled)],
    reconnect: { blind: [snapshot(base.humanTurn), humanTurn(base.humanTurn)],
      seen: [snapshot(seen), humanTurn(seen)], settled: [snapshot(settled)], aiTurn: [snapshot(called)] } }
}

/** AI-vs-AI comparison after human call and an engine-recorded AI peek. */
export function createCompareReplay(viewerId: 'human' | 'ai-1') {
  const called = createHandReplay().called
  const before = changed(called, { actions: recorded(called, 'ai-1', 'check_cards', 0) },
    { 'ai-1': { status: 'active_seen' } })
  const after = changed(before, { pot: 90, current_player_index: 0,
    actions: recorded(before, 'ai-1', 'compare', 20, 'ai-2') }, {
    'ai-1': { chips: 960, total_bet_this_round: 40 }, 'ai-2': { status: 'compare_lost' },
  })
  if (viewerId === 'ai-1') {
    for (const state of [before, after]) {
      player(state, 'human').hand = null
      player(state, 'ai-1').hand = copy(aiCards)
    }
  }
  const compare: CompareResultDTO = { winner_id: 'ai-1', winner_name: '对手1', loser_id: 'ai-2', loser_name: '对手2',
    winner_hand: viewerId === 'human' ? null : '♥10 ♣10 ♦4 (对10)',
    loser_hand: viewerId === 'human' ? null : '♣9 ♦7 ♥2 (散牌9-7-2)',
    winner_cards: viewerId === 'human' ? null : copy(aiCards), loser_cards: viewerId === 'human' ? null : copy(losingCards) }
  return { viewerId, before, after, events: [acted(after, 'ai-1', 'compare', 20, compare), snapshot(after), humanTurn(after)] }
}

export function createShowdownReplay() {
  const before = copy(createHandReplay().beforeCompare)
  // B01 prevents natural progression; seed the counter just like the existing engine test.
  currentRound(before).turn_count = 10
  const result: RoundResultDTO = { round_number: 1, winner_id: 'human', winner_name: '玩家', pot: 130,
    win_method: '最大轮数到达，强制比牌', hands_revealed: { human: copy(humanCards), 'ai-1': copy(aiCards) },
    player_chip_changes: { human: 60, 'ai-1': -40, 'ai-2': -20 } }
  const after = changed(before, { pot: 130, phase: 'settlement', actions: recorded(before, 'human', 'call', 40) },
    { human: { chips: 1060, total_bet_this_round: 70 } })
  after.round_history = [copy(result)]
  return { setup: 'manually seeded turn limit (backend B01)', before, after, result,
    events: settlementEvents(acted(after, 'human', 'call', 40), after, result) }
}

export function createFinishedReplay() {
  // Both players ante their last 100 chips; the AI folds, leaving one eligible player.
  const before = copy(createStartReplay(1).dealt)
  before.config = { initial_chips: 100, ante: 100, max_bet: 200, max_turns: 10 }
  Object.assign(currentRound(before), { pot: 200, current_bet: 100 })
  for (const p of before.players) {
    p.chips = 0
    p.total_bet_this_round = 100
  }
  const result: RoundResultDTO = { round_number: 1, winner_id: 'human', winner_name: '玩家', pot: 200,
    win_method: '其他玩家全部弃牌', hands_revealed: null, player_chip_changes: { human: 100, 'ai-1': -100 } }
  const after = changed(before, { phase: 'game_over', actions: recorded(before, 'ai-1', 'fold', 0) },
    { human: { chips: 200 }, 'ai-1': { status: 'out' } })
  after.status = 'finished'
  after.round_history = [copy(result)]
  const standings = after.players.map(({ id, name, chips }) => ({ id, name, chips }))
  const events = [...settlementEvents(acted(after, 'ai-1', 'fold', 0), after, result),
    event('game_ended', { final_standings: standings })]
  return { before, after, result, events }
}

export const protocolCases: { name: string, input: unknown, kind: 'event' | 'unknown' | 'invalid' }[] = [
  { name: 'dormant game_started', input: event('game_started', createStartReplay().waiting), kind: 'event' },
  { name: 'dormant review', input: event('ai_reviewing', { player_id: 'ai-1', player_name: '对手1', trigger: 'periodic' }), kind: 'event' },
  { name: 'operation error', input: event('error', { message: '当前轮到 对手1 行动' }), kind: 'event' },
  { name: 'Copilot error', input: event('copilot_error', { message: '授权失效', error_code: 'copilot_subscription_error' }), kind: 'event' },
  { name: 'nullable dealt cards', input: event('cards_dealt', { your_cards: null }), kind: 'event' },
  { name: 'unknown event', input: { type: 'future_event', data: { ignored: true } }, kind: 'unknown' },
  { name: 'broken JSON', input: '{"type":', kind: 'invalid' },
  { name: 'null envelope', input: 'null', kind: 'invalid' },
  { name: 'missing data', input: { type: 'game_state' }, kind: 'invalid' },
  { name: 'malformed known payload', input: { type: 'player_acted', data: { action: 'call' } }, kind: 'invalid' },
]
