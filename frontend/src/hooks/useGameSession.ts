import { useCallback, useEffect, useState } from 'react'
import { ApiError, getGameState } from '../services/api'
import { useSessionStore } from '../stores/sessionStore'
import { useGameStore } from '../stores/gameStore'
import { useUIStore } from '../stores/uiStore'

type SessionLoad = {
  gameId: string
  playerId: string
  attempt: number
  status: 'loading' | 'ready' | 'missing' | 'error'
  error?: string
}

/** 只用此标签页记住的身份恢复游戏；旧路由响应不得写入当前牌桌。 */
export function useGameSession(gameId: string) {
  const playerId = useSessionStore(s => s.sessions[gameId]?.playerId) ?? ''
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<SessionLoad | null>(null)
  const retry = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    useUIStore.getState().resetUI()
    useGameStore.setState({ gameId: null, myPlayerId: null, gameState: null,
      players: [], myCards: [], currentRound: null, roundHistory: [],
      config: null, availableActions: [], actionLog: [], chatMessages: [], status: 'idle', error: null })
    if (gameId && playerId) {
      getGameState(gameId, playerId, controller.signal).then(game => {
        if (cancelled) return
        const me = game.players.find(player => player.id === playerId && player.player_type === 'human')
        if (game.game_id !== gameId || !me) {
          setLoad({ gameId, playerId, attempt, status: 'missing', error: '游戏与已保存的玩家身份不匹配，请返回大厅' })
          return
        }
        const store = useGameStore.getState()
        store.setMyPlayerId(playerId)
        store.setGameState(game)
        store.setMyCards(me.hand ?? [])
        useUIStore.getState().setHasLookedAtCards(me.status === 'active_seen')
        useUIStore.getState().setShowPlayerCards(Boolean(game.current_round))
        setLoad({ gameId, playerId, attempt, status: 'ready' })
      }).catch(error => {
        if (cancelled) return
        setLoad({ gameId, playerId, attempt,
          status: error instanceof ApiError && [403, 404].includes(error.status) ? 'missing' : 'error',
          error: error instanceof Error ? error.message : '加载游戏失败' })
      })
    }
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [gameId, playerId, attempt])

  if (!gameId || !playerId) {
    return { status: 'missing' as const, playerId, error: '缺少本场游戏的玩家身份，请返回大厅创建游戏', retry }
  }
  if (!load || load.gameId !== gameId || load.playerId !== playerId || load.attempt !== attempt) {
    return { status: 'loading' as const, playerId, retry }
  }
  return { ...load, retry }
}
