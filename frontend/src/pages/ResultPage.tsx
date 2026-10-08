import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useGameStore } from '../stores/gameStore'
import Leaderboard from '../components/Settlement/Leaderboard'
import type { LeaderboardPlayer } from '../components/Settlement/Leaderboard'
import AgentSummaryCard from '../components/Settlement/AgentSummaryCard'
import { getExperienceReviews } from '../services/api'
import { useGameSession } from '../hooks/useGameSession'
import type { ExperienceReview } from '../types/game'
import resultBg from '../assets/result-bg.png'

export default function ResultPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const gameId = id ?? ''

  const session = useGameSession(gameId)
  const players = useGameStore((s) => s.players)
  const initialChips = useGameStore((s) => s.config?.initial_chips ?? 1000)
  const reset = useGameStore((s) => s.reset)
  const [reviews, setReviews] = useState<Record<string, ExperienceReview[]>>({})
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({})
  const pageLoading = session.status === 'loading'

  // AI 玩家列表
  const aiPlayers = useMemo(
    () => players.filter((p) => p.player_type === 'ai'),
    [players],
  )

  // 排行榜数据：按筹码降序
  const rankings: LeaderboardPlayer[] = useMemo(() => {
    return [...players]
      .sort((a, b) => b.chips - a.chips)
      .map((p) => ({
        player: p,
        chipChange: p.chips - initialChips,
        initialChips,
      }))
  }, [players, initialChips])

  // 加载所有 AI 的 reviews（策略调整记录）
  const loadReviews = useCallback(async () => {
    if (session.status !== 'ready' || !gameId || aiPlayers.length === 0) return

    const loadingMap: Record<string, boolean> = {}
    aiPlayers.forEach((ai) => { loadingMap[ai.id] = true })
    setLoadingStates(loadingMap)

    // 加载 reviews
    await Promise.allSettled(
      aiPlayers.map(async (ai) => {
        try {
          const reviewList = await getExperienceReviews(gameId, ai.id)
          setReviews((prev) => ({ ...prev, [ai.id]: reviewList }))
        } catch (err) {
          console.error(`Failed to load reviews for ${ai.name}:`, err)
        } finally {
          setLoadingStates((prev) => ({ ...prev, [ai.id]: false }))
        }
      }),
    )
  }, [gameId, aiPlayers, session.status])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  // 返回大厅
  const handleBackToLobby = () => {
    reset()
    navigate('/')
  }

  // 加载中
  if (pageLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-deepest)] flex items-center justify-center relative overflow-hidden">
        {/* 背景图 */}
        <div className="fixed inset-0 pointer-events-none">
          <img src={resultBg} alt="" className="w-full h-full object-cover" style={{ objectPosition: 'center 20%', filter: 'brightness(0.75) saturate(1.2)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,5,15,0.35) 0%, rgba(5,5,15,0.5) 50%, rgba(5,5,15,0.7) 100%)' }} />
        </div>
        {/* 背景光晕 */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 50% 30%, rgba(0,212,255,0.06) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(139,92,246,0.04) 0%, transparent 50%)'
          }}
        />
        <div className="text-center space-y-4 relative z-10">
          <div className="inline-block w-8 h-8 border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)] rounded-full animate-spin" />
          <p className="text-[var(--text-muted)] text-sm">加载游戏结果...</p>
        </div>
      </div>
    )
  }

  // 没有数据
  if (session.status !== 'ready' || players.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--bg-deepest)] flex items-center justify-center relative overflow-hidden">
        {/* 背景图 */}
        <div className="fixed inset-0 pointer-events-none">
          <img src={resultBg} alt="" className="w-full h-full object-cover" style={{ objectPosition: 'center 20%', filter: 'brightness(0.75) saturate(1.2)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(5,5,15,0.35) 0%, rgba(5,5,15,0.5) 50%, rgba(5,5,15,0.7) 100%)' }} />
        </div>
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 50% 30%, rgba(0,212,255,0.06) 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(139,92,246,0.04) 0%, transparent 50%)'
          }}
        />
        <div className="text-center space-y-4 relative z-10">
          <p className="text-[var(--text-muted)]">{session.error ?? '未找到游戏数据'}</p>
          <div className="neon-btn-wrapper inline-block">
            <button
              onClick={handleBackToLobby}
              className="relative px-6 py-2 font-bold rounded-xl bg-[var(--bg-surface)] text-[var(--text-primary)] transition-all cursor-pointer hover:bg-[var(--bg-elevated)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              返回大厅
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg-deepest)] relative overflow-hidden">
      {/* 背景图 — 固定定位，滚动时不动 */}
      <div className="fixed inset-0 pointer-events-none">
        <img
          src={resultBg}
          alt=""
           className="w-full h-full object-cover"
          style={{ objectPosition: 'center 20%', filter: 'brightness(0.75) saturate(1.2)' }}
        />
        {/* 暗色叠加层 — 保证文字可读性 */}
        <div className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, rgba(5,5,15,0.35) 0%, rgba(5,5,15,0.5) 50%, rgba(5,5,15,0.7) 100%)'
          }}
        />
      </div>
      {/* 背景装饰：径向光晕（叠在图片上方） */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 10%, rgba(0,212,255,0.06) 0%, transparent 50%), radial-gradient(ellipse at 50% 90%, rgba(139,92,246,0.04) 0%, transparent 50%)'
        }}
      />
      {/* 背景装饰：底部透视网格 */}
      <div className="absolute bottom-0 left-0 right-0 h-1/3 perspective-grid opacity-20 pointer-events-none" />

      {/* 顶部栏 */}
      <header className="sticky top-0 z-10 bg-[var(--bg-deep)]/80 backdrop-blur-md border-b border-[var(--border-default)]">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={handleBackToLobby}
            className="lobby-back-btn flex items-center gap-2.5 px-5 py-2.5 rounded-2xl
                       transition-all cursor-pointer group"
          >
            <svg className="w-5 h-5 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                 style={{ color: '#00d4ff', filter: 'drop-shadow(0 0 4px rgba(0,212,255,0.6))' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-semibold tracking-wider"
                  style={{
                    fontFamily: 'var(--font-display)',
                    color: '#d5fbff',
                    textShadow: '0 0 8px rgba(0,212,255,0.5), 0 0 20px rgba(0,212,255,0.25)',
                  }}>
              返回大厅
            </span>
          </button>
          <div className="text-[var(--text-muted)] text-xs font-mono">
            ID: {gameId.slice(0, 8)}
          </div>
          <div />
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-10 relative z-[1]">
        {/* 标题 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <h1 className="text-4xl font-bold neon-text-hero mb-3"
              style={{ fontFamily: 'var(--font-display)' }}>
            GAME OVER
          </h1>
          {/* 渐变分隔线 */}
          <div className="mx-auto w-48 title-deco-line mb-3" />
          <p className="text-[var(--text-muted)] text-sm">
            共 {rankings.length} 名玩家参与了本场对局
          </p>
        </motion.div>

        {/* 排行榜 */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <Leaderboard rankings={rankings} />
        </motion.section>

        {/* AI 策略调整记录 */}
        {aiPlayers.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="space-y-4"
          >
            <h2 className="text-xl font-bold text-[var(--text-primary)] text-center"
                style={{ fontFamily: 'var(--font-display)' }}>
              AI 策略调整记录
            </h2>
            <p className="text-[var(--text-muted)] text-xs text-center mb-4">
              点击卡片查看每个 AI 的策略调整历程
            </p>

            <div className="space-y-3">
              {aiPlayers.map((ai, index) => (
                <motion.div
                  key={ai.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + index * 0.1, duration: 0.4 }}
                >
                  <AgentSummaryCard
                    player={ai}
                    summary={null}
                    reviews={reviews[ai.id] ?? []}
                    loading={loadingStates[ai.id] ?? false}
                    initialOpen={index === 0}
                  />
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}

        {/* 底部 — 再来一局霓虹按钮 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.5 }}
          className="text-center pb-8"
        >
          <div className="neon-btn-wrapper inline-block">
            <button
              onClick={handleBackToLobby}
              className="relative px-8 py-3 font-bold rounded-xl text-lg bg-[var(--bg-surface)] text-[var(--text-primary)] transition-all cursor-pointer hover:bg-[var(--bg-elevated)] active:scale-[0.98]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              再来一局
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  )
}
