import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, ChevronUp, ArrowLeft, BookOpen, LogOut, Trophy } from 'lucide-react'
import TableLayout from '../components/Table/TableLayout'
import { ActionPanel } from '../components/Actions'
import ChatPanel from '../components/Table/ChatPanel'
import ChatInput from '../components/Table/ChatInput'
import { ThoughtDrawer } from '../components/Thought'
import CopilotErrorModal from '../components/CopilotErrorModal'
import { useGameStore } from '../stores/gameStore'
import { useUIStore } from '../stores/uiStore'
import { useGame } from '../hooks/useGame'
import { useGameSession } from '../hooks/useGameSession'
import { canStartHand } from '../utils/gameView'
import type { ConnectionStatus } from '../hooks/useWebSocket'
import gameBg from '../assets/game-bg.jpg'
import { CHARACTER_IMAGES } from '../utils/theme'

/**
 * 连接状态指示器
 */
function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const colorMap: Record<ConnectionStatus, string> = {
    connected: 'bg-[var(--color-success)]',
    connecting: 'bg-[var(--color-warning)] animate-pulse',
    reconnecting: 'bg-[var(--color-warning)] animate-pulse',
    disconnected: 'bg-[var(--color-danger)]',
  }
  const labelMap: Record<ConnectionStatus, string> = {
    connected: '已连接',
    connecting: '连接中...',
    reconnecting: '重连中...',
    disconnected: '已断开',
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <span className={`inline-block w-2 h-2 rounded-full ${colorMap[status]}`} />
      <span>{labelMap[status]}</span>
    </div>
  )
}

/**
 * 底部状态条 — 全宽条带，显示当前行动玩家 / AI 思考 / AI 回顾经验
 */
function StatusBar() {
  const thinkingPlayerId = useUIStore((s) => s.thinkingPlayerId)
  const reviewingPlayerId = useUIStore((s) => s.reviewingPlayerId)
  const activePlayerId = useUIStore((s) => s.activePlayerId)
  const players = useGameStore((s) => s.players)
  const currentRound = useGameStore((s) => s.currentRound)

  const thinkingPlayer = thinkingPlayerId
    ? players.find((p) => p.id === thinkingPlayerId)
    : null
  const reviewingPlayer = reviewingPlayerId
    ? players.find((p) => p.id === reviewingPlayerId)
    : null
  const activePlayer = activePlayerId
    ? players.find((p) => p.id === activePlayerId)
    : null

  const hasAnyStatus = currentRound && (activePlayer || thinkingPlayer || reviewingPlayer)

  return (
    <div className="w-full h-10 bg-black/60 backdrop-blur-sm border-t border-white/[0.06] flex items-center justify-center gap-6 px-4">
      <AnimatePresence mode="popLayout">
        {!hasAnyStatus && (
          <motion.span
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-[var(--text-disabled)] text-xs"
          >
            {currentRound ? '等待中...' : '准备开始'}
          </motion.span>
        )}

        {/* 当前行动玩家（仅当没有思考状态时显示） */}
        {activePlayer && !thinkingPlayer && (
          <motion.div
            key="active"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
            <span className="text-amber-400/90 text-sm">
              轮到 <span className="font-semibold text-amber-400">{activePlayer.name}</span> 行动
            </span>
          </motion.div>
        )}

        {/* AI 正在思考 */}
        {thinkingPlayer && (
          <motion.div
            key="thinking"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-400" />
            </span>
            <span className="text-blue-400/90 text-sm">
              <span className="font-semibold text-blue-400">{thinkingPlayer.name}</span> 正在思考...
            </span>
          </motion.div>
        )}

        {/* AI 正在回顾经验 */}
        {reviewingPlayer && (
          <motion.div
            key="reviewing"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-400" />
            </span>
            <span className="text-purple-400/90 text-sm">
              <span className="font-semibold text-purple-400">{reviewingPlayer.name}</span> 正在回顾经验...
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function GamePage() {
  // 预加载角色立绘图片
  useEffect(() => {
    CHARACTER_IMAGES.forEach((src) => {
      const img = new Image()
      img.src = src
    })
  }, [])

  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const gameState = useGameStore((s) => s.gameState)
  const status = useGameStore((s) => s.status)
  const currentRound = useGameStore((s) => s.currentRound)
  const chatMessages = useGameStore((s) => s.chatMessages)
  const reset = useGameStore((s) => s.reset)
  const resetUI = useUIStore((s) => s.resetUI)
  const pendingCommand = useUIStore(s => s.pendingCommand)
  const isGameSynchronized = useUIStore(s => s.isGameSynchronized)
  const isChatPanelExpanded = useUIStore((s) => s.isChatPanelExpanded)
  const toggleChatPanel = useUIStore((s) => s.toggleChatPanel)
  const toggleThoughtDrawer = useUIStore((s) => s.toggleThoughtDrawer)

  const effectiveGameId = id ?? ''
  const session = useGameSession(effectiveGameId)
  const myPlayerId = session.playerId

  const gameConfig = useMemo(
    () =>
      session.status === 'ready' && effectiveGameId && myPlayerId
        ? { gameId: effectiveGameId, playerId: myPlayerId }
        : null,
    [effectiveGameId, myPlayerId, session.status],
  )

  const { connectionStatus, sendAction, sendStartRound, sendChatMessage, disconnect, reconnect } = useGame(gameConfig)

  useEffect(() => {
    return () => {
      disconnect()
      resetUI()
    }
  }, [disconnect, resetUI])

  const handleEndGame = () => {
    disconnect()
    navigate(`/result/${effectiveGameId}`)
  }

  const handleBackToLobby = () => {
    disconnect()
    reset()
    resetUI()
    navigate('/')
  }

  const canStartRound = canStartHand(gameState)
  const commandsDisabled = connectionStatus !== 'connected' || !isGameSynchronized || Boolean(pendingCommand)

  if (session.status !== 'ready') {
    return (
      <div className="h-screen bg-[var(--bg-deepest)] flex items-center justify-center">
        <div className="text-center space-y-4">
          {session.status === 'loading' && <div className="inline-block w-8 h-8 border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)] rounded-full animate-spin" />}
          <p className="text-[var(--color-primary)] text-sm">{session.status === 'loading' ? '正在加载游戏...' : session.error}</p>
          {session.status === 'error' && <button onClick={session.retry}>重试</button>}
          <button
            onClick={handleBackToLobby}
            className="text-[var(--text-muted)] hover:text-[var(--color-primary)] text-xs underline cursor-pointer"
          >
            返回大厅
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-[var(--bg-deepest)] flex flex-col overflow-hidden">
      {/* 牌桌 + 侧面板 */}
      <main className="flex-1 relative min-h-0">
        {/* 牌桌区域 — 全屏 */}
        <div className="w-full h-full relative overflow-hidden">
          {/* 背景图层 — 包含赛博朋克牌桌场景 */}
          <div
            className="absolute inset-0 z-0"
            style={{
              backgroundImage: `url(${gameBg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center center',
              backgroundRepeat: 'no-repeat',
            }}
          />
          {/* 底部微弱渐变：保留牌桌可见，仅最底部边缘淡出 */}
          <div
            className="absolute inset-0 z-0"
            style={{
              background: 'linear-gradient(to bottom, transparent 70%, rgba(6,6,15,0.5) 90%, #06060f 100%)',
            }}
          />

          {/* 环境氛围光效 — 柔和的四角渐变 */}
          <div className="absolute inset-0 pointer-events-none z-0" aria-hidden="true">
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(ellipse at 10% 10%, rgba(0,180,140,0.08) 0%, transparent 50%),
                  radial-gradient(ellipse at 90% 90%, rgba(180,50,70,0.06) 0%, transparent 50%),
                  radial-gradient(ellipse at 90% 10%, rgba(100,70,200,0.04) 0%, transparent 40%),
                  radial-gradient(ellipse at 10% 90%, rgba(100,70,200,0.04) 0%, transparent 40%)
                `,
              }}
            />
          </div>

          <TableLayout className="w-full h-full" onCheckCards={() => sendAction('check_cards')} />

          {/* 浮动顶部栏 */}
          <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 py-2 bg-black/50 backdrop-blur-md border-b border-white/[0.06]">
            <button
              onClick={handleBackToLobby}
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                bg-white/[0.05] border border-[var(--color-primary)]/30
                hover:bg-[var(--color-primary)]/10 hover:border-[var(--color-primary)]/50
                hover:shadow-[0_0_12px_rgba(0,212,255,0.15)]
                transition-all cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[var(--color-primary)] group-hover:text-[var(--color-primary)] transition-colors" />
              <span className="text-xs font-medium text-[var(--color-primary)] group-hover:text-[var(--color-primary)] transition-colors">
                返回
              </span>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-secondary)] text-[10px] font-mono">
                {effectiveGameId.slice(0, 8)}
              </span>
              <ConnectionIndicator status={connectionStatus} />
            </div>
            <div className="flex items-center gap-2">
              {(
                <button
                  onClick={() => toggleThoughtDrawer()}
                  className="group flex items-center justify-center gap-1.5 min-w-[100px] px-3 py-1.5 rounded-lg
                    bg-white/[0.05] border border-[var(--color-gold)]/30
                    hover:bg-[var(--color-gold)]/10 hover:border-[var(--color-gold)]/50
                    hover:shadow-[0_0_12px_rgba(255,215,0,0.2)]
                    transition-all cursor-pointer"
                  title="查看 AI 心路历程"
                >
                  <BookOpen className="w-3.5 h-3.5 text-[var(--color-gold)] group-hover:text-[var(--color-gold)] transition-colors" />
                  <span className="text-xs font-medium text-[var(--color-gold)] group-hover:text-[var(--color-gold)] transition-colors">
                    心路历程
                  </span>
                </button>
              )}
              {status === 'finished' ? (
                <button
                  onClick={() => navigate(`/result/${effectiveGameId}`)}
                  className="group flex items-center justify-center gap-1.5 min-w-[100px] px-3 py-1.5 rounded-lg
                    bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/40
                    hover:bg-[var(--color-gold)]/15 hover:border-[var(--color-gold)]/60
                    hover:shadow-[0_0_12px_rgba(255,215,0,0.2)]
                    transition-all cursor-pointer"
                >
                  <Trophy className="w-3.5 h-3.5 text-[var(--color-gold)] group-hover:text-[var(--color-gold)] transition-colors" />
                  <span className="text-xs font-medium text-[var(--color-gold)] group-hover:text-[var(--color-gold)] transition-colors">
                    查看结果
                  </span>
                </button>
              ) : (
                <button
                  onClick={handleEndGame}
                  className="group flex items-center justify-center gap-1.5 min-w-[100px] px-3 py-1.5 rounded-lg
                    bg-white/[0.05] border border-[var(--color-danger)]/30
                    hover:bg-[var(--color-danger)]/10 hover:border-[var(--color-danger)]/50
                    hover:shadow-[0_0_12px_rgba(255,68,68,0.15)]
                    transition-all cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 text-[var(--color-danger)] group-hover:text-[var(--color-danger)] transition-colors" />
                  <span className="text-xs font-medium text-[var(--color-danger)] group-hover:text-[var(--color-danger)] transition-colors">
                    结束游戏
                  </span>
                </button>
              )}
            </div>
          </header>

          {/* 聊天面板 - 左下角浮层 */}
          <div className="absolute bottom-2 left-2 w-72 z-10">
            <div className="flex flex-col bg-black/30 backdrop-blur-md border border-[var(--color-primary)]/15 rounded-xl overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.4),0_0_15px_rgba(0,212,255,0.04)]">
              <button
                onClick={toggleChatPanel}
                className="group flex items-center justify-between px-3 py-2 hover:bg-white/[0.04] transition-all cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-3.5 h-3.5 text-[var(--color-secondary)]/50 group-hover:text-[var(--color-secondary)]/80 transition-colors" />
                  <span className="text-[var(--color-secondary)]/70 group-hover:text-[var(--color-secondary)] text-xs font-medium transition-colors">
                    牌桌聊天
                  </span>
                  {chatMessages.length > 0 && (
                    <span className="text-[9px] tabular-nums px-1.5 py-0.5 rounded-full bg-[var(--color-secondary)]/10 text-[var(--color-secondary)]/60 border border-[var(--color-secondary)]/10">
                      {chatMessages.length}
                    </span>
                  )}
                </div>
                <motion.div
                  animate={{ rotate: isChatPanelExpanded ? 180 : 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                >
                  <ChevronUp className="w-3.5 h-3.5 text-[var(--color-secondary)]/40 group-hover:text-[var(--color-secondary)]/70 transition-colors" />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {isChatPanelExpanded && (
                  <motion.div
                    key="chat-panel-content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden border-t border-white/[0.04]"
                  >
                    <ChatPanel
                      messages={chatMessages}
                      className="h-72 py-1"
                    />
                    <ChatInput
                      onSend={sendChatMessage}
                      disabled={connectionStatus !== 'connected'}
                      placeholder={connectionStatus !== 'connected' ? '未连接...' : '说点什么...'}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* 操作面板 - 右下角浮层 */}
          <div className="absolute bottom-2 right-2 w-64 z-10">
            <div className="bg-black/30 backdrop-blur-md border border-[var(--color-primary)]/15 rounded-xl overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.4),0_0_15px_rgba(0,212,255,0.04)]">
              {canStartRound && (
                <div className="p-3">
                  <button
                    onClick={sendStartRound}
                    disabled={commandsDisabled}
                    className="relative w-full px-4 py-2.5 font-bold rounded-lg transition-all cursor-pointer text-sm text-[var(--text-primary)] bg-black/30 border border-[var(--color-primary)]/40 hover:border-[var(--color-primary)]/70 hover:shadow-[0_0_15px_rgba(0,212,255,0.3)]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {currentRound ? '开始下一局' : '开始第一局'}
                  </button>
                </div>
              )}
              {status === 'finished' && (
                <div className="p-3 text-center">
                  <span className="text-[var(--color-gold)] text-sm font-medium">游戏已结束</span>
                </div>
              )}
              {!canStartRound && status === 'playing' && currentRound && (
                <ActionPanel onAction={sendAction} disabled={commandsDisabled} />
              )}
              {pendingCommand && <div role="status" className="p-3 text-center text-sm">等待服务器确认…</div>}
              {connectionStatus === 'disconnected' && status !== 'finished' && (
                <div className="p-3 text-center">
                  <span className="text-[var(--color-danger)] text-sm">连接已断开</span>
                  <button onClick={reconnect} className="ml-2 underline">重连</button>
                </div>
              )}
              {(connectionStatus === 'connecting' || connectionStatus === 'reconnecting') && (
                <div className="p-3 text-center">
                  <span className="text-[var(--color-warning)] text-sm animate-pulse">正在连接服务器...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 底部状态条 — 全宽条带，显示行动 / 思考 / 回顾信息 */}
      <footer className="shrink-0 relative z-20">
        <StatusBar />
      </footer>

      <ThoughtDrawer />
      <CopilotErrorModal />
    </div>
  )
}
