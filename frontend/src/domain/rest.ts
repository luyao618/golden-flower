import type { LiveChatDTO } from './events'

/** Read contracts from api/thought.py, chat.py, settings.py and config.py. */
export interface ThoughtRecordDTO {
  id: number
  game_id: string
  agent_id: string
  round_number: number
  turn_number: number
  decision: string
  hand_evaluation: string | null
  opponent_analysis: string | null
  risk_assessment: string | null
  chat_analysis: string | null
  reasoning: string | null
  confidence: number | null
  emotion: string | null
  decision_target: string | null
  table_talk: string | null
  raw_response: string | null
  created_at: string | null
}

export interface ThoughtListDTO {
  game_id: string
  agent_id: string
  round_number: number | null
  thoughts: ThoughtRecordDTO[]
  count: number
}

export interface NarrativeDTO {
  id: number
  game_id: string
  agent_id: string
  round_number: number
  narrative: string
  outcome: string | null
  created_at: string | null
}

export interface ExperienceReviewDTO {
  id: number
  game_id: string
  agent_id: string
  trigger: string
  triggered_at_round: number
  rounds_reviewed: number[] | null
  self_analysis: string | null
  opponent_patterns: Record<string, string> | null
  strategy_adjustment: string | null
  confidence_shift: number | null
  strategy_context: string | null
  created_at: string | null
}

export interface ReviewListDTO {
  game_id: string
  agent_id: string
  reviews: ExperienceReviewDTO[]
  count: number
}

export interface SummaryStatsDTO {
  rounds_played: number
  rounds_won: number
  total_chips_won: number
  total_chips_lost: number
  biggest_win: number
  biggest_loss: number
  fold_rate: number
}

export interface SummaryDTO {
  id: number
  game_id: string
  agent_id: string
  stats: SummaryStatsDTO | null
  key_moments: string[] | null
  opponent_impressions: Record<string, string> | null
  self_reflection: string | null
  chat_strategy_summary: string | null
  learning_journey: string | null
  narrative_summary: string | null
  created_at: string | null
}

export interface ChatMessageDTO extends LiveChatDTO {
  game_id: string
  round_number: number
  related_action: string | null
  trigger_event: string | null
  /** Transport data only; never public table talk. */
  inner_thought: string | null
  created_at: string | null
}

export interface ChatListDTO {
  game_id: string
  round_number: number | null
  messages: ChatMessageDTO[]
  count: number
}

export interface SettingsDTO {
  llm_max_tokens: number | null
  ai_thinking_mode: 'detailed' | 'fast' | 'turbo'
  llm_timeout: number
  llm_max_retries: number
  llm_temperature: number
}

export interface ModelDTO {
  id: string
  model: string
  display_name: string
  provider: string
  openrouter_id?: string
  siliconflow_id?: string
  azure_id?: string
  zhipu_id?: string
}

export interface ModelCatalogDTO {
  models: {
    id: string
    name: string
    context_length: number | null
    pricing: { prompt: string, completion: string }
  }[]
  total: number
}
