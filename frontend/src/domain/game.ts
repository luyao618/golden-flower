/** Wire DTOs from backend/app/models/game.py and api/game.py.
 * Nullable response fields are required: missing and null are different inputs.
 * These types deliberately do not depend on the legacy types/game module.
 */
export type GameAction = 'fold' | 'call' | 'raise' | 'check_cards' | 'compare'
export type PlayerStatus = 'active_blind' | 'active_seen' | 'folded' | 'compare_lost' | 'out'
export type GamePhase = 'waiting' | 'dealing' | 'betting' | 'comparing' | 'settlement' | 'game_over'
export type CardRank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14

export interface CardDTO {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades'
  rank: CardRank
}

export interface PlayerIdentityDTO {
  id: string
  name: string
  avatar: string
  player_type: 'human' | 'ai'
  chips: number
  /** Opaque registry ID, never reconstructed from provider or model names. */
  model_id: string | null
}

export interface PlayerDTO extends PlayerIdentityDTO {
  status: PlayerStatus
  /** Viewer snapshots include even the blind viewer's own cards; visibility is separate. */
  hand: CardDTO[] | null
  total_bet_this_round: number
}

export interface GameConfigDTO {
  initial_chips: number
  ante: number
  max_bet: number
  max_turns: number
}

export interface ActionRecordDTO {
  player_id: string
  player_name: string
  action: GameAction
  amount: number | null
  target_id: string | null
  timestamp: number
}

export interface RoundStateDTO {
  round_number: number
  pot: number
  current_bet: number
  dealer_index: number
  current_player_index: number
  actions: ActionRecordDTO[]
  phase: GamePhase
  turn_count: number
  max_turns: number
}

export interface RoundResultDTO {
  round_number: number
  winner_id: string
  winner_name: string
  pot: number
  /** Server prose, not a client enum (including when the last elimination was a compare). */
  win_method: string
  hands_revealed: Record<string, CardDTO[]> | null
  /** Net since the hand began. Settled snapshots ALREADY include these changes. */
  player_chip_changes: Record<string, number>
}

export interface GameStateDTO {
  game_id: string
  players: PlayerDTO[]
  current_round: RoundStateDTO | null
  round_history: RoundResultDTO[]
  config: GameConfigDTO
  status: 'waiting' | 'playing' | 'finished'
}

export interface CompareResultDTO {
  winner_id: string
  winner_name: string
  loser_id: string
  loser_name: string
  // All four are null for uninvolved WebSocket viewers.
  winner_hand: string | null
  loser_hand: string | null
  winner_cards: CardDTO[] | null
  loser_cards: CardDTO[] | null
}

export interface StandingDTO {
  id: string
  name: string
  chips: number
}

export interface CreateGameRequestDTO extends GameConfigDTO {
  player_name: string
  ai_opponents: { model_id: string, name?: string | null }[]
}

export interface CreateGameResponseDTO {
  game_id: string
  message: string
  players: PlayerIdentityDTO[]
}

export interface StartGameResponseDTO {
  message: string
  round_number: number
  dealer_index: number
  pot: number
  current_player_index: number
  game_state: GameStateDTO
}

export interface PlayerActionRequestDTO {
  player_id: string
  action: GameAction
  target_id?: string | null
}

export interface ActionResponseDTO {
  success: boolean
  action: GameAction
  player_id: string
  amount: number
  message: string
  compare_result: CompareResultDTO | null
  round_ended: boolean
  round_result: RoundResultDTO | null
  game_state: GameStateDTO | null
}

export interface EndGameResponseDTO {
  message: string
  game_id: string
  final_standings: StandingDTO[]
}
