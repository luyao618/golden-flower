// ============================================================
// REST API 调用封装
// 封装所有后端 HTTP 接口调用
// ============================================================

import type {
  AIModelInfo,
  ActionResponse,
  AzureOpenAIAddedModel,
  AzureOpenAIModel,
  ChatMessage,
  CopilotDeviceFlowResponse,
  CopilotPollResponse,
  CopilotStatusResponse,
  CreateGameRequest,
  CreateGameResponse,
  ExperienceReview,
  GameSummary,
  GameState,
  OpenRouterAddedModel,
  OpenRouterModel,
  PlayerActionRequest,
  ProviderExtraConfig,
  ProviderStatus,
  RoundNarrative,
  SetProviderConfigResponse,
  SiliconFlowAddedModel,
  SiliconFlowModel,
  ThoughtRecord,
  VerifyKeyResponse,
} from '../types/game'
import { useProviderKeysStore } from '../stores/settingsStore'

const BASE_URL = '/api'

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// ---- 通用请求方法 ----

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  // 从 localStorage 获取 provider keys 并注入 header
  const providerKeys = useProviderKeysStore.getState().getAllKeys()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }
  if (Object.keys(providerKeys).length > 0) {
    headers['X-Provider-Keys'] = JSON.stringify(providerKeys)
  }

  const response = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new ApiError(error.detail || `HTTP ${response.status}`, response.status)
  }

  return response.json()
}

// ---- 游戏管理 ----

/** 创建新游戏 */
export async function createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
  return request<CreateGameResponse>('/game/create', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** 获取游戏状态 */
export async function getGameState(gameId: string, playerId?: string, signal?: AbortSignal): Promise<GameState> {
  const params = playerId ? `?player_id=${encodeURIComponent(playerId)}` : ''
  return request<GameState>(`/game/${encodeURIComponent(gameId)}${params}`, { signal })
}

/** 开始游戏（开始第一局） */
export async function startGame(gameId: string) {
  return request<{
    message: string
    round_number: number
    dealer_index: number
    pot: number
    current_player_index: number
    game_state: Record<string, unknown>
  }>(`/game/${gameId}/start`, { method: 'POST' })
}

/** 结束游戏 */
export async function endGame(gameId: string) {
  return request<{
    message: string
    game_id: string
    final_standings: Array<{ id: string; name: string; chips: number }>
  }>(`/game/${gameId}/end`, { method: 'POST' })
}

/** 玩家执行操作 */
export async function playerAction(
  gameId: string,
  req: PlayerActionRequest
): Promise<ActionResponse> {
  return request<ActionResponse>(`/game/${gameId}/action`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** 获取可用 AI 模型列表 */
export async function getAvailableModels(): Promise<AIModelInfo[]> {
  return request<AIModelInfo[]>('/models')
}

// ---- 心路历程 ----

/** 获取某 AI 的所有思考记录 */
export async function getThoughts(
  gameId: string,
  agentId: string
): Promise<ThoughtRecord[]> {
  const res = await request<{ thoughts: ThoughtRecord[] }>(
    `/game/${gameId}/thoughts/${agentId}`
  )
  return res.thoughts
}

/** 获取某 AI 某局的思考记录 */
export async function getRoundThoughts(
  gameId: string,
  agentId: string,
  roundNum: number
): Promise<ThoughtRecord[]> {
  const res = await request<{ thoughts: ThoughtRecord[] }>(
    `/game/${gameId}/thoughts/${agentId}/round/${roundNum}`
  )
  return res.thoughts
}

/** 获取某 AI 某局的叙事 */
export async function getRoundNarrative(
  gameId: string,
  agentId: string,
  roundNum: number
): Promise<RoundNarrative> {
  return request<RoundNarrative>(
    `/game/${gameId}/narrative/${agentId}/round/${roundNum}`
  )
}

/** 获取某 AI 的游戏总结 */
export async function getGameSummary(
  gameId: string,
  agentId: string
): Promise<GameSummary> {
  // Backend returns GameSummaryResponse with stats nested in a dict;
  // transform to the flat GameSummary shape the frontend expects.
  const res = await request<{
    agent_id: string
    stats: Record<string, unknown> | null
    key_moments: string[] | null
    opponent_impressions: Record<string, string> | null
    self_reflection: string | null
    chat_strategy_summary: string | null
    learning_journey: string | null
    narrative_summary: string | null
  }>(`/game/${gameId}/summary/${agentId}`)

  const stats = res.stats ?? {}
  return {
    agent_id: res.agent_id,
    rounds_played: (stats.rounds_played as number) ?? 0,
    rounds_won: (stats.rounds_won as number) ?? 0,
    total_chips_won: (stats.total_chips_won as number) ?? 0,
    total_chips_lost: (stats.total_chips_lost as number) ?? 0,
    biggest_win: (stats.biggest_win as number) ?? 0,
    biggest_loss: (stats.biggest_loss as number) ?? 0,
    fold_rate: (stats.fold_rate as number) ?? 0,
    key_moments: res.key_moments ?? [],
    opponent_impressions: res.opponent_impressions ?? {},
    self_reflection: res.self_reflection ?? '',
    chat_strategy_summary: res.chat_strategy_summary ?? '',
    learning_journey: res.learning_journey ?? '',
    narrative_summary: res.narrative_summary ?? '',
  }
}

/** 获取某 AI 的所有经验回顾记录 */
export async function getExperienceReviews(
  gameId: string,
  agentId: string
): Promise<ExperienceReview[]> {
  const res = await request<{ reviews: ExperienceReview[] }>(
    `/game/${gameId}/reviews/${agentId}`
  )
  return res.reviews
}

/** 取消某场游戏正在进行的总结生成任务 */
export async function cancelGameSummaries(gameId: string): Promise<void> {
  await request(`/game/${gameId}/cancel-summaries`, { method: 'POST' })
}

// ---- 聊天 ----

/** 获取聊天历史 */
export async function getChatHistory(gameId: string): Promise<ChatMessage[]> {
  const res = await request<{ messages: ChatMessage[] }>(`/game/${gameId}/chat`)
  return res.messages
}

/** 获取某局聊天历史 */
export async function getRoundChatHistory(
  gameId: string,
  roundNum: number
): Promise<ChatMessage[]> {
  const res = await request<{ messages: ChatMessage[] }>(
    `/game/${gameId}/chat/round/${roundNum}`
  )
  return res.messages
}

// ---- Provider 管理 (T8.0) ----

/** 获取所有 Provider 状态 */
export async function getProviders(): Promise<ProviderStatus[]> {
  return request<ProviderStatus[]>('/providers')
}

/** 验证 Provider API Key（key 从 header 中读取，或传入新 key 验证） */
export async function verifyProviderKey(
  provider: string,
  key?: string
): Promise<VerifyKeyResponse> {
  return request<VerifyKeyResponse>(`/providers/${provider}/verify`, {
    method: 'POST',
    body: JSON.stringify({ key: key ?? null }),
  })
}

// ---- GitHub Copilot (T8.0) ----

/** 发起 Copilot Device Flow 连接 */
export async function connectCopilot(): Promise<CopilotDeviceFlowResponse> {
  return request<CopilotDeviceFlowResponse>('/copilot/connect', {
    method: 'POST',
  })
}

/** 轮询 Copilot 授权状态 */
export async function pollCopilotAuth(): Promise<CopilotPollResponse> {
  return request<CopilotPollResponse>('/copilot/poll')
}

/** 获取 Copilot 连接状态 */
export async function getCopilotStatus(): Promise<CopilotStatusResponse> {
  return request<CopilotStatusResponse>('/copilot/status')
}

/** 断开 Copilot 连接 */
export async function disconnectCopilot(): Promise<{ message: string }> {
  return request('/copilot/disconnect', { method: 'POST' })
}

// ---- OpenRouter 模型管理 ----

/** 从 OpenRouter API 获取可用模型列表 */
export async function fetchOpenRouterModels(): Promise<{
  models: OpenRouterModel[]
  total: number
}> {
  return request('/openrouter/models')
}

/** 获取已添加到游戏的 OpenRouter 模型列表 */
export async function getAddedOpenRouterModels(): Promise<{
  models: OpenRouterAddedModel[]
}> {
  return request('/openrouter/models/added')
}

/** 添加一个 OpenRouter 模型到游戏 */
export async function addOpenRouterModel(
  modelId: string,
  displayName: string
): Promise<{
  message: string
  model_id: string
  openrouter_id: string
  display_name: string
}> {
  return request('/openrouter/models', {
    method: 'POST',
    body: JSON.stringify({ model_id: modelId, display_name: displayName }),
  })
}

/** 从游戏中移除一个 OpenRouter 模型 */
export async function removeOpenRouterModel(
  modelId: string
): Promise<{ message: string; model_id: string }> {
  return request(`/openrouter/models/${modelId}`, { method: 'DELETE' })
}

// ---- Provider 额外配置 (api_host, api_version) ----

/** 设置 Provider 的额外配置 */
export async function setProviderConfig(
  provider: string,
  config: Partial<ProviderExtraConfig>
): Promise<SetProviderConfigResponse> {
  return request<SetProviderConfigResponse>(`/providers/${provider}/config`, {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

// ---- SiliconFlow 模型管理 ----

/** 从 SiliconFlow API 获取可用模型列表 */
export async function fetchSiliconFlowModels(): Promise<{
  models: SiliconFlowModel[]
  total: number
}> {
  return request('/siliconflow/models')
}

/** 获取已添加到游戏的 SiliconFlow 模型列表 */
export async function getAddedSiliconFlowModels(): Promise<{
  models: SiliconFlowAddedModel[]
}> {
  return request('/siliconflow/models/added')
}

/** 添加一个 SiliconFlow 模型到游戏 */
export async function addSiliconFlowModel(
  modelId: string,
  displayName: string
): Promise<{
  message: string
  model_id: string
  siliconflow_id: string
  display_name: string
}> {
  return request('/siliconflow/models', {
    method: 'POST',
    body: JSON.stringify({ model_id: modelId, display_name: displayName }),
  })
}

/** 从游戏中移除一个 SiliconFlow 模型 */
export async function removeSiliconFlowModel(
  modelId: string
): Promise<{ message: string; model_id: string }> {
  return request(`/siliconflow/models/${modelId}`, { method: 'DELETE' })
}

// ---- Azure OpenAI 模型管理 ----

/** 从 Azure OpenAI 获取已部署的模型列表 */
export async function fetchAzureOpenAIModels(): Promise<{
  models: AzureOpenAIModel[]
  total: number
}> {
  return request('/azure-openai/models')
}

/** 获取已添加到游戏的 Azure OpenAI 模型列表 */
export async function getAddedAzureOpenAIModels(): Promise<{
  models: AzureOpenAIAddedModel[]
}> {
  return request('/azure-openai/models/added')
}

/** 添加一个 Azure OpenAI 模型到游戏 */
export async function addAzureOpenAIModel(
  modelId: string,
  displayName: string
): Promise<{
  message: string
  model_id: string
  azure_id: string
  display_name: string
}> {
  return request('/azure-openai/models', {
    method: 'POST',
    body: JSON.stringify({ model_id: modelId, display_name: displayName }),
  })
}

/** 从游戏中移除一个 Azure OpenAI 模型 */
export async function removeAzureOpenAIModel(
  modelId: string
): Promise<{ message: string; model_id: string }> {
  return request(`/azure-openai/models/${modelId}`, { method: 'DELETE' })
}

// ---- 游戏设置 ----

/** AI 思考模式 */
export type AiThinkingMode = 'detailed' | 'fast' | 'turbo'

/** 设置响应类型 */
export interface SettingsData {
  llm_max_tokens: number | null
  ai_thinking_mode: AiThinkingMode
  // AI 调用配置
  llm_timeout: number
  llm_max_retries: number
  llm_temperature: number
}

/** 获取当前设置 */
export async function getSettings(): Promise<SettingsData> {
  return request('/settings')
}

/** 更新设置（部分更新，只需传需要修改的字段） */
export async function updateSettings(
  settings: Partial<SettingsData>
): Promise<SettingsData> {
  return request('/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  })
}
