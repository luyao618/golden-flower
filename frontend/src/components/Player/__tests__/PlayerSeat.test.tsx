/**
 * PlayerSeat 组件单元测试
 *
 * 覆盖：
 * - AI 玩家渲染（名字、筹码、状态）
 * - 人类玩家渲染（手牌区域）
 * - 状态标签（暗注/明注/弃牌/出局）
 * - 庄家标识
 * - 下注金额显示
 * - AI 思考/回顾指示器
 * - 比牌模式点击交互
 * - 弃牌/出局时的视觉状态
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerSeat from '../PlayerSeat'
import { useUIStore } from '../../../stores/uiStore'
import type { Player, Card } from '../../../types/game'

// ---- Mock framer-motion ----
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const rest = Object.fromEntries(Object.entries(props).filter(([key]) =>
        !['layout', 'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap'].includes(key)))
      return <div {...rest}>{children as React.ReactNode}</div>
    },
  },
}))

// ---- Mock theme utils ----
vi.mock('../../../utils/theme', () => ({
  getCharacterImage: (index: number) => `/char-${index}.png`,
  getAvatarColor: () => 'from-blue-500 to-indigo-600',
  getAvatarText: (name: string) => name.charAt(0),
}))

// ---- Mock child components ----
vi.mock('../ChatBubble', () => ({
  default: ({ message }: { message: unknown }) =>
    message ? <div data-testid="chat-bubble">chat</div> : null,
}))

vi.mock('../../Cards/CardHand', () => ({
  default: ({ cards, faceUp, size }: { cards: Card[]; faceUp: boolean; size: string }) => (
    <div data-testid="card-hand" data-face-up={faceUp} data-size={size}>
      {cards.length} cards
    </div>
  ),
}))

// ---- Helpers ----

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: '测试AI',
    avatar: '',
    player_type: 'ai',
    chips: 1000,
    status: 'active_blind',
    hand: null,
    total_bet_this_round: 0,
    model_id: 'model-1',
    ...overrides,
  }
}

const defaultProps = {
  cardPosition: { x: 50, y: 20 },
  characterPosition: { x: 50, y: 15 },
  seatIndex: 0,
  isActive: false,
  isMe: false,
  isDealer: false,
}

beforeEach(() => {
  useUIStore.getState().resetUI()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PlayerSeat', () => {
  // ---- AI 玩家基本渲染 ----

  it('renders AI player name', () => {
    render(<PlayerSeat player={makePlayer({ name: 'DeepSeek' })} {...defaultProps} />)
    expect(screen.getByText('DeepSeek')).toBeTruthy()
  })

  it('renders AI player chips', () => {
    render(<PlayerSeat player={makePlayer({ chips: 5000 })} {...defaultProps} />)
    expect(screen.getByText('5,000')).toBeTruthy()
  })

  // ---- 状态标签 ----

  it('shows 暗注 for active_blind', () => {
    render(<PlayerSeat player={makePlayer({ status: 'active_blind' })} {...defaultProps} />)
    expect(screen.getByText('暗注')).toBeTruthy()
  })

  it('shows 明注 for active_seen', () => {
    render(<PlayerSeat player={makePlayer({ status: 'active_seen' })} {...defaultProps} />)
    expect(screen.getByText('明注')).toBeTruthy()
  })

  it('shows 弃牌 for folded', () => {
    render(<PlayerSeat player={makePlayer({ status: 'folded' })} {...defaultProps} />)
    expect(screen.getByText('弃牌')).toBeTruthy()
  })

  it('shows 出局 for out', () => {
    render(<PlayerSeat player={makePlayer({ status: 'out' })} {...defaultProps} />)
    expect(screen.getByText('出局')).toBeTruthy()
  })

  // ---- 下注金额 ----

  it('shows bet amount when > 0', () => {
    render(<PlayerSeat player={makePlayer({ total_bet_this_round: 50 })} {...defaultProps} />)
    expect(screen.getByText('下注 50')).toBeTruthy()
  })

  it('does not show bet when 0', () => {
    render(<PlayerSeat player={makePlayer({ total_bet_this_round: 0 })} {...defaultProps} />)
    expect(screen.queryByText(/下注/)).toBeNull()
  })

  // ---- 庄家标识 ----

  it('shows dealer badge when isDealer', () => {
    render(<PlayerSeat player={makePlayer()} {...defaultProps} isDealer={true} />)
    expect(screen.getByText('D')).toBeTruthy()
  })

  it('hides dealer badge when not dealer', () => {
    render(<PlayerSeat player={makePlayer()} {...defaultProps} isDealer={false} />)
    expect(screen.queryByText('D')).toBeNull()
  })

  // ---- AI 思考/回顾指示器 ----

  it('shows thinking dots when AI is thinking', () => {
    useUIStore.setState({ thinkingPlayerId: 'p1' })
    const { container } = render(<PlayerSeat player={makePlayer()} {...defaultProps} />)
    // ThinkingDots renders three animated dots
    const dots = container.querySelectorAll('.rounded-full.bg-\\[var\\(--color-primary\\)\\]')
    expect(dots.length).toBe(3)
  })

  it('shows reviewing indicator when AI is reviewing', () => {
    useUIStore.setState({ reviewingPlayerId: 'p1' })
    render(<PlayerSeat player={makePlayer()} {...defaultProps} />)
    expect(screen.getByText('回顾中')).toBeTruthy()
  })

  it('does not show indicators when different player is thinking', () => {
    useUIStore.setState({ thinkingPlayerId: 'other-player' })
    render(<PlayerSeat player={makePlayer()} {...defaultProps} />)
    expect(screen.queryByText('回顾中')).toBeNull()
  })

  // ---- 比牌模式 ----

  it('calls onClick when in compare mode and player is clickable', () => {
    useUIStore.setState({ isCompareMode: true })
    const onClick = vi.fn()
    render(
      <PlayerSeat
        player={makePlayer({ status: 'active_seen' })}
        {...defaultProps}
        isMe={false}
        onClick={onClick}
      />,
    )

    // Find the clickable container — it should have a click handler
    const nameEl = screen.getByText('测试AI')
    const clickableContainer = nameEl.closest('[class*="cursor-pointer"]')
    expect(clickableContainer).toBeTruthy()
    fireEvent.click(clickableContainer!)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not call onClick when not in compare mode', () => {
    useUIStore.setState({ isCompareMode: false })
    const onClick = vi.fn()
    render(
      <PlayerSeat
        player={makePlayer({ status: 'active_seen' })}
        {...defaultProps}
        isMe={false}
        onClick={onClick}
      />,
    )

    // Click should open thought drawer, not call onClick
    const nameEl = screen.getByText('测试AI')
    const container = nameEl.closest('div')
    fireEvent.click(container!)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not call onClick when player is folded (even in compare mode)', () => {
    useUIStore.setState({ isCompareMode: true })
    const onClick = vi.fn()
    render(
      <PlayerSeat
        player={makePlayer({ status: 'folded' })}
        {...defaultProps}
        isMe={false}
        onClick={onClick}
      />,
    )

    const nameEl = screen.getByText('测试AI')
    const container = nameEl.closest('div')
    fireEvent.click(container!)
    expect(onClick).not.toHaveBeenCalled()
  })

  // ---- 人类玩家 ----

  it('renders human player cards when showPlayerCards is true', () => {
    useUIStore.setState({ showPlayerCards: true })
    const myCards: Card[] = [
      { suit: 'hearts', rank: 14 },
      { suit: 'spades', rank: 13 },
      { suit: 'diamonds', rank: 12 },
    ]
    render(
      <PlayerSeat
        player={makePlayer({ id: 'h1', player_type: 'human', status: 'active_blind' })}
        cardPosition={{ x: 50, y: 80 }}
        seatIndex={0}
        isActive={false}
        isMe={true}
        isDealer={false}
        myCards={myCards}
      />,
    )

    expect(screen.getByTestId('card-hand')).toBeTruthy()
  })

  it('does not render character image for human player', () => {
    render(
      <PlayerSeat
        player={makePlayer({ player_type: 'human' })}
        cardPosition={{ x: 50, y: 80 }}
        seatIndex={0}
        isActive={false}
        isMe={true}
        isDealer={false}
      />,
    )

    // No img element for human player (no character image)
    const imgs = screen.queryAllByRole('img')
    expect(imgs.length).toBe(0)
  })

  // ---- AI 角色图片 ----

  it('renders character image for AI player', () => {
    render(<PlayerSeat player={makePlayer()} {...defaultProps} seatIndex={2} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('/char-2.png')
  })

  // ---- 聊天气泡 ----

  it('shows chat bubble when message is provided', () => {
    const msg = {
      id: 'msg1',
      game_id: 'g1',
      round_number: 1,
      player_id: 'p1',
      player_name: '测试AI',
      message_type: 'action_talk' as const,
      content: '我跟！',
      timestamp: Date.now(),
    }
    render(
      <PlayerSeat player={makePlayer()} {...defaultProps} latestMessage={msg} />,
    )
    expect(screen.getByTestId('chat-bubble')).toBeTruthy()
  })

  it('does not show chat bubble when no message', () => {
    render(<PlayerSeat player={makePlayer()} {...defaultProps} />)
    expect(screen.queryByTestId('chat-bubble')).toBeNull()
  })
})

it('shows server-revealed showdown cards even when settlement eliminated the player', () => {
  useUIStore.setState({ showPlayerCards: true, compareRevealedCards: { p1: [
    { suit: 'hearts', rank: 14 }, { suit: 'spades', rank: 13 }, { suit: 'clubs', rank: 12 },
  ] } })
  render(<PlayerSeat player={makePlayer({ status: 'out', chips: 0 })} {...defaultProps} />)
  expect(screen.getByTestId('card-hand')).toHaveAttribute('data-face-up', 'true')
  expect(screen.getByTestId('card-hand')).toHaveTextContent('3 cards')
})
