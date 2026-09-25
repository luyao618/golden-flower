/**
 * GameSetupModal 组件单元测试
 *
 * 覆盖：
 * - 弹窗打开/关闭
 * - 验证：无 AI 对手时提示错误
 * - 验证：无模型时弹出模型配置提示
 * - 空白玩家名自动填充
 * - 创建游戏成功后导航
 * - 创建游戏失败显示错误
 * - 按钮加载状态
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GameSetupModal from '../GameSetupModal'
import { useGameStore } from '../../../stores/gameStore'

// ---- Mock react-router-dom ----
const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

// ---- Mock framer-motion ----
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _wh, whileTap: _wt, ...rest } = props
      return <div {...rest}>{children as React.ReactNode}</div>
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ---- Mock child components ----
vi.mock('../GameConfigForm', () => ({
  default: () => <div data-testid="game-config-form">GameConfigForm</div>,
}))
vi.mock('../ChipsConfig', () => ({
  default: () => <div data-testid="chips-config">ChipsConfig</div>,
}))
vi.mock('../ModelConfigPanel', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="model-config-panel">
        <button data-testid="model-config-close" onClick={onClose}>关闭</button>
      </div>
    ) : null,
}))

// ---- Helpers ----

beforeEach(() => {
  useGameStore.getState().reset()
  mockNavigate.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GameSetupModal', () => {
  // ---- 打开/关闭 ----

  it('does not render content when closed', () => {
    render(<GameSetupModal open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('配置游戏')).toBeNull()
  })

  it('renders modal content when open', () => {
    render(<GameSetupModal open={true} onClose={vi.fn()} />)
    expect(screen.getByText('配置游戏')).toBeTruthy()
    expect(screen.getByTestId('game-config-form')).toBeTruthy()
    expect(screen.getByTestId('chips-config')).toBeTruthy()
    expect(screen.getByText('开始游戏')).toBeTruthy()
  })

  it('calls onClose when clicking 返回', () => {
    const onClose = vi.fn()
    render(<GameSetupModal open={true} onClose={onClose} />)
    fireEvent.click(screen.getByText('返回'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // ---- 验证 ----

  it('shows error when no AI opponents', async () => {
    useGameStore.setState({ aiOpponents: [] })
    render(<GameSetupModal open={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('开始游戏'))

    await waitFor(() => {
      expect(screen.getByText('至少需要一个 AI 对手')).toBeTruthy()
    })
  })

  it('shows model alert when no available models', async () => {
    useGameStore.setState({
      aiOpponents: [{ model_id: 'm1', name: 'AI' }],
      availableModels: [],
    })
    render(<GameSetupModal open={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('开始游戏'))

    await waitFor(() => {
      expect(screen.getByText('尚未配置 AI 模型')).toBeTruthy()
    })
  })

  it('opens model config panel when clicking 去配置 in alert', async () => {
    useGameStore.setState({
      aiOpponents: [{ model_id: 'm1', name: 'AI' }],
      availableModels: [],
    })
    render(<GameSetupModal open={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('开始游戏'))

    await waitFor(() => {
      expect(screen.getByText('去配置')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('去配置'))

    await waitFor(() => {
      expect(screen.getByTestId('model-config-panel')).toBeTruthy()
    })
  })

  // ---- 创建成功 ----

  it('navigates to game page on successful creation', async () => {
    useGameStore.setState({
      aiOpponents: [{ model_id: 'm1', name: 'AI' }],
      availableModels: [{ id: 'm1', model: 'model-1', display_name: 'Model 1', provider: 'test' }],
      playerName: '玩家',
    })

    // Mock createGame to succeed
    const originalCreateGame = useGameStore.getState().createGame
    useGameStore.setState({
      createGame: vi.fn().mockResolvedValue({ game_id: 'game-123' }) as unknown as typeof originalCreateGame,
    })

    render(<GameSetupModal open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('开始游戏'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/game/game-123')
    })
  })

  // ---- 创建失败 ----

  it('shows error on creation failure', async () => {
    useGameStore.setState({
      aiOpponents: [{ model_id: 'm1', name: 'AI' }],
      availableModels: [{ id: 'm1', model: 'model-1', display_name: 'Model 1', provider: 'test' }],
      playerName: '玩家',
    })

    const originalCreateGame = useGameStore.getState().createGame
    useGameStore.setState({
      createGame: vi.fn().mockRejectedValue(new Error('服务器错误')) as unknown as typeof originalCreateGame,
    })

    render(<GameSetupModal open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('开始游戏'))

    await waitFor(() => {
      expect(screen.getByText('服务器错误')).toBeTruthy()
    })
  })

  // ---- 空白玩家名 ----

  it('auto-fills player name when blank', async () => {
    useGameStore.setState({
      aiOpponents: [{ model_id: 'm1', name: 'AI' }],
      availableModels: [{ id: 'm1', model: 'model-1', display_name: 'Model 1', provider: 'test' }],
      playerName: '  ',
    })

    const originalCreateGame = useGameStore.getState().createGame
    useGameStore.setState({
      createGame: vi.fn().mockResolvedValue({ game_id: 'g1' }) as unknown as typeof originalCreateGame,
    })

    render(<GameSetupModal open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('开始游戏'))

    await waitFor(() => {
      expect(useGameStore.getState().playerName).toBe('人类一败涂地')
    })
  })

  // ---- 按钮状态 ----

  it('disables start button when creating', () => {
    useGameStore.setState({ status: 'creating' })
    render(<GameSetupModal open={true} onClose={vi.fn()} />)

    expect(screen.getByText('创建中...')).toBeTruthy()
    // The button wrapping "创建中..." should be disabled
    const buttons = screen.getAllByRole('button')
    const startBtn = buttons.find((b) => b.textContent?.includes('创建中'))
    expect(startBtn).toBeTruthy()
    expect(startBtn!.hasAttribute('disabled')).toBe(true)
  })
})
