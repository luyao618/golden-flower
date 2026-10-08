/**
 * useWebSocket hook 单元测试
 *
 * 覆盖：
 * - 初始状态（config=null → disconnected）
 * - 连接生命周期（connect / onopen / onclose）
 * - 消息解析与分发
 * - sendAction / sendChatMessage / sendStartRound
 * - disconnect（intentional close）
 * - 自动重连（指数退避）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWebSocket } from '../useWebSocket'

// ---- Mock WebSocket ----

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = 0 // CONNECTING
  url: string
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  sent: string[] = []
  closed = false

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.readyState = 3 // CLOSED
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1 // OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }

  simulateError() {
    this.onerror?.({})
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Get the latest MockWebSocket instance */
function lastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

function makeConfig(overrides: Partial<NonNullable<Parameters<typeof useWebSocket>[0]>> = {}) {
  return {
    gameId: 'g1',
    playerId: 'p1',
    onMessage: vi.fn(),
    ...overrides,
  }
}

describe('useWebSocket', () => {
  // ---- null config ----

  it('returns disconnected when config is null', () => {
    const { result } = renderHook(() => useWebSocket(null))
    expect(result.current.status).toBe('disconnected')
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  // ---- Connection lifecycle ----

  it('connects on mount and sets status to connected on open', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useWebSocket(config))

    expect(result.current.status).toBe('connecting')
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1)

    act(() => lastWs().simulateOpen())
    expect(result.current.status).toBe('connected')
  })

  it('calls onConnected callback', () => {
    const onConnected = vi.fn()
    const config = makeConfig({ onConnected })
    renderHook(() => useWebSocket(config))

    act(() => lastWs().simulateOpen())
    expect(onConnected).toHaveBeenCalledOnce()
  })

  describe('obsolete connections', () => {
    const callbacks = [
      { name: 'open', fire: (ws: MockWebSocket) => ws.simulateOpen() },
      { name: 'message', fire: (ws: MockWebSocket) => ws.simulateMessage({ type: 'game_state', data: { game_id: 'g1' } }) },
      { name: 'error', fire: (ws: MockWebSocket) => ws.simulateError() },
      { name: 'close', fire: (ws: MockWebSocket) => ws.simulateClose() },
    ]

    it.each(callbacks)('ignores stale $name callbacks after changing games', ({ fire }) => {
      const config = makeConfig({
        onConnected: vi.fn(),
        onDisconnected: vi.fn(),
        onError: vi.fn(),
      })
      const { result, rerender } = renderHook((currentConfig) => useWebSocket(currentConfig), {
        initialProps: config,
      })
      const oldWs = lastWs()
      rerender({ ...config, gameId: 'g2' })
      const currentWs = lastWs()

      act(() => fire(oldWs))
      act(() => vi.advanceTimersByTime(5000))

      expect(result.current.status).toBe('connecting')
      expect(lastWs()).toBe(currentWs)
      expect(currentWs.closed).toBe(false)
      expect(config.onMessage).not.toHaveBeenCalled()
      expect(config.onConnected).not.toHaveBeenCalled()
      expect(config.onDisconnected).not.toHaveBeenCalled()
      expect(config.onError).not.toHaveBeenCalled()
    })

    it.each(callbacks)('ignores late $name callbacks after unmount', ({ fire }) => {
      const config = makeConfig({
        onConnected: vi.fn(),
        onDisconnected: vi.fn(),
        onError: vi.fn(),
      })
      const { unmount } = renderHook(() => useWebSocket(config))
      const ws = lastWs()
      unmount()

      act(() => fire(ws))
      act(() => vi.advanceTimersByTime(5000))

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(config.onMessage).not.toHaveBeenCalled()
      expect(config.onConnected).not.toHaveBeenCalled()
      expect(config.onDisconnected).not.toHaveBeenCalled()
      expect(config.onError).not.toHaveBeenCalled()
    })

    it('disconnects when the configuration is removed', () => {
      const config = makeConfig()
      const { result, rerender } = renderHook((currentConfig) => useWebSocket(currentConfig), {
        initialProps: config as Parameters<typeof useWebSocket>[0],
      })
      act(() => lastWs().simulateOpen())
      const ws = lastWs()

      rerender(null)
      act(() => ws.simulateMessage({ type: 'game_state', data: { game_id: 'g1' } }))

      expect(result.current.status).toBe('disconnected')
      expect(ws.closed).toBe(true)
      expect(result.current.sendStartRound()).toBe(false)
      expect(config.onMessage).not.toHaveBeenCalled()
    })

    it('starts a new retry budget when changing games', () => {
      const config = makeConfig({ maxReconnectAttempts: 1 })
      const { result, rerender } = renderHook((currentConfig) => useWebSocket(currentConfig), {
        initialProps: config,
      })
      act(() => lastWs().simulateClose())
      act(() => vi.advanceTimersByTime(1000))
      act(() => lastWs().simulateClose())
      expect(result.current.status).toBe('disconnected')

      rerender({ ...config, gameId: 'g2' })
      act(() => lastWs().simulateClose())

      expect(result.current.status).toBe('reconnecting')
      act(() => vi.advanceTimersByTime(1000))
      expect(MockWebSocket.instances).toHaveLength(4)
      expect(lastWs().url).toContain('/ws/g2?')
    })
  })

  // ---- Message handling ----

  it('dispatches parsed messages to onMessage', () => {
    const onMessage = vi.fn()
    const config = makeConfig({ onMessage })
    renderHook(() => useWebSocket(config))

    act(() => lastWs().simulateOpen())
    act(() =>
      lastWs().simulateMessage({ type: 'game_state', data: { game_id: 'g1' } }),
    )

    expect(onMessage).toHaveBeenCalledWith({
      type: 'game_state',
      data: { game_id: 'g1' },
    })
  })

  // ---- Send methods ----

  describe('send methods', () => {
    const sendCases = [
      { name: 'sendAction', send: (socket: ReturnType<typeof useWebSocket>) => socket.sendAction('call') },
      { name: 'sendChatMessage', send: (socket: ReturnType<typeof useWebSocket>) => socket.sendChatMessage('hello') },
      { name: 'sendStartRound', send: (socket: ReturnType<typeof useWebSocket>) => socket.sendStartRound() },
    ]

    it.each(sendCases)('$name returns true after an open socket accepts the send', ({ send }) => {
      const { result } = renderHook(() => useWebSocket(makeConfig()))
      act(() => lastWs().simulateOpen())

      expect(send(result.current)).toBe(true)
      expect(lastWs().sent).toHaveLength(1)
    })

    it.each(sendCases)('$name returns false without a socket', ({ send }) => {
      const { result } = renderHook(() => useWebSocket(null))

      expect(send(result.current)).toBe(false)
    })

    it.each(sendCases)('$name returns false when the socket is closing', ({ send }) => {
      const { result } = renderHook(() => useWebSocket(makeConfig()))
      act(() => lastWs().simulateOpen())
      lastWs().readyState = MockWebSocket.CLOSING

      expect(send(result.current)).toBe(false)
      expect(lastWs().sent).toHaveLength(0)
    })

    it.each(sendCases)('$name returns false when send throws', ({ send }) => {
      const { result } = renderHook(() => useWebSocket(makeConfig()))
      act(() => lastWs().simulateOpen())
      vi.spyOn(lastWs(), 'send').mockImplementation(() => {
        throw new DOMException('The socket closed before send', 'InvalidStateError')
      })

      expect(send(result.current)).toBe(false)
      expect(lastWs().sent).toHaveLength(0)
    })

    it('sendAction sends player_action event', () => {
      const config = makeConfig()
      const { result } = renderHook(() => useWebSocket(config))
      act(() => lastWs().simulateOpen())

      act(() => { result.current.sendAction('call') })

      const sent = JSON.parse(lastWs().sent[0])
      expect(sent.type).toBe('player_action')
      expect(sent.data.action).toBe('call')
    })

    it('sendAction with target includes target', () => {
      const config = makeConfig()
      const { result } = renderHook(() => useWebSocket(config))
      act(() => lastWs().simulateOpen())

      act(() => { result.current.sendAction('compare', 'p2') })

      const sent = JSON.parse(lastWs().sent[0])
      expect(sent.data.target).toBe('p2')
    })

    it('sendChatMessage sends chat_message event', () => {
      const config = makeConfig()
      const { result } = renderHook(() => useWebSocket(config))
      act(() => lastWs().simulateOpen())

      act(() => { result.current.sendChatMessage('hello') })

      const sent = JSON.parse(lastWs().sent[0])
      expect(sent.type).toBe('chat_message')
      expect(sent.data.content).toBe('hello')
    })

    it('sendStartRound sends start_round event', () => {
      const config = makeConfig()
      const { result } = renderHook(() => useWebSocket(config))
      act(() => lastWs().simulateOpen())

      act(() => { result.current.sendStartRound() })

      const sent = JSON.parse(lastWs().sent[0])
      expect(sent.type).toBe('start_round')
    })

    it('does not send when not connected', () => {
      const config = makeConfig()
      const { result } = renderHook(() => useWebSocket(config))
      // Don't call simulateOpen — status is 'connecting'

      act(() => { result.current.sendAction('fold') })

      expect(lastWs().sent).toHaveLength(0)
    })
  })

  // ---- Disconnect ----

  it('disconnect sets status to disconnected', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useWebSocket(config))
    act(() => lastWs().simulateOpen())

    act(() => result.current.disconnect())

    expect(result.current.status).toBe('disconnected')
    expect(lastWs().closed).toBe(true)
  })

  // ---- Auto-reconnect ----

  it('reconnects on unexpected close with exponential backoff', () => {
    const config = makeConfig({ autoReconnect: true, maxReconnectAttempts: 3 })
    const { result } = renderHook(() => useWebSocket(config))
    const ws1 = lastWs()
    act(() => ws1.simulateOpen())

    // Unexpected close
    act(() => ws1.simulateClose(1006))
    expect(result.current.status).toBe('reconnecting')

    // Advance timer by 1000ms (first backoff)
    act(() => vi.advanceTimersByTime(1000))

    // A new WebSocket should have been created
    expect(MockWebSocket.instances.length).toBeGreaterThan(1)
  })

  it('does not reconnect after intentional disconnect', () => {
    const config = makeConfig({ autoReconnect: true })
    const { result } = renderHook(() => useWebSocket(config))
    act(() => lastWs().simulateOpen())

    const countBefore = MockWebSocket.instances.length

    act(() => result.current.disconnect())
    act(() => vi.advanceTimersByTime(5000))

    // No new WebSocket should be created
    expect(MockWebSocket.instances.length).toBe(countBefore)
    expect(result.current.status).toBe('disconnected')
  })

  it('stops reconnecting after max attempts', () => {
    const onError = vi.fn()
    const config = makeConfig({ autoReconnect: true, maxReconnectAttempts: 2, onError })
    const { result } = renderHook(() => useWebSocket(config))
    const ws1 = lastWs()
    act(() => ws1.simulateOpen())

    // Close #1
    act(() => ws1.simulateClose())
    act(() => vi.advanceTimersByTime(1000))
    const ws2 = lastWs()
    act(() => ws2.simulateClose())

    // Close #2 — should hit max
    act(() => vi.advanceTimersByTime(2000))
    const ws3 = lastWs()
    act(() => ws3.simulateClose())

    // Should be disconnected, not reconnecting
    expect(result.current.status).toBe('disconnected')
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('重连失败'))
  })

  it.each([4001, 4003, 4004])('blocks automatic and manual retry for terminal close %s', (code) => {
    const onDisconnected = vi.fn()
    const config = makeConfig({ onDisconnected })
    const { result, rerender } = renderHook(current => useWebSocket(current), { initialProps: config })
    act(() => lastWs().simulateClose(code))

    expect(result.current.status).toBe('terminal')
    expect(result.current.terminalCloseCode).toBe(code)
    expect(onDisconnected).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(60000))
    act(() => result.current.reconnect())
    act(() => result.current.disconnect())
    act(() => result.current.reconnect())
    rerender({ ...config })
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(result.current.status).toBe('terminal')
    expect(result.current.sendAction('call')).toBe(false)

    // A newly created game has its own identity and can connect normally.
    rerender({ ...config, gameId: 'new-game', playerId: 'new-player' })
    expect(MockWebSocket.instances).toHaveLength(2)
    expect(result.current.terminalCloseCode).toBeNull()
    act(() => lastWs().simulateOpen())
    expect(result.current.status).toBe('connected')
  })

  // ---- Reconnect method ----

  it('reconnect resets attempts and connects', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useWebSocket(config))
    act(() => lastWs().simulateOpen())
    act(() => result.current.disconnect())

    const countBefore = MockWebSocket.instances.length

    act(() => result.current.reconnect())

    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore)
  })

  it('explicit reconnect cancels a pending automatic retry', () => {
    const { result } = renderHook(() => useWebSocket(makeConfig()))
    act(() => lastWs().simulateClose())
    expect(result.current.status).toBe('reconnecting')

    act(() => result.current.reconnect())
    const currentWs = lastWs()
    act(() => vi.advanceTimersByTime(5000))

    expect(MockWebSocket.instances).toHaveLength(2)
    expect(lastWs()).toBe(currentWs)
    expect(currentWs.closed).toBe(false)
    expect(result.current.status).toBe('connecting')
  })
})
