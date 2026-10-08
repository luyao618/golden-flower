// ============================================================
// 游戏逻辑 Hook (T6.1)
//
// 整合 WebSocket 通信和 Store 状态管理。
// 处理全部服务端事件，更新 gameStore 和 uiStore。
// 提供客户端操作方法（发送玩家操作、聊天、开始新局）。
// ============================================================

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../stores/gameStore'
import { useUIStore } from '../stores/uiStore'
import { canPeek, canStartHand } from '../utils/gameView'
import { useWebSocket, type ConnectionStatus } from './useWebSocket'
import type {
  Card,
  ChatMessage,
  GameAction,
  GameState,
  RoundResult,
  ServerEvent,
} from '../types/game'

// ---- 服务端事件 data 类型 ----

type GameStateData = GameState

interface RoundStartedData {
  round_number: number
  dealer: string
  dealer_index: number
  pot: number
  current_bet: number
  max_turns: number
}

interface CardsDealtData {
  your_cards: Card[]
}

interface TurnChangedData {
  current_player: string
  current_player_id: string
  available_actions: string[]
}

interface PlayerActedData {
  player_id: string
  player_name: string
  action: string
  amount: number
  compare_result: Record<string, unknown> | null
  is_fallback?: boolean
}

interface ChatMessageData {
  id: string
  player_id: string
  player_name: string
  message_type: string
  content: string
  timestamp: number
}

type RoundEndedData = RoundResult

interface GameEndedData {
  final_standings: Array<{
    id: string
    name: string
    chips: number
  }>
}

interface AIThinkingData {
  player_id: string
  player_name: string
}

interface AIReviewingData {
  player_id: string
  player_name: string
  trigger: string
}

interface ErrorData {
  message: string
}

interface CopilotErrorData {
  message: string
  error_code: string
}

// ---- Hook 配置 ----

interface UseGameConfig {
  /** 游戏 ID */
  gameId: string
  /** 玩家 ID */
  playerId: string
}

// ---- Hook 返回值 ----

export interface UseGameReturn {
  /** WebSocket 连接状态 */
  connectionStatus: ConnectionStatus
  /** 发送玩家操作 */
  sendAction: (action: GameAction, target?: string) => boolean
  /** 发送聊天消息 */
  sendChatMessage: (content: string) => boolean
  /** 发送开始新局 */
  sendStartRound: () => boolean
  /** 手动断开 */
  disconnect: () => void
  /** 手动重连 */
  reconnect: () => void
}

// ---- Hook ----

export function useGame(config: UseGameConfig | null): UseGameReturn {
  const { gameId = '', playerId = '' } = config ?? {}
  const settlementEffects = useRef(new Set<string>())
  const pendingCommand = useUIStore(s => s.pendingCommand)
  const setPendingCommand = useUIStore(s => s.setPendingCommand)

  // Store actions（从 store 中获取稳定的 action 引用）
  const setGameState = useGameStore((s) => s.setGameState)
  const setMyPlayerId = useGameStore((s) => s.setMyPlayerId)
  const setMyCards = useGameStore((s) => s.setMyCards)
  const setAvailableActions = useGameStore((s) => s.setAvailableActions)
  const setCurrentRound = useGameStore((s) => s.setCurrentRound)
  const addRoundResult = useGameStore((s) => s.addRoundResult)
  const addChatMessage = useGameStore((s) => s.addChatMessage)
  const clearChatMessages = useGameStore((s) => s.clearChatMessages)

  const setActivePlayer = useUIStore((s) => s.setActivePlayer)
  const setThinkingPlayer = useUIStore((s) => s.setThinkingPlayer)
  const setReviewingPlayer = useUIStore((s) => s.setReviewingPlayer)
  const startDealingAnimation = useUIStore((s) => s.startDealingAnimation)
  const triggerChipAnimation = useUIStore((s) => s.triggerChipAnimation)
  const startWinAnimation = useUIStore((s) => s.startWinAnimation)
  const setShowPlayerCards = useUIStore((s) => s.setShowPlayerCards)
  const setHasLookedAtCards = useUIStore((s) => s.setHasLookedAtCards)
  const setCopilotError = useUIStore((s) => s.setCopilotError)
  const pushErrorPopup = useUIStore((s) => s.pushErrorPopup)
  const setCompareRevealedCards = useUIStore((s) => s.setCompareRevealedCards)
  const clearCompareRevealedCards = useUIStore((s) => s.clearCompareRevealedCards)

  // ---- Server event handler ----

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      console.log('[Game] Server event received:', event.type)
      switch (event.type) {
        // ---- game_state: 完整游戏状态（连接时收到）----
        case 'game_state': {
          const data = event.data as GameStateData
          if (data.game_id !== gameId) break
          const wasSynchronized = useUIStore.getState().isGameSynchronized
          const previousRound = useGameStore.getState().currentRound?.round_number
          const round = data.current_round
          const pending = useUIStore.getState().pendingCommand
          useUIStore.getState().setGameSynchronized(true)
          if (!wasSynchronized || (pending && (
            round?.round_number !== pending.roundNumber ||
            (pending.kind === 'player_action' && (round?.phase !== 'betting' ||
              (pending.action !== 'check_cards' && data.players[round.current_player_index]?.id !== playerId)))
          ))) setPendingCommand(null)
          if (previousRound !== round?.round_number) clearCompareRevealedCards()
          const revealed = data.round_history.find(result => result.round_number === round?.round_number)?.hands_revealed
          if (revealed) setCompareRevealedCards(revealed)
          setMyPlayerId(playerId)
          setGameState(data)

          const me = data.players?.find((p) => p.id === playerId)
          setMyCards(me?.hand ?? [])
          setHasLookedAtCards(me?.status === 'active_seen')
          if (!useUIStore.getState().dealingAnimation.isDealing) {
            setShowPlayerCards(Boolean(data.current_round))
          }

          const currentPlayer = round?.phase === 'betting' && data.status === 'playing'
            ? data.players[round.current_player_index] : undefined
          setActivePlayer(currentPlayer?.id ?? null)
          if (currentPlayer?.id !== playerId || !wasSynchronized) setAvailableActions([])
          break
        }

        // ---- game_started: 游戏开始 ----
        case 'game_started': {
          const data = event.data as GameStateData
          setMyPlayerId(playerId)
          setGameState(data)
          break
        }

        // ---- round_started: 新一局开始 ----
        case 'round_started': {
          const data = event.data as RoundStartedData
          setPendingCommand(null)
          useUIStore.getState().setGameSynchronized(false)
          // 清空上一局的状态
          setMyCards([])
          setAvailableActions([])
          clearChatMessages()
          setThinkingPlayer(null)
          setReviewingPlayer(null)
          clearCompareRevealedCards()
          useGameStore.getState().clearActionLog()

          // 重置卡牌和看牌状态
          setShowPlayerCards(false)
          setHasLookedAtCards(false)

          // 触发发牌动画
          startDealingAnimation()

          // 更新局信息（使用服务端推送的实际数据）
          setCurrentRound({
            round_number: data.round_number,
            pot: data.pot ?? 0,
            current_bet: data.current_bet ?? 0,
            dealer_index: data.dealer_index ?? 0,
            current_player_index: 0,
            actions: [],
            phase: 'dealing',
            turn_count: 0,
            max_turns: data.max_turns ?? 10,
          })
          break
        }

        // ---- cards_dealt: 发牌（只有自己的手牌）----
        case 'cards_dealt': {
          const data = event.data as CardsDealtData
          if (data.your_cards) {
            // 先保存手牌数据（不立即显示，等发牌动画完成后 showPlayerCards=true 再显示）
            setMyCards(data.your_cards)
          }
          break
        }

        // ---- turn_changed: 轮到某个玩家行动 ----
        case 'turn_changed': {
          const data = event.data as TurnChangedData
          const pending = useUIStore.getState().pendingCommand
          if (pending?.kind === 'player_action' && pending.action !== 'check_cards' && data.current_player_id !== playerId) {
            setPendingCommand(null)
          }
          setActivePlayer(data.current_player_id)
          setThinkingPlayer(null) // 清除 AI 思考状态

          // 如果轮到自己，设置可用操作
          if (data.current_player_id === playerId) {
            setAvailableActions(data.available_actions as GameAction[])
          } else {
            setAvailableActions([])
          }
          break
        }

        // ---- player_acted: 某个玩家执行了操作 ----
        case 'player_acted': {
          const data = event.data as PlayerActedData
          setThinkingPlayer(null) // 清除 AI 思考状态

          // 如果是自己的操作
          if (data.player_id === playerId) {
            const pending = useUIStore.getState().pendingCommand
            if (pending?.kind === 'player_action' && pending.action === data.action) setPendingCommand(null)
            // 如果是看牌操作，自动翻转手牌显示正面
            // 看牌不消耗回合，不清空可用操作列表（等待 turn_changed 更新）
            if (data.action === 'check_cards') {
              setHasLookedAtCards(true)
            } else {
              // 非看牌操作：立即清空可用操作列表
              // 防止在等待下一个 turn_changed 事件期间，玩家重复点击已失效的按钮
              setAvailableActions([])
            }
          }

          // 筹码飞行动画：跟注/加注/比牌 等涉及筹码的操作
          if (data.amount > 0 && ['call', 'raise', 'compare'].includes(data.action)) {
            triggerChipAnimation(data.player_id, data.amount)
          }

          // 比牌亮牌：将双方的实际手牌保存到 uiStore，供 PlayerSeat 渲染
          if (data.action === 'compare' && data.compare_result) {
            const cr = data.compare_result as Record<string, unknown>
            const winnerId = cr.winner_id as string | undefined
            const loserId = cr.loser_id as string | undefined
            const winnerCards = cr.winner_cards as Card[] | null | undefined
            const loserCards = cr.loser_cards as Card[] | null | undefined

            const revealed: Record<string, Card[]> = {}
            if (winnerId && winnerCards) revealed[winnerId] = winnerCards
            if (loserId && loserCards) revealed[loserId] = loserCards

            if (Object.keys(revealed).length > 0) {
              setCompareRevealedCards(revealed)
            }
          }

          // 将操作记录添加到 store 中的 actionLog（用于行动日志 T6.5）
          const store = useGameStore.getState()
          store.addActionLog({
            player_id: data.player_id,
            player_name: data.player_name,
            action: data.action as GameAction,
            amount: data.amount,
            compare_result: data.compare_result,
            is_fallback: data.is_fallback,
          })

          break
        }

        // ---- chat_message: 聊天消息 ----
        case 'chat_message': {
          const data = event.data as ChatMessageData
          const chatMsg: ChatMessage = {
            id: data.id,
            game_id: gameId,
            round_number: 0,
            player_id: data.player_id,
            player_name: data.player_name,
            message_type: data.message_type as ChatMessage['message_type'],
            content: data.content,
            timestamp: data.timestamp,
          }
          addChatMessage(chatMsg)
          break
        }

        // ---- round_ended: 本局结束 ----
        case 'round_ended': {
          const data = event.data as RoundEndedData
          const effectId = `${gameId}:${data.round_number}`
          const alreadyReceived = settlementEffects.current.has(effectId)
          settlementEffects.current.add(effectId)
          addRoundResult(data)
          setPendingCommand(null)
          if (data.hands_revealed) setCompareRevealedCards(data.hands_revealed)
          setAvailableActions([])
          setActivePlayer(null)
          setThinkingPlayer(null)
          setReviewingPlayer(null)

          // 触发赢家筹码飞行动画（底池 → 赢家）
          if (!alreadyReceived && data.winner_id && data.pot > 0) {
            startWinAnimation(data.winner_id, data.pot)
          }

          break
        }

        // ---- game_ended: 整场游戏结束 ----
        case 'game_ended': {
          const data = event.data as GameEndedData
          setPendingCommand(null)
          setAvailableActions([])
          setActivePlayer(null)
          setThinkingPlayer(null)
          setReviewingPlayer(null)

          // 更新玩家最终筹码
          const store = useGameStore.getState()
          for (const standing of data.final_standings) {
            store.updatePlayer(standing.id, { chips: standing.chips })
          }

          // 设置游戏状态为完成
          useGameStore.setState({
            status: 'finished',
            gameState: store.gameState ? { ...store.gameState, status: 'finished', players: useGameStore.getState().players } : null,
          })
          break
        }

        // ---- ai_thinking: AI 正在思考 ----
        case 'ai_thinking': {
          const data = event.data as AIThinkingData
          setThinkingPlayer(data.player_id)
          setActivePlayer(data.player_id)
          break
        }

        // ---- ai_reviewing: AI 正在经验回顾 ----
        case 'ai_reviewing': {
          const data = event.data as AIReviewingData
          setReviewingPlayer(data.player_id)
          break
        }

        // ---- error: 错误消息 ----
        case 'error': {
          const data = event.data as ErrorData
          setPendingCommand(null)
          console.error('[Game] Server error:', data.message)
          // 弹出错误弹窗，让用户清楚看到出了什么问题
          pushErrorPopup({
            message: data.message,
            source: '操作失败',
          })
          // 同时保留聊天消息中的记录
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            game_id: gameId,
            round_number: 0,
            player_id: 'system',
            player_name: '系统',
            message_type: 'system_message',
            content: data.message,
            timestamp: Date.now() / 1000,
          }
          addChatMessage(errorMsg)
          break
        }

        // ---- copilot_error: Copilot API 错误（如 403 订阅问题）----
        case 'copilot_error': {
          const data = event.data as CopilotErrorData
          console.error('[Game] Copilot error:', data.error_code, data.message)
          setCopilotError({
            message: data.message,
            errorCode: data.error_code,
          })
          break
        }

        default:
          console.warn('[Game] Unknown server event type:', event.type)
      }
    },
    [
      playerId,
      gameId,
      setPendingCommand,
      setGameState,
      setMyPlayerId,
      setMyCards,
      setAvailableActions,
      setCurrentRound,
      addRoundResult,
      addChatMessage,
      clearChatMessages,
      setActivePlayer,
      setThinkingPlayer,
      setReviewingPlayer,
      startDealingAnimation,
      triggerChipAnimation,
      startWinAnimation,
      setShowPlayerCards,
      setHasLookedAtCards,
      setCopilotError,
      pushErrorPopup,
      setCompareRevealedCards,
      clearCompareRevealedCards,
    ],
  )

  const invalidateConnection = useCallback(() => {
    useUIStore.getState().setGameSynchronized(false)
    useUIStore.getState().setPendingCommand(null)
    useGameStore.getState().setAvailableActions([])
  }, [])

  // ---- WebSocket config (only when we have both IDs) ----

  const wsConfig = useMemo(
    () =>
      config && gameId && playerId
        ? {
            gameId,
            playerId,
            onMessage: handleServerEvent,
            onConnected: () => {
              invalidateConnection()
            },
            onDisconnected: () => {
              invalidateConnection()
            },
            onError: (error: string) => {
              console.error('[Game] WebSocket error:', error)
            },
          }
        : null,
    [config, gameId, playerId, handleServerEvent, invalidateConnection],
  )

  const { status: connectionStatus, sendAction: transportAction, sendChatMessage: transportChat,
    sendStartRound: transportStart, disconnect, reconnect: transportReconnect } = useWebSocket(wsConfig)

  useEffect(() => {
    if (connectionStatus !== 'connected') invalidateConnection()
  }, [connectionStatus, invalidateConnection])

  useEffect(() => invalidateConnection, [gameId, playerId, invalidateConnection])

  const reportFailedSend = useCallback(() => {
    useUIStore.getState().setPendingCommand(null)
    pushErrorPopup({ message: '连接不可用，操作未发送，请重连后重试', source: '连接中断' })
    return false
  }, [pushErrorPopup])

  const sendAction = useCallback((action: GameAction, target?: string): boolean => {
    const ui = useUIStore.getState()
    const store = useGameStore.getState()
    if (connectionStatus !== 'connected' || !ui.isGameSynchronized) return reportFailedSend()
    if (ui.pendingCommand || store.gameId !== gameId) return false
    const me = store.players.find(player => player.id === playerId)
    const game = store.gameState
    if (!game || game.status !== 'playing' || game.current_round?.phase !== 'betting') return false
    if (action === 'check_cards') {
      if (!canPeek(game, me)) return false
    } else if (!store.availableActions.includes(action) || game.players[game.current_round.current_player_index]?.id !== playerId) {
      return false
    }
    if (action === 'compare' && (!target || target === playerId || !store.players.some(player =>
      player.id === target && ['active_blind', 'active_seen'].includes(player.status)))) return false
    ui.setPendingCommand({ requestId: crypto.randomUUID(), kind: 'player_action', action, target,
      roundNumber: store.currentRound?.round_number ?? null })
    if (!transportAction(action, target)) return reportFailedSend()
    return true
  }, [connectionStatus, transportAction, gameId, playerId, reportFailedSend])

  const sendStartRound = useCallback((): boolean => {
    const ui = useUIStore.getState()
    const store = useGameStore.getState()
    if (connectionStatus !== 'connected' || !ui.isGameSynchronized) return reportFailedSend()
    if (ui.pendingCommand || store.gameId !== gameId || !canStartHand(store.gameState)) return false
    ui.setPendingCommand({ requestId: crypto.randomUUID(), kind: 'start_round',
      roundNumber: store.currentRound?.round_number ?? null })
    if (!transportStart()) return reportFailedSend()
    return true
  }, [connectionStatus, transportStart, gameId, reportFailedSend])

  const sendChatMessage = useCallback((content: string): boolean => {
    if (connectionStatus !== 'connected' || !transportChat(content)) {
      pushErrorPopup({ message: '连接不可用，消息未发送，请重连后重试', source: '连接中断' })
      return false
    }
    return true
  }, [connectionStatus, transportChat, pushErrorPopup])

  const reconnect = useCallback(() => {
    invalidateConnection()
    transportReconnect()
  }, [invalidateConnection, transportReconnect])

  useEffect(() => {
    if (!pendingCommand) return
    const timer = setTimeout(() => {
      pushErrorPopup({ message: '等待服务器确认，正在重连同步状态；不会自动重发操作', source: '操作待确认' })
      reconnect()
    }, 15000)
    return () => clearTimeout(timer)
  }, [pendingCommand, reconnect, pushErrorPopup])

  return {
    connectionStatus: connectionStatus,
    sendAction,
    sendChatMessage,
    sendStartRound,
    disconnect: disconnect,
    reconnect,
  }
}
