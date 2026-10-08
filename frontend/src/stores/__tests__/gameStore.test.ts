/**
 * gameStore 单元测试
 *
 * 覆盖：
 * - 初始状态
 * - 纯工具函数 getShortModelName / getUniqueShortName
 * - AI 对手管理（增删改）
 * - fetchModels（含自动修正 & 错误弹窗）
 * - createGame（成功 & 失败）
 * - 牌桌运行时操作（setGameState / setMyCards / addChatMessage 等）
 * - 衍生状态（getMyPlayer / isMyTurn 等）
 * - reset
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getShortModelName,
  getUniqueShortName,
  useGameStore,
} from '../gameStore'
import { useUIStore } from '../uiStore'
import { useSessionStore } from '../sessionStore'

// ---- Mock API ----

vi.mock('../../services/api', () => ({
  createGame: vi.fn(),
  getAvailableModels: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = await import('../../services/api')
const mockCreateGame = api.createGame as ReturnType<typeof vi.fn>
const mockGetModels = api.getAvailableModels as ReturnType<typeof vi.fn>

// ---- Helpers ----

function resetStores() {
  useGameStore.getState().reset()
  useUIStore.getState().resetUI()
}

// ================================================================
// Pure utility functions
// ================================================================

describe('getShortModelName', () => {
  it('returns name as-is when short enough', () => {
    expect(getShortModelName('GPT-4')).toBe('GPT-4')
  })

  it('strips prefix before colon', () => {
    expect(getShortModelName('openai:gpt-4-turbo')).toBe('gpt-4-turbo')
  })

  it('removes parenthesized text', () => {
    expect(getShortModelName('Llama 3.1 (70B, instruct)')).toBe('Llama 3.1')
  })

  it('truncates to 32 chars', () => {
    const long = 'A'.repeat(50)
    expect(getShortModelName(long).length).toBeLessThanOrEqual(32)
  })

  it('falls back to truncated displayName when result is empty', () => {
    // "(all parens)" -> after removing parens, empty string -> fallback
    expect(getShortModelName('(all parens)')).toBe('(all parens)')
  })
})

describe('getUniqueShortName', () => {
  it('returns base name when no conflicts', () => {
    const ops = [{ model_id: 'a', name: '' }, { model_id: 'b', name: '' }]
    expect(getUniqueShortName('ModelX', 0, ops)).toBe('ModelX')
  })

  it('appends suffix when name conflicts', () => {
    const ops = [
      { model_id: 'a', name: 'ModelX' },
      { model_id: 'b', name: '' },
    ]
    // index=1 -> other names = {"ModelX"} -> conflict -> "ModelX-1"
    expect(getUniqueShortName('ModelX', 1, ops)).toBe('ModelX-1')
  })
})

// ================================================================
// Store tests
// ================================================================

describe('useGameStore', () => {
  beforeEach(() => {
    resetStores()
    vi.clearAllMocks()
  })

  // ---- Initial state ----

  describe('initial state', () => {
    it('starts with idle status and no game', () => {
      const s = useGameStore.getState()
      expect(s.status).toBe('idle')
      expect(s.gameId).toBeNull()
      expect(s.players).toEqual([])
      expect(s.myPlayerId).toBeNull()
    })

    it('has 3 default AI opponents', () => {
      expect(useGameStore.getState().aiOpponents).toHaveLength(3)
    })

    it('has default game config', () => {
      const cfg = useGameStore.getState().gameConfig
      expect(cfg.initial_chips).toBe(1000)
      expect(cfg.ante).toBe(10)
    })
  })

  // ---- Basic setters ----

  describe('basic setters', () => {
    it('setPlayerName', () => {
      useGameStore.getState().setPlayerName('Alice')
      expect(useGameStore.getState().playerName).toBe('Alice')
    })

    it('setGameConfig merges partially', () => {
      useGameStore.getState().setGameConfig({ ante: 50 })
      const cfg = useGameStore.getState().gameConfig
      expect(cfg.ante).toBe(50)
      expect(cfg.initial_chips).toBe(1000) // unchanged
    })
  })

  // ---- AI opponent management ----

  describe('AI opponent management', () => {
    it('addAIOpponent up to 4', () => {
      useGameStore.getState().addAIOpponent()
      expect(useGameStore.getState().aiOpponents).toHaveLength(4)
    })

    it('addAIOpponent caps at 4', () => {
      useGameStore.getState().addAIOpponent() // 4
      useGameStore.getState().addAIOpponent() // still 4
      expect(useGameStore.getState().aiOpponents).toHaveLength(4)
    })

    it('removeAIOpponent removes by index', () => {
      useGameStore.getState().removeAIOpponent(0)
      expect(useGameStore.getState().aiOpponents).toHaveLength(2)
    })

    it('removeAIOpponent keeps at least 1', () => {
      useGameStore.getState().removeAIOpponent(0)
      useGameStore.getState().removeAIOpponent(0)
      // down to 1
      useGameStore.getState().removeAIOpponent(0)
      expect(useGameStore.getState().aiOpponents).toHaveLength(1)
    })

    it('updateAIOpponent updates the correct index', () => {
      useGameStore.getState().updateAIOpponent(1, { name: 'Bot2' })
      expect(useGameStore.getState().aiOpponents[1].name).toBe('Bot2')
    })
  })

  // ---- fetchModels ----

  describe('fetchModels', () => {
    it('populates availableModels on success', async () => {
      const models = [
        { id: 'm1', model: 'model-1', display_name: 'Model One', provider: 'openrouter' },
      ]
      mockGetModels.mockResolvedValue(models)
      await useGameStore.getState().fetchModels()
      expect(useGameStore.getState().availableModels).toEqual(models)
      expect(useGameStore.getState().modelsLoading).toBe(false)
    })

    it('auto-corrects AI opponents with invalid model_id', async () => {
      const models = [
        { id: 'valid-1', model: 'v1', display_name: 'Valid One', provider: 'p' },
      ]
      mockGetModels.mockResolvedValue(models)
      // Pre-set opponents with bad model_id
      useGameStore.setState({
        aiOpponents: [{ model_id: 'bad-id', name: '' }],
      })
      await useGameStore.getState().fetchModels()
      expect(useGameStore.getState().aiOpponents[0].model_id).toBe('valid-1')
    })

    it('pushes error popup on failure', async () => {
      mockGetModels.mockRejectedValue(new Error('network fail'))
      await useGameStore.getState().fetchModels()
      expect(useUIStore.getState().errorPopups).toHaveLength(1)
      expect(useUIStore.getState().errorPopups[0].message).toBe('network fail')
    })
  })

  // ---- createGame ----

  describe('createGame', () => {
    it('sets gameId and status on success', async () => {
      mockCreateGame.mockResolvedValue({
        game_id: 'g1',
        message: 'ok',
        players: [
          { id: 'p1', name: 'Me', player_type: 'human', chips: 1000, model_id: null, avatar: '' },
          { id: 'p2', name: 'Bot', player_type: 'ai', chips: 1000, model_id: 'm1', avatar: '' },
        ],
      })
      useGameStore.setState({ playerName: 'Me' })

      const resp = await useGameStore.getState().createGame()
      expect(resp.game_id).toBe('g1')
      expect(useGameStore.getState().gameId).toBe('g1')
      expect(useGameStore.getState().myPlayerId).toBe('p1')
      expect(useGameStore.getState().status).toBe('waiting')
    })

    it('reverts to idle on failure', async () => {
      mockCreateGame.mockRejectedValue(new Error('boom'))
      useGameStore.setState({ playerName: 'Me' })

      await expect(useGameStore.getState().createGame()).rejects.toThrow('boom')
      expect(useGameStore.getState().status).toBe('idle')
      expect(useGameStore.getState().error).toBe('boom')
    })
  })

  // ---- Runtime operations ----

  describe('runtime operations', () => {
    it('setGameState populates multiple fields', () => {
      const gs = {
        game_id: 'g1',
        players: [
          { id: 'p1', name: 'Me', avatar: '', player_type: 'human' as const, chips: 900, status: 'active_blind' as const, hand: null, total_bet_this_round: 0, model_id: null },
        ],
        current_round: null,
        round_history: [],
        config: { initial_chips: 1000, ante: 10, max_bet: 200, max_turns: 10 },
        status: 'playing' as const,
      }
      useGameStore.getState().setGameState(gs)
      const s = useGameStore.getState()
      expect(s.gameId).toBe('g1')
      expect(s.players).toHaveLength(1)
      expect(s.status).toBe('playing')
    })

    it('setMyCards / setAvailableActions', () => {
      const cards = [{ suit: 'hearts' as const, rank: 14 as const }]
      useGameStore.getState().setMyCards(cards)
      expect(useGameStore.getState().myCards).toEqual(cards)

      useGameStore.getState().setAvailableActions(['fold', 'call'])
      expect(useGameStore.getState().availableActions).toEqual(['fold', 'call'])
    })

    it('addChatMessage appends', () => {
      const msg = {
        id: 'c1',
        game_id: 'g1',
        round_number: 1,
        player_id: 'p1',
        player_name: 'Bot',
        message_type: 'action_talk' as const,
        content: 'hi',
        timestamp: 1,
      }
      useGameStore.getState().addChatMessage(msg)
      useGameStore.getState().addChatMessage({ ...msg, id: 'c2' })
      expect(useGameStore.getState().chatMessages).toHaveLength(2)
    })

    it('clearChatMessages empties', () => {
      useGameStore.getState().addChatMessage({
        id: 'c1', game_id: 'g1', round_number: 1, player_id: 'p1',
        player_name: 'X', message_type: 'action_talk', content: '', timestamp: 0,
      })
      useGameStore.getState().clearChatMessages()
      expect(useGameStore.getState().chatMessages).toEqual([])
    })

    it('addActionLog appends with timestamp', () => {
      useGameStore.getState().addActionLog({
        player_id: 'p1',
        player_name: 'Bot',
        action: 'call',
        amount: 10,
        compare_result: null,
      })
      const log = useGameStore.getState().actionLog
      expect(log).toHaveLength(1)
      expect(log[0].timestamp).toBeGreaterThan(0)
    })

    it('updatePlayer updates matching player', () => {
      useGameStore.setState({
        players: [
          { id: 'p1', name: 'A', avatar: '', player_type: 'human', chips: 100, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: null },
          { id: 'p2', name: 'B', avatar: '', player_type: 'ai', chips: 200, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: 'm1' },
        ],
      })
      useGameStore.getState().updatePlayer('p2', { chips: 300 })
      expect(useGameStore.getState().players[1].chips).toBe(300)
      expect(useGameStore.getState().players[0].chips).toBe(100) // untouched
    })

    it('addRoundResult appends to roundHistory', () => {
      const result = {
        round_number: 1,
        winner_id: 'p1',
        winner_name: 'A',
        pot: 100,
        win_method: 'fold',
        hands_revealed: null,
        player_chip_changes: { p1: 100 },
      }
      useGameStore.getState().addRoundResult(result)
      expect(useGameStore.getState().roundHistory).toHaveLength(1)
    })
  })

  // ---- Derived state ----

  describe('derived state', () => {
    beforeEach(() => {
      useGameStore.setState({
        myPlayerId: 'p1',
        players: [
          { id: 'p1', name: 'Me', avatar: '', player_type: 'human', chips: 100, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: null },
          { id: 'p2', name: 'Bot', avatar: '', player_type: 'ai', chips: 200, status: 'active_blind', hand: null, total_bet_this_round: 0, model_id: 'm1' },
        ],
      })
    })

    it('getMyPlayer returns human player', () => {
      expect(useGameStore.getState().getMyPlayer()?.id).toBe('p1')
    })

    it('getPlayerById', () => {
      expect(useGameStore.getState().getPlayerById('p2')?.name).toBe('Bot')
      expect(useGameStore.getState().getPlayerById('nope')).toBeUndefined()
    })

    it('isMyTurn returns true when current player matches', () => {
      useGameStore.setState({
        currentRound: {
          round_number: 1, pot: 0, current_bet: 10, dealer_index: 0,
          current_player_index: 0, actions: [], phase: 'betting', turn_count: 0, max_turns: 10,
        },
      })
      expect(useGameStore.getState().isMyTurn()).toBe(true)
    })

    it('isMyTurn returns false when not my turn', () => {
      useGameStore.setState({
        currentRound: {
          round_number: 1, pot: 0, current_bet: 10, dealer_index: 0,
          current_player_index: 1, actions: [], phase: 'betting', turn_count: 0, max_turns: 10,
        },
      })
      expect(useGameStore.getState().isMyTurn()).toBe(false)
    })

    it('getCurrentPlayer returns player at current_player_index', () => {
      useGameStore.setState({
        currentRound: {
          round_number: 1, pot: 0, current_bet: 10, dealer_index: 0,
          current_player_index: 1, actions: [], phase: 'betting', turn_count: 0, max_turns: 10,
        },
      })
      expect(useGameStore.getState().getCurrentPlayer()?.id).toBe('p2')
    })
  })

  // ---- Reset ----

  describe('reset', () => {
    it('restores to initial state', () => {
      useGameStore.setState({
        gameId: 'g1',
        status: 'playing',
        playerName: 'Alice',
        myPlayerId: 'p1',
      })
      useGameStore.getState().reset()
      const s = useGameStore.getState()
      expect(s.gameId).toBeNull()
      expect(s.status).toBe('idle')
      expect(s.playerName).toBe('')
      expect(s.myPlayerId).toBeNull()
      expect(s.aiOpponents).toHaveLength(3)
    })
  })
})


describe('created session identity', () => {
  beforeEach(() => {
    resetStores()
    useSessionStore.setState({ sessions: {} })
  })

  it('remembers the returned human identity only after a successful create', async () => {
    mockCreateGame.mockResolvedValue({ game_id: 'server-game', players: [
      { id: 'server-human', player_type: 'human' },
    ] })
    await useGameStore.getState().createGame()
    expect(useSessionStore.getState().sessions['server-game']).toEqual({ playerId: 'server-human' })
  })

  it('rejects responses without a human instead of making them navigable', async () => {
    mockCreateGame.mockResolvedValue({ game_id: 'bad-game', players: [] })
    await expect(useGameStore.getState().createGame()).rejects.toThrow('人类玩家')
    expect(useSessionStore.getState().sessions).toEqual({})
    expect(useGameStore.getState().gameId).toBeNull()
    expect(useGameStore.getState().status).toBe('idle')
  })
})

it('preserves a waiting snapshot instead of claiming play has started', () => {
  useGameStore.getState().setGameState({ game_id: 'waiting-game', status: 'waiting', players: [], current_round: null,
    round_history: [], config: { initial_chips: 500, ante: 10, max_bet: 200, max_turns: 10 } })
  expect(useGameStore.getState().status).toBe('waiting')
})
