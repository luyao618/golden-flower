import type { LiveChatDTO } from '../../domain/events'
import type {
  ChatListDTO, ModelCatalogDTO, ModelDTO, NarrativeDTO, ReviewListDTO,
  SummaryDTO, ThoughtListDTO,
} from '../../domain/rest'

/** Response-shaped data only: no HTTP adapters, network calls, secrets, or report generation. */
export function createReadFixtures() {
  const identity = { game_id: 'fixture-game', agent_id: 'ai-1' }
  const thoughts: ThoughtListDTO = { ...identity, round_number: 1, count: 1, thoughts: [{
    ...identity, id: 1, round_number: 1, turn_number: 1, decision: 'call',
    decision_target: null, hand_evaluation: null, opponent_analysis: null, risk_assessment: null,
    chat_analysis: null, reasoning: null, confidence: null, emotion: null, table_talk: null,
    raw_response: '<b>untrusted raw model output</b>', created_at: null,
  }] }
  const emptyThoughts: ThoughtListDTO = { ...identity, round_number: null, count: 0, thoughts: [] }
  const narrative: NarrativeDTO = { ...identity, id: 1, round_number: 1,
    narrative: '这一局我选择了跟注。', outcome: null, created_at: null }
  const reviews: ReviewListDTO = { ...identity, count: 1, reviews: [{
    ...identity, id: 1, trigger: 'periodic', triggered_at_round: 5, rounds_reviewed: null,
    self_analysis: null, opponent_patterns: null, strategy_adjustment: null,
    confidence_shift: null, strategy_context: null, created_at: null,
  }] }
  const emptySummary: SummaryDTO = { ...identity, id: 1, stats: null, key_moments: null,
    opponent_impressions: null, self_reflection: null, chat_strategy_summary: null,
    learning_journey: null, narrative_summary: null, created_at: null }
  const summary: SummaryDTO = { ...emptySummary, stats: { rounds_played: 1, rounds_won: 0,
    total_chips_won: 0, total_chips_lost: 40, biggest_win: 0, biggest_loss: 40, fold_rate: 0 },
  key_moments: ['比牌落败'], opponent_impressions: { human: '谨慎' } }
  const liveChat: LiveChatDTO[] = [1, 2].map((index) => ({
    id: `live-message-${index}`, player_id: 'human', player_name: '玩家',
    message_type: 'player_message', content: '再来一局', timestamp: 1_790_424_000 + index,
  }))
  const chat: ChatListDTO = { game_id: identity.game_id, round_number: null, count: 2,
    messages: liveChat.map((message, index) => ({ ...message, id: String(index + 41),
      timestamp: message.timestamp + 0.25, game_id: identity.game_id, round_number: 1,
      related_action: null, trigger_event: null, inner_thought: index === 0 ? '仅存档，不公开展示' : null,
      created_at: null,
    })) }
  const models: ModelDTO[] = [
    { id: 'registry/opaque:模型?revision=2%2F+#', model: 'openrouter/vendor/model',
      provider: 'openrouter', display_name: '自定义模型', openrouter_id: 'vendor/model' },
    { id: 'siliconflow-org-model', model: 'openai/org/model', provider: 'siliconflow',
      display_name: 'SiliconFlow', siliconflow_id: 'org/model' },
    { id: 'azure-deployment.v2', model: 'azure/deployment.v2', provider: 'azure_openai',
      display_name: 'Azure', azure_id: 'deployment.v2' },
    { id: 'zhipu-glm-4', model: 'openai/glm-4', provider: 'zhipu', display_name: '智谱', zhipu_id: 'glm-4' },
    { id: 'copilot-gpt4o', model: 'gpt-4o', provider: 'github_copilot', display_name: 'Copilot GPT-4o' },
  ]
  const catalog: ModelCatalogDTO = { models: [{ id: 'vendor/model', name: '目录模型',
    context_length: null, pricing: { prompt: '0', completion: '0' } }], total: 1 }
  return { thoughts, emptyThoughts, narrative, reviews, summary, emptySummary, chat, liveChat, models, catalog }
}
