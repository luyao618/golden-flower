/**
 * api.ts 服务层单元测试
 *
 * 使用 vi.stubGlobal('fetch') 模拟 HTTP 请求。
 * 覆盖：
 * - 通用 request 行为（Content-Type / X-Provider-Keys / 错误处理）
 * - 游戏管理 API（createGame / getGameState / playerAction / getAvailableModels）
 * - 心路历程 API（getThoughts / getRoundNarrative / getGameSummary）
 * - 聊天 API（getChatHistory / getRoundChatHistory）
 * - Provider 管理（本地 key store / verifyProviderKey）
 * - Copilot API（connectCopilot / pollCopilotAuth / getCopilotStatus / disconnectCopilot）
 * - 模型管理（OpenRouter / SiliconFlow / Azure OpenAI — add / remove / fetch / getAdded）
 * - 设置 API（getSettings / updateSettings）
 * - Provider 配置（setProviderConfig）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderKeysStore } from '../../stores/settingsStore'

import {
  addAzureOpenAIModel,
  addOpenRouterModel,
  addSiliconFlowModel,
  connectCopilot,
  createGame,
  disconnectCopilot,
  endGame,
  fetchAzureOpenAIModels,
  fetchOpenRouterModels,
  fetchSiliconFlowModels,
  getAddedAzureOpenAIModels,
  getAddedOpenRouterModels,
  getAddedSiliconFlowModels,
  getAvailableModels,
  getChatHistory,
  getCopilotStatus,
  getExperienceReviews,
  getGameState,
  getGameSummary,
  getProviders,
  getRoundChatHistory,
  getRoundNarrative,
  getRoundThoughts,
  getSettings,
  getThoughts,
  playerAction,
  pollCopilotAuth,
  removeAzureOpenAIModel,
  removeOpenRouterModel,
  removeSiliconFlowModel,
  setProviderConfig,
  startGame,
  updateSettings,
  verifyProviderKey,
} from '../api'

// ---- Fetch mock setup ----

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  useProviderKeysStore.setState({ keys: {} })
  useProviderKeysStore.persist.clearStorage()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Helper: create a successful Response */
function okResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  }
}

/** Helper: create an error Response */
function errorResponse(status: number, detail?: string) {
  return {
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    json: () =>
      detail
        ? Promise.resolve({ detail })
        : Promise.reject(new Error('no json')),
  }
}

// ================================================================
// Common request behavior
// ================================================================

describe('request helper (via createGame)', () => {
  it('sends Content-Type application/json without provider keys when none are stored', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ game_id: 'g1', message: 'ok', players: [] }),
    )
    await createGame({
      player_name: 'Me',
      ai_opponents: [],
      initial_chips: 1000,
      ante: 10,
      max_bet: 200,
      max_turns: 10,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(opts.headers).not.toHaveProperty('X-Provider-Keys')
  })

  it('throws on non-ok response with detail', async () => {
    fetchMock.mockResolvedValue(errorResponse(400, 'bad request'))
    await expect(
      createGame({
        player_name: '',
        ai_opponents: [],
        initial_chips: 1000,
        ante: 10,
        max_bet: 200,
        max_turns: 10,
      }),
    ).rejects.toThrow('bad request')
  })

  it('throws statusText when no json body', async () => {
    fetchMock.mockResolvedValue(errorResponse(500))
    await expect(
      createGame({
        player_name: '',
        ai_opponents: [],
        initial_chips: 1000,
        ante: 10,
        max_bet: 200,
        max_turns: 10,
      }),
    ).rejects.toThrow('HTTP 500')
  })
})

// ================================================================
// Game management
// ================================================================

describe('game management', () => {
  it('createGame POSTs to /api/game/create', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ game_id: 'g1', message: 'ok', players: [] }),
    )
    const res = await createGame({
      player_name: 'Alice',
      ai_opponents: [{ model_id: 'm1' }],
      initial_chips: 1000,
      ante: 10,
      max_bet: 200,
      max_turns: 10,
    })
    expect(res.game_id).toBe('g1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/create')
  })

  it('getGameState GETs with optional player_id', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ game_id: 'g1', status: 'playing', players: [], current_round: null, round_history: [], config: {} }),
    )
    await getGameState('g1', 'p1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1?player_id=p1')
  })

  it('getGameState without player_id', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ game_id: 'g1', status: 'playing', players: [], current_round: null, round_history: [], config: {} }),
    )
    await getGameState('g1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1')
  })

  it('startGame POSTs', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ message: 'ok', round_number: 1, dealer_index: 0, pot: 30, current_player_index: 1, game_state: {} }),
    )
    const res = await startGame('g1')
    expect(res.round_number).toBe(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1/start')
  })

  it('endGame POSTs', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ message: 'ok', game_id: 'g1', final_standings: [] }),
    )
    const res = await endGame('g1')
    expect(res.game_id).toBe('g1')
  })

  it('playerAction POSTs action', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        success: true,
        action: 'call',
        player_id: 'p1',
        amount: 10,
        message: 'ok',
        compare_result: null,
        round_ended: false,
        round_result: null,
        game_state: null,
      }),
    )
    const res = await playerAction('g1', { player_id: 'p1', action: 'call' })
    expect(res.success).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1/action')
  })

  it('getAvailableModels GETs /api/models', async () => {
    fetchMock.mockResolvedValue(
      okResponse([{ id: 'm1', model: 'gpt-4', display_name: 'GPT-4', provider: 'copilot' }]),
    )
    const models = await getAvailableModels()
    expect(models).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/models')
  })
})

// ================================================================
// Thoughts / narrative / summary
// ================================================================

describe('thought APIs', () => {
  it('getThoughts unwraps .thoughts', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ thoughts: [{ agent_id: 'a1', round_number: 1 }] }),
    )
    const res = await getThoughts('g1', 'a1')
    expect(res).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1/thoughts/a1')
  })

  it('getRoundThoughts', async () => {
    fetchMock.mockResolvedValue(okResponse({ thoughts: [] }))
    await getRoundThoughts('g1', 'a1', 2)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1/thoughts/a1/round/2')
  })

  it('getRoundNarrative', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ agent_id: 'a1', round_number: 1, narrative: 'text', outcome: 'win' }),
    )
    const res = await getRoundNarrative('g1', 'a1', 1)
    expect(res.narrative).toBe('text')
  })

  it('getGameSummary fills defaults for null fields', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        agent_id: 'a1',
        stats: null,
        key_moments: null,
        opponent_impressions: null,
        self_reflection: null,
        chat_strategy_summary: null,
        learning_journey: null,
        narrative_summary: null,
      }),
    )
    const res = await getGameSummary('g1', 'a1')
    expect(res.rounds_played).toBe(0)
    expect(res.key_moments).toEqual([])
    expect(res.opponent_impressions).toEqual({})
    expect(res.self_reflection).toBe('')
  })

  it('getExperienceReviews unwraps .reviews', async () => {
    fetchMock.mockResolvedValue(okResponse({ reviews: [] }))
    const res = await getExperienceReviews('g1', 'a1')
    expect(res).toEqual([])
  })
})

// ================================================================
// Chat
// ================================================================

describe('chat APIs', () => {
  it('getChatHistory', async () => {
    fetchMock.mockResolvedValue(okResponse({ messages: [{ id: 'c1' }] }))
    const res = await getChatHistory('g1')
    expect(res).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1/chat')
  })

  it('getRoundChatHistory', async () => {
    fetchMock.mockResolvedValue(okResponse({ messages: [] }))
    await getRoundChatHistory('g1', 3)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/game/g1/chat/round/3')
  })
})

// ================================================================
// Provider management
// ================================================================

describe('provider APIs', () => {
  it('getProviders', async () => {
    fetchMock.mockResolvedValue(okResponse([]))
    await getProviders()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/providers')
  })

  it('sends locally stored keys in X-Provider-Keys', async () => {
    useProviderKeysStore.getState().setKey('openrouter', 'sk-test-openrouter')
    useProviderKeysStore.getState().setKey('siliconflow', 'sk-test-siliconflow')
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(okResponse([]))
    await getProviders()

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/providers', {
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Keys': JSON.stringify({
          openrouter: 'sk-test-openrouter',
          siliconflow: 'sk-test-siliconflow',
        }),
      },
    })
  })

  it('verifyProviderKey POSTs an explicit key', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ valid: true, message: 'ok' }),
    )
    const res = await verifyProviderKey('siliconflow', 'key')
    expect(res.valid).toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/providers/siliconflow/verify', {
      method: 'POST',
      body: JSON.stringify({ key: 'key' }),
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('verifyProviderKey sends a stored key through the header when no key is supplied', async () => {
    useProviderKeysStore.getState().setKey('siliconflow', 'sk-test-siliconflow')
    fetchMock.mockResolvedValue(okResponse({ valid: true, message: 'ok' }))

    const res = await verifyProviderKey('siliconflow')

    expect(res.valid).toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/providers/siliconflow/verify', {
      method: 'POST',
      body: JSON.stringify({ key: null }),
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Keys': JSON.stringify({ siliconflow: 'sk-test-siliconflow' }),
      },
    })
  })

  it('removes local keys from subsequent request headers', async () => {
    useProviderKeysStore.getState().setKey('openrouter', 'sk-test-openrouter')
    useProviderKeysStore.getState().setKey('siliconflow', 'sk-test-siliconflow')
    useProviderKeysStore.getState().removeKey('openrouter')
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(okResponse([]))
    await getProviders()
    expect(fetchMock.mock.calls[0][1].headers['X-Provider-Keys']).toBe(
      JSON.stringify({ siliconflow: 'sk-test-siliconflow' }),
    )

    useProviderKeysStore.getState().removeKey('siliconflow')
    await getProviders()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty('X-Provider-Keys')
  })

  it('omits X-Provider-Keys when stored keys are empty', async () => {
    useProviderKeysStore.getState().setKey('openrouter', '')
    fetchMock.mockResolvedValue(okResponse([]))

    await getProviders()

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Provider-Keys')
  })
})

// ================================================================
// Copilot
// ================================================================

describe('copilot APIs', () => {
  it('connectCopilot POSTs', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ user_code: 'ABC', verification_uri: 'https://...', expires_in: 900 }),
    )
    const res = await connectCopilot()
    expect(res.user_code).toBe('ABC')
  })

  it('pollCopilotAuth', async () => {
    fetchMock.mockResolvedValue(okResponse({ status: 'pending' }))
    const res = await pollCopilotAuth()
    expect(res.status).toBe('pending')
  })

  it('getCopilotStatus', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ connected: false, has_valid_token: false, models: [] }),
    )
    const res = await getCopilotStatus()
    expect(res.connected).toBe(false)
  })

  it('disconnectCopilot POSTs', async () => {
    fetchMock.mockResolvedValue(okResponse({ message: 'ok' }))
    await disconnectCopilot()
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })
})

// ================================================================
// Model management (OpenRouter / SiliconFlow / Azure OpenAI)
// ================================================================

describe('OpenRouter model management', () => {
  it('fetchOpenRouterModels', async () => {
    fetchMock.mockResolvedValue(okResponse({ models: [], total: 0 }))
    const res = await fetchOpenRouterModels()
    expect(res.total).toBe(0)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/openrouter/models')
  })

  it('getAddedOpenRouterModels', async () => {
    fetchMock.mockResolvedValue(okResponse({ models: [] }))
    await getAddedOpenRouterModels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/openrouter/models/added')
  })

  it('addOpenRouterModel', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ message: 'ok', model_id: 'or-1', openrouter_id: 'x', display_name: 'X' }),
    )
    const res = await addOpenRouterModel('x', 'X')
    expect(res.model_id).toBe('or-1')
  })

  it('removeOpenRouterModel', async () => {
    fetchMock.mockResolvedValue(okResponse({ message: 'ok', model_id: 'or-1' }))
    await removeOpenRouterModel('or-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })
})

describe('SiliconFlow model management', () => {
  it('fetchSiliconFlowModels', async () => {
    fetchMock.mockResolvedValue(okResponse({ models: [], total: 0 }))
    await fetchSiliconFlowModels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/siliconflow/models')
  })

  it('getAddedSiliconFlowModels', async () => {
    fetchMock.mockResolvedValue(okResponse({ models: [] }))
    await getAddedSiliconFlowModels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/siliconflow/models/added')
  })

  it('addSiliconFlowModel', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ message: 'ok', model_id: 'sf-1', siliconflow_id: 'y', display_name: 'Y' }),
    )
    const res = await addSiliconFlowModel('y', 'Y')
    expect(res.model_id).toBe('sf-1')
  })

  it('removeSiliconFlowModel', async () => {
    fetchMock.mockResolvedValue(okResponse({ message: 'ok', model_id: 'sf-1' }))
    await removeSiliconFlowModel('sf-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })
})

describe('Azure OpenAI model management', () => {
  it('fetchAzureOpenAIModels', async () => {
    fetchMock.mockResolvedValue(okResponse({ models: [], total: 0 }))
    await fetchAzureOpenAIModels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/azure-openai/models')
  })

  it('getAddedAzureOpenAIModels', async () => {
    fetchMock.mockResolvedValue(okResponse({ models: [] }))
    await getAddedAzureOpenAIModels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/azure-openai/models/added')
  })

  it('addAzureOpenAIModel', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ message: 'ok', model_id: 'az-1', azure_id: 'z', display_name: 'Z' }),
    )
    const res = await addAzureOpenAIModel('z', 'Z')
    expect(res.model_id).toBe('az-1')
  })

  it('removeAzureOpenAIModel', async () => {
    fetchMock.mockResolvedValue(okResponse({ message: 'ok', model_id: 'az-1' }))
    await removeAzureOpenAIModel('az-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })
})

// ================================================================
// Settings
// ================================================================

describe('settings APIs', () => {
  it('getSettings GETs /api/settings', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        llm_max_tokens: null,
        ai_thinking_mode: 'fast',
        llm_timeout: 30,
        llm_max_retries: 3,
        llm_temperature: 0.7,
      }),
    )
    const res = await getSettings()
    expect(res.ai_thinking_mode).toBe('fast')
  })

  it('updateSettings POSTs partial update', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        llm_max_tokens: 2048,
        ai_thinking_mode: 'fast',
        llm_timeout: 30,
        llm_max_retries: 3,
        llm_temperature: 0.7,
      }),
    )
    const res = await updateSettings({ llm_max_tokens: 2048 })
    expect(res.llm_max_tokens).toBe(2048)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })
})

// ================================================================
// Provider config
// ================================================================

describe('setProviderConfig', () => {
  it('POSTs config to provider endpoint', async () => {
    fetchMock.mockResolvedValue(
      okResponse({
        message: 'ok',
        provider: 'azure_openai',
        extra_config: { api_host: 'https://myhost.openai.azure.com' },
      }),
    )
    const res = await setProviderConfig('azure_openai', {
      api_host: 'https://myhost.openai.azure.com',
    })
    expect(res.provider).toBe('azure_openai')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/providers/azure_openai/config')
  })
})
