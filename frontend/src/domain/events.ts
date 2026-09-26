import type { CardDTO, CompareResultDTO, GameAction, GameStateDTO, RoundResultDTO, StandingDTO } from './game'

export type ChatMessageType = 'action_talk' | 'bystander_react' | 'player_message' | 'system_message'

/** Unlike archived chat, live messages carry neither game_id nor round_number. */
export interface LiveChatDTO {
  id: string
  player_id: string
  player_name: string
  message_type: ChatMessageType
  content: string
  timestamp: number
}

export interface ServerEventData {
  game_state: GameStateDTO
  game_started: GameStateDTO
  round_started: {
    round_number: number
    dealer: string
    dealer_index: number
    pot: number
    current_bet: number
    max_turns: number
  }
  cards_dealt: { your_cards: CardDTO[] | null }
  turn_changed: {
    current_player: string
    current_player_id: string
    available_actions: string[]
  }
  player_acted: {
    player_id: string
    player_name: string
    action: GameAction
    amount: number
    compare_result: CompareResultDTO | null
    is_fallback: boolean
  }
  chat_message: LiveChatDTO
  round_ended: RoundResultDTO
  game_ended: { final_standings: StandingDTO[] }
  ai_thinking: { player_id: string, player_name: string }
  ai_reviewing: { player_id: string, player_name: string, trigger: string }
  error: { message: string }
  copilot_error: { message: string, error_code: string }
}

export type ServerEvent = {
  [K in keyof ServerEventData]: { type: K, data: ServerEventData[K] }
}[keyof ServerEventData]

/** No request IDs, arbitrary wager amounts, heartbeat or sync commands exist. */
export type ClientCommand =
  | { type: 'start_round' }
  | { type: 'player_action', data: { action: GameAction, target?: string } }
  | { type: 'chat_message', data: { content: string } }
