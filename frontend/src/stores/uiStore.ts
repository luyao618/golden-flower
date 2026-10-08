import { create } from 'zustand'
import type { Card, GameAction } from '../types/game'

// ---- 动画状态 ----

export interface DealingAnimation {
  /** 正在发牌中 */
  isDealing: boolean
  /** 当前发到第几张 */
  currentCardIndex: number
}

export interface ChipAnimation {
  /** 筹码飞行动画（玩家 → 底池） */
  fromPlayerId: string | null
  /** 筹码数量 */
  amount: number
}

// ---- 赢家动画状态 ----

export interface WinAnimationState {
  /** 赢家玩家 ID */
  winnerId: string
  /** 赢得的筹码数量 */
  amount: number
  /** 是否正在播放 */
  isPlaying: boolean
}

// ---- 通用错误弹窗状态 ----

export interface ErrorPopupState {
  /** 错误消息 */
  message: string
  /** 错误来源（可选，用于显示标题） */
  source?: string
}

// ---- Copilot 错误状态 ----

export interface CopilotErrorState {
  /** 错误消息 */
  message: string
  /** 错误码 */
  errorCode: string
}

// ---- UI 状态 ----

export interface PendingCommand {
  requestId: string
  kind: 'start_round' | 'player_action'
  action?: GameAction
  target?: string
  roundNumber: number | null
}

export interface UIState {
  pendingCommand: PendingCommand | null
  isGameSynchronized: boolean
  setPendingCommand: (command: PendingCommand | null) => void
  setGameSynchronized: (ready: boolean) => void
  // 当前选中/高亮的玩家
  selectedPlayerId: string | null
  // 当前行动玩家 ID（高亮边框）
  activePlayerId: string | null

  // 比牌选择模式
  isCompareMode: boolean
  compareTargetId: string | null

  // AI 状态指示
  thinkingPlayerId: string | null
  reviewingPlayerId: string | null

  // 发牌动画
  dealingAnimation: DealingAnimation

  // 筹码动画
  chipAnimation: ChipAnimation | null

  // 赢家筹码飞行动画
  winAnimation: WinAnimationState | null

  // 发牌完毕后是否显示手牌
  showPlayerCards: boolean

  // 人类玩家是否已看牌（触发翻牌动画）
  hasLookedAtCards: boolean

  // 通用错误弹窗（队列，支持多条错误堆叠显示）
  errorPopups: ErrorPopupState[]

  // Copilot 错误弹窗
  copilotError: CopilotErrorState | null

  // 心路历程抽屉
  isThoughtDrawerOpen: boolean
  thoughtDrawerAgentId: string | null

  // 游戏信息面板折叠
  isGameLogExpanded: boolean
  isChatPanelExpanded: boolean

  // 比牌后亮牌（player_id -> Card[]）
  compareRevealedCards: Record<string, Card[]>

  // Actions
  setSelectedPlayer: (playerId: string | null) => void
  setActivePlayer: (playerId: string | null) => void
  enterCompareMode: () => void
  exitCompareMode: () => void
  setCompareTarget: (playerId: string | null) => void
  setThinkingPlayer: (playerId: string | null) => void
  setReviewingPlayer: (playerId: string | null) => void
  startDealingAnimation: () => void
  stopDealingAnimation: () => void
  advanceDealingCard: () => void
  triggerChipAnimation: (fromPlayerId: string, amount: number) => void
  clearChipAnimation: () => void
  startWinAnimation: (winnerId: string, amount: number) => void
  clearWinAnimation: () => void
  setShowPlayerCards: (show: boolean) => void
  setHasLookedAtCards: (looked: boolean) => void
  pushErrorPopup: (error: ErrorPopupState) => void
  dismissErrorPopup: (index: number) => void
  clearAllErrorPopups: () => void
  setCopilotError: (error: CopilotErrorState | null) => void
  toggleThoughtDrawer: (agentId?: string) => void
  toggleGameLog: () => void
  toggleChatPanel: () => void
  setCompareRevealedCards: (cards: Record<string, Card[]>) => void
  clearCompareRevealedCards: () => void
  resetUI: () => void
}

export const useUIStore = create<UIState>((set) => ({
  pendingCommand: null,
  isGameSynchronized: false,
  setPendingCommand: (pendingCommand) => set({ pendingCommand }),
  setGameSynchronized: (isGameSynchronized) => set({ isGameSynchronized }),
  // Initial state
  selectedPlayerId: null,
  activePlayerId: null,
  isCompareMode: false,
  compareTargetId: null,
  thinkingPlayerId: null,
  reviewingPlayerId: null,
  dealingAnimation: {
    isDealing: false,
    currentCardIndex: 0,
  },
  chipAnimation: null,
  winAnimation: null,
  showPlayerCards: false,
  hasLookedAtCards: false,
  errorPopups: [],
  copilotError: null,
  isThoughtDrawerOpen: false,
  thoughtDrawerAgentId: null,
  isGameLogExpanded: true,
  isChatPanelExpanded: false,
  compareRevealedCards: {},

  // Actions
  setSelectedPlayer: (playerId) =>
    set({ selectedPlayerId: playerId }),

  setActivePlayer: (playerId) =>
    set({ activePlayerId: playerId }),

  enterCompareMode: () =>
    set({ isCompareMode: true, compareTargetId: null }),

  exitCompareMode: () =>
    set({ isCompareMode: false, compareTargetId: null }),

  setCompareTarget: (playerId) =>
    set({ compareTargetId: playerId }),

  setThinkingPlayer: (playerId) =>
    set({ thinkingPlayerId: playerId }),

  setReviewingPlayer: (playerId) =>
    set({ reviewingPlayerId: playerId }),

  startDealingAnimation: () =>
    set({
      dealingAnimation: { isDealing: true, currentCardIndex: 0 },
    }),

  stopDealingAnimation: () =>
    set({
      dealingAnimation: { isDealing: false, currentCardIndex: 0 },
    }),

  advanceDealingCard: () =>
    set((state) => ({
      dealingAnimation: {
        ...state.dealingAnimation,
        currentCardIndex: state.dealingAnimation.currentCardIndex + 1,
      },
    })),

  triggerChipAnimation: (fromPlayerId, amount) =>
    set({ chipAnimation: { fromPlayerId, amount } }),

  clearChipAnimation: () =>
    set({ chipAnimation: null }),

  startWinAnimation: (winnerId, amount) =>
    set({ winAnimation: { winnerId, amount, isPlaying: true } }),

  clearWinAnimation: () =>
    set({ winAnimation: null }),

  setShowPlayerCards: (show) =>
    set({ showPlayerCards: show }),

  setHasLookedAtCards: (looked) =>
    set({ hasLookedAtCards: looked }),

  pushErrorPopup: (error) =>
    set((state) => ({
      errorPopups: [...state.errorPopups, error],
    })),

  dismissErrorPopup: (index) =>
    set((state) => ({
      errorPopups: state.errorPopups.filter((_, i) => i !== index),
    })),

  clearAllErrorPopups: () =>
    set({ errorPopups: [] }),

  setCopilotError: (error) =>
    set({ copilotError: error }),

  toggleThoughtDrawer: (agentId) =>
    set((state) => ({
      isThoughtDrawerOpen: agentId
        ? true
        : !state.isThoughtDrawerOpen,
      thoughtDrawerAgentId: agentId ?? state.thoughtDrawerAgentId,
    })),

  toggleGameLog: () =>
    set((state) => ({ isGameLogExpanded: !state.isGameLogExpanded })),

  toggleChatPanel: () =>
    set((state) => ({ isChatPanelExpanded: !state.isChatPanelExpanded })),

  setCompareRevealedCards: (cards) =>
    set({ compareRevealedCards: cards }),

  clearCompareRevealedCards: () =>
    set({ compareRevealedCards: {} }),

  resetUI: () =>
    set({
      pendingCommand: null,
      isGameSynchronized: false,
      selectedPlayerId: null,
      activePlayerId: null,
      isCompareMode: false,
      compareTargetId: null,
      thinkingPlayerId: null,
      reviewingPlayerId: null,
      dealingAnimation: { isDealing: false, currentCardIndex: 0 },
      chipAnimation: null,
      winAnimation: null,
      showPlayerCards: false,
      hasLookedAtCards: false,
      errorPopups: [],
      copilotError: null,
      isThoughtDrawerOpen: false,
      thoughtDrawerAgentId: null,
      compareRevealedCards: {},
    }),
}))
