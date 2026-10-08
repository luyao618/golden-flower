import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, ArrowDown, TrendingUp, X, Swords, type LucideIcon } from 'lucide-react'
import { useGameStore } from '../../stores/gameStore'
import { useUIStore } from '../../stores/uiStore'
import type { GameAction } from '../../types/game'
import { getActionCost } from '../../utils/gameView'
import CompareSelector from './CompareSelector'

// ---- 操作按钮配置 ----

interface ActionButtonConfig {
  action: GameAction
  label: string
  costLabel?: string
  icon: LucideIcon
  needsConfirm?: boolean
  hotkey?: string
}

// ---- 每个 action 的主题色 ----

const ACTION_ACCENT: Record<string, { border: string; bg: string; text: string }> = {
  check_cards: { border: 'border-blue-400/40',  bg: 'bg-blue-400/10',  text: 'text-blue-400' },
  call:        { border: 'border-cyan-400/40',   bg: 'bg-cyan-400/10',  text: 'text-cyan-400' },
  raise:       { border: 'border-amber-400/40',  bg: 'bg-amber-400/10', text: 'text-amber-400' },
  compare:     { border: 'border-purple-400/40', bg: 'bg-purple-400/10', text: 'text-purple-400' },
  fold:        { border: 'border-red-400/40',    bg: 'bg-red-400/10',   text: 'text-red-400' },
}

interface ActionPanelProps {
  onAction: (action: GameAction, target?: string) => boolean | void
  disabled?: boolean
}

export default function ActionPanel({ onAction, disabled = false }: ActionPanelProps) {
  const availableActions = useGameStore((s) => s.availableActions)
  const currentRound = useGameStore((s) => s.currentRound)
  const getMyPlayer = useGameStore((s) => s.getMyPlayer)
  const players = useGameStore((s) => s.players)
  const myPlayerId = useGameStore((s) => s.myPlayerId)

  const isCompareMode = useUIStore((s) => s.isCompareMode)
  const enterCompareMode = useUIStore((s) => s.enterCompareMode)
  const exitCompareMode = useUIStore((s) => s.exitCompareMode)

  const [confirmAction, setConfirmAction] = useState<GameAction | null>(null)
  const isProcessing = useUIStore(s => Boolean(s.pendingCommand))

  const myPlayer = getMyPlayer()
  const isMyTurn = availableActions.length > 0

  const executeAction = useCallback(
    (action: GameAction, target?: string) => {
      if (disabled || useUIStore.getState().pendingCommand) return
      if (target) useUIStore.getState().setCompareTarget(target)
      if (onAction(action, target) === false) return
      setConfirmAction(null)
      exitCompareMode()
    },
    [disabled, onAction, exitCompareMode],
  )

  const handleActionClick = useCallback(
    (action: GameAction, needsConfirm?: boolean) => {
      if (action === 'compare') {
        enterCompareMode()
        return
      }
      if (needsConfirm && confirmAction !== action) {
        setConfirmAction(action)
        return
      }
      executeAction(action)
    },
    [enterCompareMode, confirmAction, executeAction],
  )

  const handleCompareTarget = useCallback(
    (targetId: string) => {
      executeAction('compare', targetId)
    },
    [executeAction],
  )

  const handleCancelConfirm = useCallback(() => {
    setConfirmAction(null)
  }, [])

  if (!myPlayer || !currentRound) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-3 px-4">
        <span className="text-[var(--text-muted)] text-sm">等待对手行动...</span>
      </div>
    )
  }

  // 构建操作按钮 — 轮到自己时用服务端下发的可用动作，否则显示默认按钮组（置灰）
  const buttons: ActionButtonConfig[] = []

  if (isMyTurn) {
    for (const action of availableActions) {
      switch (action) {
        case 'check_cards':
          buttons.push({ action: 'check_cards', label: '看牌', icon: Eye, hotkey: 'Q' })
          break
        case 'call':
          buttons.push({ action: 'call', label: '跟注', costLabel: `${getActionCost('call', currentRound, myPlayer)}`, icon: ArrowDown, hotkey: 'W' })
          break
        case 'raise':
          buttons.push({ action: 'raise', label: '加注', costLabel: `${getActionCost('raise', currentRound, myPlayer)}`, icon: TrendingUp, hotkey: 'E' })
          break
        case 'compare':
          buttons.push({ action: 'compare', label: '比牌', costLabel: `${getActionCost('compare', currentRound, myPlayer)}`, icon: Swords, hotkey: 'R' })
          break
        case 'fold':
          buttons.push({ action: 'fold', label: '弃牌', icon: X, needsConfirm: true, hotkey: 'F' })
          break
      }
    }
  } else {
    // 等待对手时显示与行动时一致的按钮布局（置灰）
    // 暗注: 看牌、跟注、加注、弃牌（4个，无比牌）
    // 明注: 跟注、加注、比牌、弃牌（4个，无看牌）
    if (myPlayer.status === 'active_blind') {
      buttons.push(
        { action: 'check_cards', label: '看牌', icon: Eye, hotkey: 'Q' },
        { action: 'call', label: '跟注', costLabel: `${getActionCost('call', currentRound, myPlayer)}`, icon: ArrowDown, hotkey: 'W' },
        { action: 'raise', label: '加注', costLabel: `${getActionCost('raise', currentRound, myPlayer)}`, icon: TrendingUp, hotkey: 'E' },
        { action: 'fold', label: '弃牌', icon: X, hotkey: 'F' },
      )
    } else {
      buttons.push(
        { action: 'call', label: '跟注', costLabel: `${getActionCost('call', currentRound, myPlayer)}`, icon: ArrowDown, hotkey: 'W' },
        { action: 'raise', label: '加注', costLabel: `${getActionCost('raise', currentRound, myPlayer)}`, icon: TrendingUp, hotkey: 'E' },
        { action: 'compare', label: '比牌', costLabel: `${getActionCost('compare', currentRound, myPlayer)}`, icon: Swords, hotkey: 'R' },
        { action: 'fold', label: '弃牌', icon: X, hotkey: 'F' },
      )
    }
  }

  // 比牌选择模式
  if (isCompareMode) {
    const compareTargets = players.filter(
      (p) => p.id !== myPlayerId && p.status !== 'folded' && p.status !== 'compare_lost' && p.status !== 'out',
    )
    return (
      <fieldset disabled={disabled || isProcessing} className="p-3">
        <CompareSelector
          targets={compareTargets}
          cost={getActionCost('compare', currentRound, myPlayer)}
          onSelect={handleCompareTarget}
          onCancel={exitCompareMode}
        />
      </fieldset>
    )
  }

  // 2x2 网格: [跟注/看牌, 加注] [比牌, 弃牌]
  // 将所有按钮放入统一的 2 列网格
  const renderButton = (btn: ActionButtonConfig) => {
    const isConfirming = confirmAction === btn.action
    const Icon = btn.icon
    const accent = ACTION_ACCENT[btn.action] ?? ACTION_ACCENT.call
    const isDisabled = disabled || !isMyTurn || isProcessing

    return (
      <motion.div
        key={btn.action}
        layout
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      >
        {isConfirming ? (
          <div className="flex items-center justify-center gap-1 h-full">
            <button
              onClick={() => executeAction(btn.action)}
              disabled={isDisabled}
              className="flex-1 px-2 py-2.5 rounded-lg text-xs font-bold whitespace-nowrap
                bg-[var(--color-danger)]/20 text-[var(--color-danger)]
                border border-[var(--color-danger)]/50
                hover:bg-[var(--color-danger)]/30
                transition-all cursor-pointer disabled:opacity-50"
            >
              确认{btn.label}
            </button>
            <button
              onClick={handleCancelConfirm}
              className="px-2 py-2.5 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer whitespace-nowrap"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => !isDisabled && handleActionClick(btn.action, btn.needsConfirm)}
            disabled={isDisabled}
            className={`
              relative flex items-center w-full h-full px-3 py-2.5 rounded-lg
              border transition-all
              ${isMyTurn
                ? `bg-white/[0.03] ${accent.border} text-[var(--text-primary)] hover:bg-white/[0.08] hover:scale-[1.02] active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`
                : `bg-white/[0.02] border-white/[0.06] text-[var(--text-disabled)] cursor-not-allowed`
              }
            `}
          >
            <Icon className={`w-4 h-4 ${isMyTurn ? accent.text : 'text-[var(--text-disabled)]'} shrink-0`} />
            <span className="text-sm font-semibold ml-1.5">{btn.label}</span>
            {btn.costLabel && (
              <span className={`text-xs font-mono ml-auto ${isMyTurn ? 'text-[var(--text-muted)]' : 'text-[var(--text-disabled)]'}`}>
                {btn.costLabel}
              </span>
            )}
            {btn.hotkey && (
              <span className="absolute top-0.5 right-1 text-[8px] bg-black/50 text-[var(--text-disabled)] rounded px-0.5 leading-relaxed">
                {btn.hotkey}
              </span>
            )}
          </button>
        )}
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 w-full">
      {/* 状态行: 底池 + 筹码 — 始终可见 */}
      <div className="flex items-center justify-between px-0.5 mb-0.5">
        <span className="text-[var(--text-secondary)] text-sm">
          底池 <span className="text-[var(--color-gold)] font-mono font-bold text-base">{currentRound.pot}</span>
        </span>
        <span className="text-[var(--text-secondary)] text-sm">
          {myPlayer.status === 'active_blind' ? '暗注' : '明注'}
          <span className="text-[var(--text-disabled)] mx-1">·</span>
          筹码 <span className="text-[var(--color-gold)] font-mono font-bold text-base">{myPlayer.chips.toLocaleString()}</span>
        </span>
      </div>

      {/* 等待提示 */}
      {!isMyTurn && (
        <div className="flex items-center justify-center gap-2 py-0.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--text-muted)] opacity-40" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--text-muted)]" />
          </span>
          <span className="text-[var(--text-muted)] text-xs">等待对手行动...</span>
        </div>
      )}

      {/* 操作按钮 — 2x2 网格 */}
      <AnimatePresence mode="popLayout">
        <div className="grid grid-cols-2 gap-1.5">
          {buttons.map(renderButton)}
        </div>
      </AnimatePresence>
    </div>
  )
}
