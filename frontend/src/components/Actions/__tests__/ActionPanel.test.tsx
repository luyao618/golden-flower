/**
 * ActionPanel 组件单元测试
 *
 * 覆盖：
 * - 无玩家/无局面时显示等待提示
 * - 按钮渲染（暗注 vs 明注布局）
 * - 费用计算（跟注、加注、比牌）
 * - 操作回调（点击触发 onAction）
 * - 弃牌确认流程（二次确认）
 * - 比牌模式（进入/退出/选择对手）
 * - 非轮次时按钮禁用
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ActionPanel from '../ActionPanel'
import { useGameStore } from '../../../stores/gameStore'
import { useUIStore } from '../../../stores/uiStore'
import type { Player, RoundState, GameAction } from '../../../types/game'

// ---- Mock framer-motion ----
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { layout: _l, initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _wh, whileTap: _wt, ...rest } = props
      return <div {...rest}>{children as React.ReactNode}</div>
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ---- Mock CompareSelector ----
vi.mock('../CompareSelector', () => ({
  default: ({ targets, cost, onSelect, onCancel }: {
    targets: Player[]
    cost: number
    onSelect: (id: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="compare-selector">
      <span data-testid="compare-cost">{cost}</span>
      {targets.map((t) => (
        <button key={t.id} data-testid={`compare-target-${t.id}`} onClick={() => onSelect(t.id)}>
          {t.name}
        </button>
      ))}
      <button data-testid="compare-cancel" onClick={onCancel}>取消</button>
    </div>
  ),
}))

// ---- Helpers ----

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'human-1',
    name: '测试玩家',
    avatar: '',
    player_type: 'human',
    chips: 1000,
    status: 'active_blind',
    hand: null,
    total_bet_this_round: 0,
    model_id: null,
    ...overrides,
  }
}

function makeRound(overrides: Partial<RoundState> = {}): RoundState {
  return {
    round_number: 1,
    pot: 100,
    current_bet: 10,
    dealer_index: 0,
    current_player_index: 0,
    actions: [],
    phase: 'betting',
    turn_count: 1,
    max_turns: 20,
    ...overrides,
  }
}

function setupStore(opts: {
  myPlayer?: Player | null
  round?: RoundState | null
  availableActions?: GameAction[]
  players?: Player[]
  myPlayerId?: string
} = {}) {
  const myPlayer = opts.myPlayer ?? makePlayer()
  const players = opts.players ?? [myPlayer]
  const myPlayerId = opts.myPlayerId ?? myPlayer.id

  useGameStore.setState({
    players,
    currentRound: opts.round ?? makeRound(),
    availableActions: opts.availableActions ?? [],
    myPlayerId,
  })

  // Override getMyPlayer to return our test player
  const store = useGameStore.getState()
  store.getMyPlayer = () => opts.myPlayer === null ? undefined : myPlayer
}

beforeEach(() => {
  useGameStore.getState().reset()
  useUIStore.getState().resetUI()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ActionPanel', () => {
  // ---- 等待状态 ----

  it('shows waiting message when no player', () => {
    setupStore({ myPlayer: null })
    render(<ActionPanel onAction={vi.fn()} />)
    expect(screen.getByText('等待对手行动...')).toBeTruthy()
  })

  it('shows waiting message when no round', () => {
    setupStore({ round: null })
    // getMyPlayer depends on currentRound too
    useGameStore.getState().getMyPlayer = () => makePlayer()
    // But the component checks !currentRound
    render(<ActionPanel onAction={vi.fn()} />)
    expect(screen.getByText('等待对手行动...')).toBeTruthy()
  })

  // ---- 按钮渲染 — 暗注 ----

  it('renders blind player buttons when not my turn (check_cards, call, raise, fold)', () => {
    setupStore({ myPlayer: makePlayer({ status: 'active_blind' }), availableActions: [] })
    render(<ActionPanel onAction={vi.fn()} />)

    expect(screen.getByText('看牌')).toBeTruthy()
    expect(screen.getByText('跟注')).toBeTruthy()
    expect(screen.getByText('加注')).toBeTruthy()
    expect(screen.getByText('弃牌')).toBeTruthy()
    // No compare button for blind player
    expect(screen.queryByText('比牌')).toBeNull()
  })

  // ---- 按钮渲染 — 明注 ----

  it('renders seen player buttons when not my turn (call, raise, compare, fold)', () => {
    setupStore({ myPlayer: makePlayer({ status: 'active_seen' }), availableActions: [] })
    render(<ActionPanel onAction={vi.fn()} />)

    expect(screen.getByText('跟注')).toBeTruthy()
    expect(screen.getByText('加注')).toBeTruthy()
    expect(screen.getByText('比牌')).toBeTruthy()
    expect(screen.getByText('弃牌')).toBeTruthy()
    // No check_cards button for seen player
    expect(screen.queryByText('看牌')).toBeNull()
  })

  // ---- 费用显示 ----

  it('displays correct call cost for blind player (current_bet)', () => {
    const round = makeRound({ current_bet: 20 })
    setupStore({
      myPlayer: makePlayer({ status: 'active_blind' }),
      round,
      availableActions: ['call'],
    })
    render(<ActionPanel onAction={vi.fn()} />)
    expect(screen.getByText('20')).toBeTruthy()
  })

  it('displays correct call cost for seen player (current_bet * 2)', () => {
    const round = makeRound({ current_bet: 20 })
    setupStore({
      myPlayer: makePlayer({ status: 'active_seen' }),
      round,
      availableActions: ['call'],
    })
    render(<ActionPanel onAction={vi.fn()} />)
    expect(screen.getByText('40')).toBeTruthy()
  })

  it('displays correct raise cost for blind player (current_bet * 2)', () => {
    const round = makeRound({ current_bet: 15 })
    setupStore({
      myPlayer: makePlayer({ status: 'active_blind' }),
      round,
      availableActions: ['raise'],
    })
    render(<ActionPanel onAction={vi.fn()} />)
    expect(screen.getByText('30')).toBeTruthy()
  })

  it('displays correct raise cost for seen player (current_bet * 4)', () => {
    const round = makeRound({ current_bet: 15 })
    setupStore({
      myPlayer: makePlayer({ status: 'active_seen' }),
      round,
      availableActions: ['raise'],
    })
    render(<ActionPanel onAction={vi.fn()} />)
    expect(screen.getByText('60')).toBeTruthy()
  })

  // ---- 底池和筹码显示 ----

  it('shows pot and chip counts', () => {
    setupStore({
      myPlayer: makePlayer({ chips: 2500 }),
      round: makeRound({ pot: 350 }),
    })
    render(<ActionPanel onAction={vi.fn()} />)
    expect(screen.getByText('350')).toBeTruthy()
    expect(screen.getByText('2,500')).toBeTruthy()
  })

  it('shows blind/seen status label', () => {
    setupStore({ myPlayer: makePlayer({ status: 'active_blind' }) })
    render(<ActionPanel onAction={vi.fn()} />)
    // "暗注" is inside a span with sibling text nodes, so use substring matching
    expect(screen.getByText(/暗注/)).toBeTruthy()
  })

  // ---- 操作回调 ----

  it('calls onAction when clicking an action button', () => {
    const onAction = vi.fn()
    setupStore({ availableActions: ['call'] })
    render(<ActionPanel onAction={onAction} />)

    fireEvent.click(screen.getByText('跟注'))
    expect(onAction).toHaveBeenCalledWith('call', undefined)
  })

  it('calls onAction for check_cards', () => {
    const onAction = vi.fn()
    setupStore({ availableActions: ['check_cards'] })
    render(<ActionPanel onAction={onAction} />)

    fireEvent.click(screen.getByText('看牌'))
    expect(onAction).toHaveBeenCalledWith('check_cards', undefined)
  })

  it('calls onAction for raise', () => {
    const onAction = vi.fn()
    setupStore({ availableActions: ['raise'] })
    render(<ActionPanel onAction={onAction} />)

    fireEvent.click(screen.getByText('加注'))
    expect(onAction).toHaveBeenCalledWith('raise', undefined)
  })

  // ---- 弃牌确认 ----

  it('fold requires confirmation (two clicks)', () => {
    const onAction = vi.fn()
    setupStore({ availableActions: ['fold'] })
    render(<ActionPanel onAction={onAction} />)

    // First click shows confirmation
    fireEvent.click(screen.getByText('弃牌'))
    expect(onAction).not.toHaveBeenCalled()

    // Confirm button appears
    expect(screen.getByText('确认弃牌')).toBeTruthy()

    // Second click executes
    fireEvent.click(screen.getByText('确认弃牌'))
    expect(onAction).toHaveBeenCalledWith('fold', undefined)
  })

  it('fold confirmation can be cancelled', () => {
    const onAction = vi.fn()
    setupStore({ availableActions: ['fold'] })
    render(<ActionPanel onAction={onAction} />)

    fireEvent.click(screen.getByText('弃牌'))
    expect(screen.getByText('确认弃牌')).toBeTruthy()

    fireEvent.click(screen.getByText('取消'))
    expect(onAction).not.toHaveBeenCalled()
    // After cancel, the fold button should be back
    expect(screen.getByText('弃牌')).toBeTruthy()
  })

  // ---- 比牌模式 ----

  it('clicking compare enters compare mode and shows selector', () => {
    const ai1 = makePlayer({ id: 'ai-1', name: 'AI一号', player_type: 'ai', status: 'active_seen' })
    const ai2 = makePlayer({ id: 'ai-2', name: 'AI二号', player_type: 'ai', status: 'active_seen' })
    const human = makePlayer({ status: 'active_seen' })

    setupStore({
      myPlayer: human,
      players: [human, ai1, ai2],
      availableActions: ['compare'],
    })
    render(<ActionPanel onAction={vi.fn()} />)

    fireEvent.click(screen.getByText('比牌'))

    // CompareSelector should render
    expect(screen.getByTestId('compare-selector')).toBeTruthy()
    expect(screen.getByTestId('compare-target-ai-1')).toBeTruthy()
    expect(screen.getByTestId('compare-target-ai-2')).toBeTruthy()
  })

  it('selecting a compare target calls onAction with target', () => {
    const onAction = vi.fn()
    const ai1 = makePlayer({ id: 'ai-1', name: 'AI一号', player_type: 'ai', status: 'active_seen' })
    const human = makePlayer({ status: 'active_seen' })

    setupStore({
      myPlayer: human,
      players: [human, ai1],
      availableActions: ['compare'],
    })
    render(<ActionPanel onAction={onAction} />)

    // Enter compare mode
    fireEvent.click(screen.getByText('比牌'))
    // Select target
    fireEvent.click(screen.getByTestId('compare-target-ai-1'))
    expect(onAction).toHaveBeenCalledWith('compare', 'ai-1')
  })

  it('compare selector excludes folded/out players', () => {
    const ai1 = makePlayer({ id: 'ai-1', name: 'AI一号', player_type: 'ai', status: 'active_seen' })
    const ai2 = makePlayer({ id: 'ai-2', name: 'AI二号弃牌', player_type: 'ai', status: 'folded' })
    const ai3 = makePlayer({ id: 'ai-3', name: 'AI三号出局', player_type: 'ai', status: 'out' })
    const human = makePlayer({ status: 'active_seen' })

    setupStore({
      myPlayer: human,
      players: [human, ai1, ai2, ai3],
      availableActions: ['compare'],
    })
    render(<ActionPanel onAction={vi.fn()} />)

    fireEvent.click(screen.getByText('比牌'))

    expect(screen.getByTestId('compare-target-ai-1')).toBeTruthy()
    expect(screen.queryByTestId('compare-target-ai-2')).toBeNull()
    expect(screen.queryByTestId('compare-target-ai-3')).toBeNull()
  })

  it('compare selector shows cost for seen player', () => {
    const ai1 = makePlayer({ id: 'ai-1', name: 'AI', player_type: 'ai', status: 'active_seen' })
    const human = makePlayer({ status: 'active_seen' })
    const round = makeRound({ current_bet: 25 })

    setupStore({
      myPlayer: human,
      players: [human, ai1],
      round,
      availableActions: ['compare'],
    })
    render(<ActionPanel onAction={vi.fn()} />)

    fireEvent.click(screen.getByText('比牌'))

    // Compare cost for seen player = call cost = current_bet * 2 = 50
    expect(screen.getByTestId('compare-cost').textContent).toBe('50')
  })

  // ---- 非轮次时按钮禁用 ----

  it('shows waiting indicator when not my turn', () => {
    setupStore({ availableActions: [] })
    render(<ActionPanel onAction={vi.fn()} />)

    const waitTexts = screen.getAllByText('等待对手行动...')
    expect(waitTexts.length).toBeGreaterThanOrEqual(1)
  })

  it('buttons are disabled when not my turn', () => {
    setupStore({ availableActions: [] })
    render(<ActionPanel onAction={vi.fn()} />)

    const buttons = screen.getAllByRole('button')
    for (const btn of buttons) {
      expect(btn).toBeDisabled()
    }
  })

  // ---- 多个操作按钮同时渲染 ----

  it('renders all available actions for a seen player turn', () => {
    setupStore({
      myPlayer: makePlayer({ status: 'active_seen' }),
      availableActions: ['call', 'raise', 'compare', 'fold'],
    })
    render(<ActionPanel onAction={vi.fn()} />)

    expect(screen.getByText('跟注')).toBeTruthy()
    expect(screen.getByText('加注')).toBeTruthy()
    expect(screen.getByText('比牌')).toBeTruthy()
    expect(screen.getByText('弃牌')).toBeTruthy()
  })

  it('renders all available actions for a blind player turn', () => {
    setupStore({
      myPlayer: makePlayer({ status: 'active_blind' }),
      availableActions: ['check_cards', 'call', 'raise', 'fold'],
    })
    render(<ActionPanel onAction={vi.fn()} />)

    expect(screen.getByText('看牌')).toBeTruthy()
    expect(screen.getByText('跟注')).toBeTruthy()
    expect(screen.getByText('加注')).toBeTruthy()
    expect(screen.getByText('弃牌')).toBeTruthy()
  })
})
