// ============================================================
// 游戏状态 Store (Zustand)
// 管理游戏配置、创建、基础状态
// ============================================================

import { create } from 'zustand'
import type {
  AIModelInfo,
  AIPlayerConfig,
  Card,
  ChatMessage,
  CreateGameResponse,
  GameAction,
  GameConfig,
  GameState,
  Player,
  RoundResult,
  RoundState,
} from '../types/game'

// ---- 操作日志条目（用于行动日志 T6.5）----

export interface ActionLogEntry {
  player_id: string
  player_name: string
  action: GameAction
  amount: number
  compare_result: Record<string, unknown> | null
  is_fallback?: boolean
  timestamp: number
}
import { createGame as apiCreateGame, getAvailableModels } from '../services/api'
import { useUIStore } from './uiStore'
import { useSessionStore } from './sessionStore'

// ---- AI 对手配置 (大厅用) ----

export interface AIOpponentConfig {
  model_id: string
  name: string
}

// ---- Store 类型 ----

interface GameStore {
  // 游戏状态
  gameId: string | null
  players: Player[]
  gameState: GameState | null
  status: 'idle' | 'creating' | 'waiting' | 'playing' | 'finished'
  error: string | null

  // 牌桌运行时状态
  myPlayerId: string | null
  myCards: Card[]
  currentRound: RoundState | null
  roundHistory: RoundResult[]
  config: GameConfig | null
  chatMessages: ChatMessage[]
  availableActions: GameAction[]
  actionLog: ActionLogEntry[]

  // 大厅配置
  playerName: string
  aiOpponents: AIOpponentConfig[]
  gameConfig: GameConfig

  // 可用模型
  availableModels: AIModelInfo[]
  modelsLoading: boolean

  // Actions
  setPlayerName: (name: string) => void
  setGameConfig: (config: Partial<GameConfig>) => void

  // AI 对手管理
  addAIOpponent: () => void
  removeAIOpponent: (index: number) => void
  updateAIOpponent: (index: number, update: Partial<AIOpponentConfig>) => void

  // API 操作
  fetchModels: () => Promise<void>
  createGame: () => Promise<CreateGameResponse>
  setGameState: (state: GameState) => void
  reset: () => void

  // 牌桌运行时操作
  setMyPlayerId: (id: string) => void
  setMyCards: (cards: Card[]) => void
  setAvailableActions: (actions: GameAction[]) => void
  updatePlayer: (playerId: string, updates: Partial<Player>) => void
  setCurrentRound: (round: RoundState | null) => void
  addRoundResult: (result: RoundResult) => void
  addChatMessage: (message: ChatMessage) => void
  clearChatMessages: () => void
  addActionLog: (entry: Omit<ActionLogEntry, 'timestamp'>) => void
  clearActionLog: () => void

  // 衍生状态
  getMyPlayer: () => Player | undefined
  getCurrentPlayer: () => Player | undefined
  getPlayerById: (id: string) => Player | undefined
  isMyTurn: () => boolean
}

// ---- 默认值 ----

const DEFAULT_GAME_CONFIG: GameConfig = {
  initial_chips: 1000,
  ante: 10,
  max_bet: 200,
  max_turns: 10,
}

const DEFAULT_AI_OPPONENT: AIOpponentConfig = {
  model_id: '',  // will be auto-set to first available model by fetchModels()
  name: '',
}

function createDefaultAIOpponent(): AIOpponentConfig {
  return { ...DEFAULT_AI_OPPONENT }
}

// ---- 模型短名称工具函数 ----

/** 自动名称最大长度 */
const MAX_NAME_LENGTH = 32

/** 从 display_name 提取模型核心短名称 */
export function getShortModelName(displayName: string): string {
  let name = displayName
  const colonIdx = name.indexOf(':')
  if (colonIdx !== -1) name = name.slice(colonIdx + 1)
  name = name.replace(/\s*\([^)]*\)/g, '').trim()
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trimEnd()
  return name || displayName.slice(0, MAX_NAME_LENGTH)
}

/** 生成不与现有对手名称重复的短名称 */
export function getUniqueShortName(
  displayName: string,
  currentIndex: number,
  opponents: AIOpponentConfig[],
): string {
  const baseName = getShortModelName(displayName)
  const otherNames = new Set(
    opponents.filter((_, i) => i !== currentIndex).map((op) => op.name),
  )
  if (!otherNames.has(baseName)) return baseName
  // 有重名，加序号后缀 -1, -2, ...
  // 必要时缩短 baseName，确保总长 <= MAX_NAME_LENGTH
  for (let n = 1; n <= 10; n++) {
    const suffix = `-${n}`
    const maxBase = MAX_NAME_LENGTH - suffix.length
    const truncatedBase = baseName.length > maxBase ? baseName.slice(0, maxBase).trimEnd() : baseName
    const candidate = `${truncatedBase}${suffix}`
    if (!otherNames.has(candidate)) return candidate
  }
  return baseName
}

// ---- Store ----

export const useGameStore = create<GameStore>((set, get) => ({
  // 初始状态
  gameId: null,
  players: [],
  gameState: null,
  status: 'idle',
  error: null,

  myPlayerId: null,
  myCards: [],
  currentRound: null,
  roundHistory: [],
  config: null,
  chatMessages: [],
  availableActions: [],
  actionLog: [],

  playerName: '',
  aiOpponents: [createDefaultAIOpponent(), createDefaultAIOpponent(), createDefaultAIOpponent()],
  gameConfig: { ...DEFAULT_GAME_CONFIG },

  availableModels: [],
  modelsLoading: false,

  // ---- 基础设置 ----

  setPlayerName: (name) => set({ playerName: name }),

  setGameConfig: (config) =>
    set((state) => ({
      gameConfig: { ...state.gameConfig, ...config },
    })),

  // ---- AI 对手管理 ----

  addAIOpponent: () =>
    set((state) => {
      if (state.aiOpponents.length >= 4) return state
      // 使用第一个可用模型作为默认值，避免使用不可用的硬编码模型
      const defaultModelId = state.availableModels.length > 0
        ? state.availableModels[0].id
        : DEFAULT_AI_OPPONENT.model_id
      const defaultModel = state.availableModels.find((m) => m.id === defaultModelId)
      const newOpponent: AIOpponentConfig = { ...DEFAULT_AI_OPPONENT, model_id: defaultModelId }
      // 自动生成去重短名称
      const newIndex = state.aiOpponents.length
      const tempOpponents = [...state.aiOpponents, newOpponent]
      if (defaultModel) {
        newOpponent.name = getUniqueShortName(defaultModel.display_name, newIndex, tempOpponents)
      }
      return { aiOpponents: tempOpponents }
    }),

  removeAIOpponent: (index) =>
    set((state) => {
      if (state.aiOpponents.length <= 1) return state
      return {
        aiOpponents: state.aiOpponents.filter((_, i) => i !== index),
      }
    }),

  updateAIOpponent: (index, update) =>
    set((state) => ({
      aiOpponents: state.aiOpponents.map((op, i) =>
        i === index ? { ...op, ...update } : op
      ),
    })),

  // ---- API 操作 ----

  fetchModels: async () => {
    set({ modelsLoading: true })
    try {
      const models = await getAvailableModels()
      // 如果当前 AI 对手的 model_id 不在可用模型列表中，自动修正为第一个可用模型
      const validIds = new Set(models.map((m) => m.id))
      const firstModelId = models.length > 0 ? models[0].id : ''
      const { aiOpponents } = get()
      const needsUpdate = aiOpponents.some((op) => !validIds.has(op.model_id))
      if (needsUpdate && firstModelId) {
        const firstModel = models.find((m) => m.id === firstModelId)
        const updatedOpponents = aiOpponents.map((op) =>
          validIds.has(op.model_id) ? op : { ...op, model_id: firstModelId }
        )
        // 为名称为空的对手自动填入短名称
        if (firstModel) {
          for (let i = 0; i < updatedOpponents.length; i++) {
            if (!updatedOpponents[i].name) {
              updatedOpponents[i] = {
                ...updatedOpponents[i],
                name: getUniqueShortName(firstModel.display_name, i, updatedOpponents),
              }
            }
          }
        }
        set({ availableModels: models, modelsLoading: false, aiOpponents: updatedOpponents })
      } else {
        set({ availableModels: models, modelsLoading: false })
      }
    } catch (err) {
      console.error('Failed to fetch models:', err)
      set({ modelsLoading: false })
      useUIStore.getState().pushErrorPopup({
        message: err instanceof Error ? err.message : '获取模型列表失败，请检查网络连接',
        source: '加载模型',
      })
    }
  },

  createGame: async () => {
    const { playerName, aiOpponents, gameConfig } = get()

    set({ status: 'creating', error: null })

    try {
      const aiConfigs: AIPlayerConfig[] = aiOpponents.map((op) => ({
        model_id: op.model_id,
        ...(op.name ? { name: op.name } : {}),
      }))

      const response = await apiCreateGame({
        player_name: playerName,
        ai_opponents: aiConfigs,
        initial_chips: gameConfig.initial_chips,
        ante: gameConfig.ante,
        max_bet: gameConfig.max_bet,
        max_turns: gameConfig.max_turns,
      })

      // 从响应中找到人类玩家的 ID
      const humanPlayer = response.players.find((p) => p.player_type === 'human')
      if (!humanPlayer?.id || !response.game_id) throw new Error('创建响应缺少游戏或人类玩家身份')
      useSessionStore.getState().remember(response.game_id, humanPlayer.id)

      set({
        gameId: response.game_id,
        myPlayerId: humanPlayer.id,
        status: 'waiting',
      })

      return response
    } catch (err) {
      const message = err instanceof Error ? err.message : '创建游戏失败'
      set({ status: 'idle', error: message })
      throw err
    }
  },

  setGameState: (state) =>
    set({
      gameState: state,
      gameId: state.game_id,
      players: state.players,
      currentRound: state.current_round,
      roundHistory: state.round_history,
      config: state.config,
      status: state.status,
    }),

  reset: () =>
    set({
      gameId: null,
      players: [],
      gameState: null,
      status: 'idle',
      error: null,
      myPlayerId: null,
      myCards: [],
      currentRound: null,
      roundHistory: [],
      config: null,
      chatMessages: [],
      availableActions: [],
      actionLog: [],
      playerName: '',
      aiOpponents: [createDefaultAIOpponent(), createDefaultAIOpponent(), createDefaultAIOpponent()],
      gameConfig: { ...DEFAULT_GAME_CONFIG },
    }),

  // ---- 牌桌运行时操作 ----

  setMyPlayerId: (id) => set({ myPlayerId: id }),

  setMyCards: (cards) => set({ myCards: cards }),

  setAvailableActions: (actions) => set({ availableActions: actions }),

  updatePlayer: (playerId, updates) =>
    set((state) => ({
      players: state.players.map((p) =>
        p.id === playerId ? { ...p, ...updates } : p
      ),
    })),

  setCurrentRound: (round) => set({ currentRound: round }),

  addRoundResult: (result) =>
    set((state) => ({
      roundHistory: [...state.roundHistory.filter(
        existing => existing.round_number !== result.round_number,
      ), result].sort((a, b) => a.round_number - b.round_number),
    })),

  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    })),

  clearChatMessages: () => set({ chatMessages: [] }),

  addActionLog: (entry) =>
    set((state) => ({
      actionLog: [
        ...state.actionLog,
        { ...entry, timestamp: Date.now() / 1000 },
      ],
    })),

  clearActionLog: () => set({ actionLog: [] }),

  // ---- 衍生状态 ----

  getMyPlayer: () => {
    const { players, myPlayerId } = get()
    return players.find((p) => p.id === myPlayerId)
  },

  getCurrentPlayer: () => {
    const { players, currentRound } = get()
    if (!currentRound) return undefined
    return players[currentRound.current_player_index]
  },

  getPlayerById: (id) => {
    return get().players.find((p) => p.id === id)
  },

  isMyTurn: () => {
    const { myPlayerId } = get()
    const currentPlayer = get().getCurrentPlayer()
    return currentPlayer?.id === myPlayerId
  },
}))
