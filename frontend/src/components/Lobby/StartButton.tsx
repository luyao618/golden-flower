// ============================================================
// 开始游戏按钮 - 调用 create API 并跳转到牌桌
// ============================================================

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../../stores/gameStore'

interface StartButtonProps {
  /** 当需要用户配置模型时的回调 */
  onNeedModelConfig?: () => void
}

export default function StartButton({ onNeedModelConfig }: StartButtonProps) {
  const navigate = useNavigate()
  const { status, error, createGame, aiOpponents, playerName, availableModels } = useGameStore()
  const [localError, setLocalError] = useState<string | null>(null)
  const [showModelAlert, setShowModelAlert] = useState(false)

  const isCreating = status === 'creating'

  const handleStart = async () => {
    if (useGameStore.getState().status === 'creating') return
    setLocalError(null)

    // 基础验证
    if (aiOpponents.length === 0) {
      setLocalError('至少需要一个 AI 对手')
      return
    }

    // 检查是否有可用模型
    if (availableModels.length === 0) {
      setShowModelAlert(true)
      return
    }

    // 如果没有输入名称，使用默认昵称
    if (!playerName.trim()) {
      // 临时设置默认名称用于创建游戏
      const { setPlayerName } = useGameStore.getState()
      setPlayerName('人类一败涂地')
    }

    try {
      const response = await createGame()
      // 创建成功，跳转到牌桌页面
      navigate(`/game/${response.game_id}`)
    } catch (err) {
      // createGame 内部已经设置了 store error
      // 这里设置 localError 作为额外提示
      if (err instanceof Error) {
        setLocalError(err.message)
      }
    }
  }

  const handleGoConfig = useCallback(() => {
    setShowModelAlert(false)
    onNeedModelConfig?.()
  }, [onNeedModelConfig])

  const displayError = localError || error

  return (
    <div className="space-y-1">
      {displayError && (
        <div className="px-4 py-2 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-xl text-[var(--color-danger)] text-sm">
          {displayError}
        </div>
      )}

      {/* Neon animated border wrapper */}
      <div className="neon-btn-wrapper">
        <button
          onClick={handleStart}
          disabled={isCreating}
          className="relative w-full py-3 font-bold rounded-[11px] text-base tracking-wider
                     text-white
                     transition-all cursor-pointer
                     active:scale-[0.98]
                     disabled:cursor-wait disabled:opacity-60"
          style={{
            fontFamily: 'var(--font-display)',
            background: 'rgba(15, 15, 40, 0.40)',
            backdropFilter: 'blur(20px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(15, 15, 40, 0.50)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(15, 15, 40, 0.40)')}
        >
          {isCreating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-5 h-5 border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)] rounded-full animate-spin" />
              创建中...
            </span>
          ) : (
            '开始游戏'
          )}
        </button>
      </div>

      {/* 模型未配置提示弹框 */}
      <ModelAlertModal
        open={showModelAlert}
        onClose={() => setShowModelAlert(false)}
        onGoConfig={handleGoConfig}
      />
    </div>
  )
}

// ---- 赛博朋克风格提示弹框 ----

function ModelAlertModal({
  open,
  onClose,
  onGoConfig,
}: {
  open: boolean
  onClose: () => void
  onGoConfig: () => void
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 遮罩层 */}
          <motion.div
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* 弹框 */}
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
          >
            <div
              className="w-full max-w-sm rounded-2xl p-[1px] overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(0,212,255,0.5), rgba(139,92,246,0.4), rgba(0,212,255,0.2))',
              }}
            >
              <div
                className="rounded-2xl p-6 space-y-5"
                style={{
                  background: 'rgba(10, 10, 30, 0.92)',
                  backdropFilter: 'blur(24px) saturate(1.3)',
                  WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
                  boxShadow: '0 0 40px rgba(0, 212, 255, 0.12), 0 0 80px rgba(139, 92, 246, 0.06)',
                }}
              >
                {/* 图标 + 标题 */}
                <div className="flex flex-col items-center text-center space-y-3">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center"
                    style={{
                      background: 'rgba(0, 212, 255, 0.08)',
                      border: '1px solid rgba(0, 212, 255, 0.25)',
                      boxShadow: '0 0 20px rgba(0, 212, 255, 0.15)',
                    }}
                  >
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                         style={{ color: '#00d4ff', filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.5))' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <h3
                    className="text-lg font-bold tracking-wide"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: '#e0faff',
                      textShadow: '0 0 12px rgba(0, 212, 255, 0.4)',
                    }}
                  >
                    尚未配置 AI 模型
                  </h3>
                </div>

                {/* 说明文字 */}
                <p
                  className="text-sm leading-relaxed text-center"
                  style={{ color: '#a0b8d0', fontFamily: 'var(--font-body)' }}
                >
                  需要先配置至少一个 AI 模型的 API Key 或连接 GitHub Copilot，才能开始游戏。
                </p>

                {/* 操作按钮 */}
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: '#8090a0',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'
                      e.currentTarget.style.color = '#c0d0e0'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
                      e.currentTarget.style.color = '#8090a0'
                    }}
                  >
                    取消
                  </button>
                  <button
                    onClick={onGoConfig}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: '#ffffff',
                      background: 'linear-gradient(135deg, rgba(0,212,255,0.25), rgba(139,92,246,0.2))',
                      border: '1px solid rgba(0, 212, 255, 0.35)',
                      textShadow: '0 0 8px rgba(0,212,255,0.4)',
                      boxShadow: '0 0 16px rgba(0, 212, 255, 0.12)',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,212,255,0.35), rgba(139,92,246,0.3))'
                      e.currentTarget.style.boxShadow = '0 0 24px rgba(0, 212, 255, 0.2)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,212,255,0.25), rgba(139,92,246,0.2))'
                      e.currentTarget.style.boxShadow = '0 0 16px rgba(0, 212, 255, 0.12)'
                    }}
                  >
                    去配置
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
