/**
 * useGame hook 单元测试
 *
 * useGame 整合了 useWebSocket 和 Store 更新。
 * 我们 mock useWebSocket 返回值，然后手动触发 onMessage 回调，
 * 验证 store 状态正确更新。
 *
 * 覆盖：
 * - null config → 返回 disconnected
 * - game_state 事件 → setGameState + setMyPlayerId
 * - round_started → 重置状态 + 发牌动画
 * - cards_dealt → setMyCards
 * - turn_changed → setActivePlayer + setAvailableActions
 * - player_acted → addActionLog + chip animation
 * - chat_message → addChatMessage
 * - round_ended → addRoundResult + win animation
 * - game_ended → status = finished
 * - ai_thinking → setThinkingPlayer
 * - ai_reviewing → setReviewingPlayer
 * - error → pushErrorPopup
 * - copilot_error → setCopilotError
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useGame } from '../useGame'
import { useGameStore } from '../../stores/gameStore'
import { useUIStore } from '../../stores/uiStore'
import type { GameState, ServerEvent } from '../../types/game'

// ---- Mock useWebSocket ----
const socket = vi.hoisted(() => ({ status: 'connected', sendAction: vi.fn(() => true),
  sendChatMessage: vi.fn(() => true), sendStartRound: vi.fn(() => true),
  disconnect: vi.fn(), reconnect: vi.fn() }))

let capturedOnMessage: ((event: ServerEvent) => void) | null = null

vi.mock('../useWebSocket', () => ({
  useWebSocket: (config: { onMessage?: (event: ServerEvent) => void } | null) => {
    if (config?.onMessage) {
      capturedOnMessage = config.onMessage
    }
    return { ...socket, status: config ? socket.status : 'disconnected' }
  },
}))

function resetStores() {
  useGameStore.getState().reset()
  useUIStore.getState().resetUI()
}

function fire(event: ServerEvent) {
  act(() => {
    capturedOnMessage?.(event)
  })
}

describe('useGame', () => {
  beforeEach(() => {
    resetStores()
    capturedOnMessage = null
    vi.clearAllMocks()
    socket.status = 'connected'
    socket.sendAction.mockReturnValue(true)
    socket.sendStartRound.mockReturnValue(true)
  })

it('does not pay settlement twice or erase the server round', () => {
  vi.useFakeTimers()
  try {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    const result = {
      round_number: 1, winner_id: 'p1', winner_name: 'Me', pot: 60,
      win_method: '其他玩家全部弃牌', hands_revealed: null,
      player_chip_changes: { p1: 30, p2: -30 },
    }
    fire({ type: 'game_state', data: {
      game_id: 'g1', status: 'playing',
      config: { initial_chips: 500, ante: 10, max_bet: 200, max_turns: 10 },
      players: [
        { id: 'p1', name: 'Me', avatar: '', player_type: 'human', chips: 530,
          status: 'active_seen', hand: null, total_bet_this_round: 30, model_id: null },
        { id: 'p2', name: 'Bot', avatar: '', player_type: 'ai', chips: 470,
          status: 'folded', hand: null, total_bet_this_round: 30, model_id: 'm1' },
      ],
      round_history: [result],
      current_round: { round_number: 1, pot: 60, current_bet: 10, dealer_index: 0,
        current_player_index: 0, actions: [], phase: 'settlement', turn_count: 1,
        max_turns: 10 },
    } })
    fire({ type: 'round_ended', data: result })
    expect(useGameStore.getState().players.map(p => p.chips)).toEqual([530, 470])
    expect(useGameStore.getState().roundHistory).toHaveLength(1)
    act(() => vi.advanceTimersByTime(2000))
    expect(useGameStore.getState().currentRound?.phase).toBe('settlement')
  } finally {
    vi.useRealTimers()
  }
})

  // ---- null config ----

  it('returns disconnected when config is null', () => {
    const { result } = renderHook(() => useGame(null))
    expect(result.current.connectionStatus).toBe('disconnected')
  })

  // ---- game_state ----

  it('game_state → updates game store', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'game_state',
      data: {
        game_id: 'g1',
        players: [
          { id: 'p1', name: 'Me', avatar: '', player_type: 'human', chips: 1000, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: null },
          { id: 'p2', name: 'Bot', avatar: '', player_type: 'ai', chips: 1000, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: 'm1' },
        ],
        current_round: null,
        round_history: [],
        config: { initial_chips: 1000, ante: 10, max_bet: 200, max_turns: 10 },
        status: 'playing',
      },
    })

    expect(useGameStore.getState().gameId).toBe('g1')
    expect(useGameStore.getState().myPlayerId).toBe('p1')
    expect(useGameStore.getState().players).toHaveLength(2)
  })

  // ---- round_started ----

  it('round_started → resets state + starts dealing animation', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    // Pre-set some state
    useGameStore.getState().addChatMessage({
      id: 'old', game_id: 'g1', round_number: 1, player_id: 'p1',
      player_name: 'X', message_type: 'action_talk', content: 'hi', timestamp: 1,
    })

    fire({
      type: 'round_started',
      data: { round_number: 2, dealer: 'p2', dealer_index: 1, pot: 30, current_bet: 10, max_turns: 10 },
    })

    expect(useGameStore.getState().chatMessages).toEqual([])
    expect(useGameStore.getState().myCards).toEqual([])
    expect(useUIStore.getState().dealingAnimation.isDealing).toBe(true)
    expect(useGameStore.getState().currentRound?.round_number).toBe(2)
  })

  // ---- cards_dealt ----

  it('cards_dealt → sets my cards', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    const cards = [
      { suit: 'hearts', rank: 14 },
      { suit: 'spades', rank: 10 },
      { suit: 'diamonds', rank: 7 },
    ]
    fire({ type: 'cards_dealt', data: { your_cards: cards } })

    expect(useGameStore.getState().myCards).toEqual(cards)
  })

  // ---- turn_changed ----

  it('turn_changed → sets active player and available actions for me', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'turn_changed',
      data: {
        current_player: 'Me',
        current_player_id: 'p1',
        available_actions: ['call', 'raise', 'fold'],
      },
    })

    expect(useUIStore.getState().activePlayerId).toBe('p1')
    expect(useGameStore.getState().availableActions).toEqual(['call', 'raise', 'fold'])
  })

  it('turn_changed → clears available actions when not my turn', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'turn_changed',
      data: {
        current_player: 'Bot',
        current_player_id: 'p2',
        available_actions: ['call', 'raise', 'fold'],
      },
    })

    expect(useGameStore.getState().availableActions).toEqual([])
    expect(useUIStore.getState().activePlayerId).toBe('p2')
  })

  // ---- player_acted ----

  it('player_acted → adds action log and triggers chip animation', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'player_acted',
      data: {
        player_id: 'p2',
        player_name: 'Bot',
        action: 'call',
        amount: 20,
        compare_result: null,
      },
    })

    expect(useGameStore.getState().actionLog).toHaveLength(1)
    expect(useGameStore.getState().actionLog[0].action).toBe('call')
    expect(useUIStore.getState().chipAnimation).toEqual({
      fromPlayerId: 'p2',
      amount: 20,
    })
  })

  it('player_acted check_cards by me → sets hasLookedAtCards', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'player_acted',
      data: {
        player_id: 'p1',
        player_name: 'Me',
        action: 'check_cards',
        amount: 0,
        compare_result: null,
      },
    })

    expect(useUIStore.getState().hasLookedAtCards).toBe(true)
  })

  // ---- chat_message ----

  it('chat_message → adds to chatMessages', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'chat_message',
      data: {
        id: 'c1',
        player_id: 'p2',
        player_name: 'Bot',
        message_type: 'action_talk',
        content: 'I raise!',
        timestamp: 12345,
      },
    })

    expect(useGameStore.getState().chatMessages).toHaveLength(1)
    expect(useGameStore.getState().chatMessages[0].content).toBe('I raise!')
  })

  // ---- round_ended ----

  it('round_ended → adds result and triggers win animation', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    // Only a server snapshot may change the stacks
    useGameStore.setState({
      players: [
        { id: 'p1', name: 'Me', avatar: '', player_type: 'human', chips: 500, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: null },
        { id: 'p2', name: 'Bot', avatar: '', player_type: 'ai', chips: 500, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: 'm1' },
      ],
    })

    fire({
      type: 'round_ended',
      data: {
        round_number: 1,
        winner_id: 'p1',
        winner_name: 'Me',
        pot: 100,
        win_method: 'fold',
        hands_revealed: null,
        player_chip_changes: { p1: 50, p2: -50 },
      },
    })

    expect(useGameStore.getState().roundHistory).toHaveLength(1)
    expect(useUIStore.getState().winAnimation).toEqual({
      winnerId: 'p1',
      amount: 100,
      isPlaying: true,
    })
    // Round results describe net changes, not incremental payments
    expect(useGameStore.getState().players[0].chips).toBe(500)
    expect(useGameStore.getState().players[1].chips).toBe(500)
  })

  // ---- game_ended ----

  it('game_ended → sets status to finished', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    useGameStore.setState({
      players: [
        { id: 'p1', name: 'Me', avatar: '', player_type: 'human', chips: 900, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: null },
      ],
    })

    fire({
      type: 'game_ended',
      data: {
        final_standings: [{ id: 'p1', name: 'Me', chips: 2000 }],
      },
    })

    expect(useGameStore.getState().status).toBe('finished')
    expect(useGameStore.getState().players[0].chips).toBe(2000)
  })

  // ---- ai_thinking / ai_reviewing ----

  it('ai_thinking → sets thinking player', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'ai_thinking',
      data: { player_id: 'p2', player_name: 'Bot' },
    })

    expect(useUIStore.getState().thinkingPlayerId).toBe('p2')
    expect(useUIStore.getState().activePlayerId).toBe('p2')
  })

  it('ai_reviewing → sets reviewing player', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'ai_reviewing',
      data: { player_id: 'p2', player_name: 'Bot', trigger: 'periodic' },
    })

    expect(useUIStore.getState().reviewingPlayerId).toBe('p2')
  })

  // ---- error ----

  it('error → pushes error popup and chat message', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'error',
      data: { message: 'Something went wrong' },
    })

    expect(useUIStore.getState().errorPopups).toHaveLength(1)
    expect(useUIStore.getState().errorPopups[0].message).toBe('Something went wrong')
    expect(useGameStore.getState().chatMessages).toHaveLength(1)
    expect(useGameStore.getState().chatMessages[0].message_type).toBe('system_message')
  })

  // ---- copilot_error ----

  it('copilot_error → sets copilot error state', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))

    fire({
      type: 'copilot_error',
      data: { message: 'Subscription expired', error_code: '403' },
    })

    expect(useUIStore.getState().copilotError).toEqual({
      message: 'Subscription expired',
      errorCode: '403',
    })
  })
})


const liveState: GameState = {
  game_id: 'g1', status: 'playing', config: { initial_chips: 500, ante: 10, max_bet: 200, max_turns: 10 },
  players: [
    { id: 'p1', name: 'Me', avatar: '', player_type: 'human', chips: 490, status: 'active_blind', hand: null, total_bet_this_round: 10, model_id: null },
    { id: 'p2', name: 'Bot', avatar: '', player_type: 'ai', chips: 490, status: 'active_blind', hand: null, total_bet_this_round: 10, model_id: 'm1' },
  ], round_history: [], current_round: { round_number: 1, pot: 20, current_bet: 10, dealer_index: 1,
    current_player_index: 0, actions: [], phase: 'betting', turn_count: 1, max_turns: 10 },
}
function ready() {
  fire({ type: 'game_state', data: liveState })
  fire({ type: 'turn_changed', data: { current_player_id: 'p1', available_actions: ['check_cards', 'call', 'fold'] } })
}

describe('command admission', () => {
  beforeEach(() => {
    resetStores()
    socket.status = 'connected'
    socket.sendAction.mockReset().mockReturnValue(true)
    socket.sendStartRound.mockReset().mockReturnValue(true)
  })

  it('requires connection and a fresh snapshot before admitting legal actions', () => {
    const { result, rerender } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    useGameStore.setState({ gameState: liveState, availableActions: ['call'] })
    expect(result.current.sendAction('call')).toBe(false)
    ready()
    socket.status = 'disconnected'
    rerender()
    expect(result.current.sendAction('call')).toBe(false)
    expect(socket.sendAction).not.toHaveBeenCalled()
  })

  it('locks one admitted command until its own acknowledgement', () => {
    const { result } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    ready()
    act(() => expect(result.current.sendAction('call')).toBe(true))
    expect(useUIStore.getState().pendingCommand).toMatchObject({ kind: 'player_action', action: 'call', roundNumber: 1 })
    act(() => expect(result.current.sendAction('call')).toBe(false))
    fire({ type: 'player_acted', data: { player_id: 'p2', action: 'check_cards', amount: 0 } })
    expect(useUIStore.getState().pendingCommand).not.toBeNull()
    fire({ type: 'player_acted', data: { player_id: 'p1', action: 'call', amount: 10 } })
    expect(useUIStore.getState().pendingCommand).toBeNull()
    expect(socket.sendAction).toHaveBeenCalledTimes(1)
  })

  it('false send releases pending but never reveals peeked cards', () => {
    const { result } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    ready()
    socket.sendAction.mockReturnValue(false)
    act(() => expect(result.current.sendAction('check_cards')).toBe(false))
    expect(useUIStore.getState().pendingCommand).toBeNull()
    expect(useUIStore.getState().hasLookedAtCards).toBe(false)
    expect(useUIStore.getState().errorPopups.at(-1)?.message).toMatch(/连接/)
  })

  it('does not reveal cards on submitted or rejected peek', () => {
    const { result } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    ready()
    act(() => result.current.sendAction('check_cards'))
    expect(useUIStore.getState().hasLookedAtCards).toBe(false)
    fire({ type: 'error', data: { message: '暂不可看牌' } })
    expect(useUIStore.getState().pendingCommand).toBeNull()
    expect(useUIStore.getState().hasLookedAtCards).toBe(false)
  })

  it('rejects actions absent from server legal actions and invalid compare targets', () => {
    const { result } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    ready()
    expect(result.current.sendAction('raise')).toBe(false)
    useGameStore.setState({ availableActions: ['compare'] })
    expect(result.current.sendAction('compare', 'p1')).toBe(false)
    expect(result.current.sendAction('compare', 'unknown')).toBe(false)
    expect(socket.sendAction).not.toHaveBeenCalled()
  })

  it('does not start during betting and locks next hand until round_started', () => {
    const { result } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    ready()
    act(() => expect(result.current.sendStartRound()).toBe(false))
    fire({ type: 'game_state', data: { ...liveState, current_round: { ...liveState.current_round!, phase: 'settlement' } } })
    act(() => expect(result.current.sendStartRound()).toBe(true))
    act(() => expect(result.current.sendStartRound()).toBe(false))
    fire({ type: 'round_started', data: { round_number: 2, dealer_index: 0, pot: 20, current_bet: 10, max_turns: 10 } })
    expect(useUIStore.getState().pendingCommand).toBeNull()
    act(() => expect(result.current.sendStartRound()).toBe(false))
    expect(socket.sendStartRound).toHaveBeenCalledTimes(1)
  })

  it('restores settlement reveals but clears stale turn actions', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    ready()
    const cards = [{ suit: 'hearts', rank: 14 }]
    fire({ type: 'round_ended', data: { round_number: 1, winner_id: 'p2', pot: 20, hands_revealed: { p2: cards } } })
    fire({ type: 'game_state', data: { ...liveState, current_round: { ...liveState.current_round!, phase: 'settlement' } } })
    expect(useUIStore.getState().compareRevealedCards).toEqual({ p2: cards })
    expect(useGameStore.getState().availableActions).toEqual([])
    expect(useUIStore.getState().activePlayerId).toBeNull()
  })
})

describe('command recovery and effects', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
    socket.status = 'connected'
    socket.sendAction.mockReturnValue(true)
  })

  it('plays settlement once even when the preceding snapshot already contains the result', () => {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    const result = { round_number: 1, winner_id: 'p1', winner_name: 'Me', pot: 20, win_method: 'fold', hands_revealed: null, player_chip_changes: { p1: 10, p2: -10 } }
    fire({ type: 'game_state', data: { ...liveState, round_history: [result], current_round: { ...liveState.current_round!, phase: 'settlement' } } })
    fire({ type: 'round_ended', data: result })
    expect(useUIStore.getState().winAnimation?.isPlaying).toBe(true)
    act(() => useUIStore.getState().clearWinAnimation())
    fire({ type: 'round_ended', data: result })
    expect(useUIStore.getState().winAnimation).toBeNull()
  })

  it('times out to reconciliation without resending or changing chips or round', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
      ready()
      act(() => result.current.sendAction('call'))
      act(() => vi.advanceTimersByTime(15000))
      expect(socket.reconnect).toHaveBeenCalledOnce()
      expect(socket.sendAction).toHaveBeenCalledOnce()
      expect(useGameStore.getState().players.map(player => player.chips)).toEqual([490, 490])
      expect(useGameStore.getState().currentRound?.phase).toBe('betting')
      expect(useUIStore.getState().errorPopups.at(-1)?.message).toMatch(/等待服务器确认/)
      expect(result.current.sendAction('call')).toBe(false)
    } finally { vi.useRealTimers() }
  })
})

it('keeps a snapshot arriving in the same render batch as socket open', () => {
  resetStores()
  socket.status = 'connecting'
  const { rerender } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
  act(() => {
    socket.status = 'connected'
    capturedOnMessage?.({ type: 'game_state', data: liveState })
    rerender()
  })
  expect(useUIStore.getState().isGameSynchronized).toBe(true)
})


it('game_ended closes admission even before a follow-up snapshot', () => {
  resetStores()
  socket.status = 'connected'
  const { result } = renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
  fire({ type: 'game_state', data: { ...liveState, current_round: { ...liveState.current_round!, phase: 'settlement' } } })
  fire({ type: 'game_ended', data: { final_standings: [] } })
  act(() => expect(result.current.sendStartRound()).toBe(false))
})
