import { Fragment, useState } from 'react'
import { motion } from 'framer-motion'
import type { Card, ChatMessage, Player, PlayerStatus } from '../../types/game'
import { useUIStore } from '../../stores/uiStore'
import { getCharacterImage } from '../../utils/theme'
import ChatBubble from './ChatBubble'
import CardHand from '../Cards/CardHand'

interface PlayerSeatProps {
  player: Player
  /** 牌/筹码位置（桌面边缘椭圆上） */
  cardPosition: { x: number; y: number }
  /** 角色立绘位置（桌外椭圆上，仅 AI） */
  characterPosition?: { x: number; y: number }
  /** AI 座位索引（用于角色分配，0-based） */
  seatIndex: number
  isActive: boolean
  isMe: boolean
  isDealer: boolean
  latestMessage?: ChatMessage | null
  myCards?: Card[]
  onLookAtCards?: () => void
  onClick?: () => void
}

/** 玩家状态的中文标签 */
const STATUS_LABELS: Record<PlayerStatus, string> = {
  active_blind: '暗注',
  active_seen: '明注',
  folded: '弃牌',
  compare_lost: '落败',
  out: '出局',
}

/**
 * 根据座位在桌面上的位置，计算手牌应该偏移的方向
 * 手牌应该朝向桌面中心方向放置
 */
function getCardOffset(position: { x: number; y: number }): { x: number; y: number } {
  const dx = 50 - position.x
  const dy = 50 - position.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return { x: 0, y: 0 }
  const scale = 40 / dist
  return { x: dx * scale, y: dy * scale }
}

/**
 * 玩家座位组件 — 角色立绘版
 *
 * AI 玩家：大角色立绘（桌外） + 名字/筹码 + 牌（桌面边缘）
 * 人类玩家：仅手牌（桌面边缘）
 */
export default function PlayerSeat({
  player,
  cardPosition,
  characterPosition,
  seatIndex,
  isActive,
  isMe,
  isDealer,
  latestMessage,
  myCards: _myCards = [],
  onLookAtCards: _onLookAtCards,
  onClick,
}: PlayerSeatProps) {
  const { isCompareMode, thinkingPlayerId, reviewingPlayerId, showPlayerCards, hasLookedAtCards, compareRevealedCards, toggleThoughtDrawer } = useUIStore()

  const isFolded = player.status === 'folded' || player.status === 'compare_lost'
  const isOut = player.status === 'out'
  const isDimmed = isFolded || isOut
  const isThinking = thinkingPlayerId === player.id
  const isReviewing = reviewingPlayerId === player.id
  const isClickable = isCompareMode && !isMe && !isFolded && !isOut
  const isAI = player.player_type === 'ai'
  const isHuman = !isAI

  // 气泡位置：根据角色位置判断
  const bubbleRefPos = characterPosition ?? cardPosition
  const bubblePosition = bubbleRefPos.y > 50 ? 'above' : 'below'

  // 手牌偏移方向（朝桌面中心）— 仅用于人类玩家
  // AI 玩家的牌直接放在角色正下方，不偏移
  const cardOffset = isHuman ? getCardOffset(cardPosition) : { x: 0, y: 0 }

  // 是否显示手牌
  const shouldShowCards = showPlayerCards && !isOut && !isFolded
  const canLookAtCards = isMe && !hasLookedAtCards && _myCards.length > 0

  // 比牌亮牌：是否该玩家的手牌在比牌后被揭示
  const revealedCards = compareRevealedCards[player.id] ?? null
  // 比牌输家和结算出局玩家也显示服务端明确揭示的牌
  const shouldShowRevealed = revealedCards !== null && showPlayerCards

  // 角色图片加载状态
  const [charLoaded, setCharLoaded] = useState(false)

  return (
    <Fragment>
      {/* ============================================ */}
      {/* 1. 角色立绘容器（仅 AI 玩家）              */}
      {/* ============================================ */}
      {isAI && characterPosition && (
        <motion.div
          className="absolute"
          style={{
            left: `${characterPosition.x}%`,
            top: `${characterPosition.y}%`,
            // 角色底部对齐到坐标点（桌面远边缘），角色从该点向上延伸
            // 这样角色看起来像坐在桌子边上
            transform: 'translate(-50%, -85%)',
            zIndex: isActive ? 20 : 10,
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          {/* 可点击容器 */}
          <div
            className={`
              relative flex flex-col items-center
              transition-all duration-300
              ${isDimmed ? '' : ''}
              ${isClickable ? 'cursor-pointer hover:scale-105' : ''}
              ${isActive ? 'scale-[1.03]' : ''}
            `}
            onClick={isClickable ? onClick : undefined}
          >
            {/* 聊天气泡（名字上方，不影响布局） */}
            <div className="relative">
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1">
                <ChatBubble message={latestMessage ?? null} position="above" />
              </div>
            </div>

            {/* 名字（角色上方） */}
            <div className="text-center mb-1 flex items-center gap-1.5">
              <span className="text-sm font-bold text-[var(--text-primary)] drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                {player.name}
              </span>
              {isDealer && (
                <span className="inline-flex w-5 h-5 rounded-full bg-amber-500 border-2 border-amber-300 items-center justify-center shadow-md">
                  <span className="text-[9px] font-bold text-amber-900">D</span>
                </span>
              )}
            </div>

            {/* 角色图片 */}
            <div
              className={`relative ${!isCompareMode ? 'cursor-pointer' : ''}`}
              onClick={!isCompareMode ? () => toggleThoughtDrawer(player.id) : undefined}
              title={!isCompareMode ? `查看 ${player.name} 的心路历程` : undefined}
              style={{ height: '18vh', maxHeight: '200px', minHeight: '100px' }}
            >
              {/* 加载占位 */}
              {!charLoaded && (
                <div
                  className="animate-pulse bg-white/5 rounded-lg w-full h-full"
                />
              )}
              <img
                src={getCharacterImage(seatIndex)}
                alt={player.name}
                className={`
                  h-full w-auto object-contain select-none
                  ${charLoaded ? 'opacity-100' : 'opacity-0'}
                  transition-opacity duration-300
                `}
                style={{
                  filter: isDimmed
                    ? 'grayscale(1) saturate(0) drop-shadow(0 2px 8px rgba(0,0,0,0.6))'
                    : isActive
                      ? 'drop-shadow(0 0 20px rgba(0,212,255,0.4))'
                      : 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
                }}
                loading="eager"
                draggable={false}
                onLoad={() => setCharLoaded(true)}
              />

              {/* 活跃玩家呼吸光效 */}
              {isActive && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  animate={{
                    filter: [
                      'drop-shadow(0 0 10px rgba(0,212,255,0.2))',
                      'drop-shadow(0 0 25px rgba(0,212,255,0.5))',
                      'drop-shadow(0 0 10px rgba(0,212,255,0.2))',
                    ],
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}

              {/* 比牌模式高亮 */}
              {isClickable && (
                <div className="absolute inset-0 pointer-events-none rounded-lg ring-2 ring-[var(--color-secondary)] drop-shadow-[0_0_15px_rgba(139,92,246,0.4)]" />
              )}

              {/* AI 思考指示器 */}
              {isThinking && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
                  <ThinkingDots />
                </div>
              )}

              {/* AI 经验回顾指示器 */}
              {isReviewing && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
                  <motion.div
                    className="bg-[var(--color-secondary)]/80 rounded-full px-2 py-0.5 text-[8px] text-white whitespace-nowrap"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  >
                    回顾中
                  </motion.div>
                </div>
              )}
            </div>

            {/* 筹码信息（角色下方） */}
            <div className="text-center mt-1 flex flex-col items-center gap-0">
              <div className="flex items-center gap-1 text-sm">
                <span className="text-[var(--color-gold)] font-mono font-semibold tabular-nums drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                  {player.chips.toLocaleString()}
                </span>
                <span className="text-[var(--text-disabled)]">·</span>
                <span className={`text-xs font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${getStatusColor(player.status)}`}>
                  {STATUS_LABELS[player.status]}
                </span>
              </div>
              {player.total_bet_this_round > 0 && (
                <div className="text-[var(--color-primary)] text-xs font-medium drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] leading-tight">
                  下注 {player.total_bet_this_round}
                </div>
              )}
            </div>

            {/* AI 对手的牌（角色下方） */}
            {(shouldShowCards || shouldShowRevealed) && (
              <div className="mt-1 flex justify-center">
                <CardHand
                  cards={revealedCards ?? PLACEHOLDER_CARDS}
                  faceUp={revealedCards !== null}
                  size="xs"
                  fanAngle={0}
                />
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ============================================ */}
      {/* 2. 牌区域（仅人类玩家，使用 cardPosition）  */}
      {/* ============================================ */}
      {isHuman && (shouldShowCards || shouldShowRevealed) && (
        <motion.div
          className="absolute pointer-events-auto"
          style={{
            left: `${cardPosition.x}%`,
            top: `${cardPosition.y}%`,
            transform: `translate(calc(-50% + ${cardOffset.x}px), calc(-50% + ${cardOffset.y}px))`,
            zIndex: 5,
          }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <div
            className={canLookAtCards ? 'cursor-pointer' : ''}
            onClick={canLookAtCards ? _onLookAtCards : undefined}
          >
            <CardHand
              cards={_myCards.length > 0 ? _myCards : PLACEHOLDER_CARDS}
              faceUp={(hasLookedAtCards && _myCards.length > 0) || revealedCards !== null}
              size="md"
              fanAngle={0}
            />
            {canLookAtCards && (
              <div className="text-center text-[8px] text-[var(--color-gold)]/60 mt-0.5 animate-pulse">
                点击看牌
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ============================================ */}
      {/* 3. 人类玩家聊天气泡（独立定位）             */}
      {/* ============================================ */}
      {isHuman && (
        <div
          className="absolute"
          style={{
            left: `${cardPosition.x}%`,
            top: `${cardPosition.y}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 15,
          }}
        >
          <ChatBubble message={latestMessage ?? null} position={bubblePosition} />
        </div>
      )}
    </Fragment>
  )
}

// ---- 辅助函数 ----

function getStatusColor(status: PlayerStatus): string {
  switch (status) {
    case 'active_blind':
      return 'text-[var(--color-info)]'
    case 'active_seen':
      return 'text-[var(--color-gold)]'
    case 'folded':
    case 'compare_lost':
      return 'text-[var(--text-secondary)]'
    case 'out':
      return 'text-[var(--color-danger)]'
  }
}

// ---- 辅助组件 ----

const PLACEHOLDER_CARDS: Card[] = [
  { suit: 'spades', rank: 14 },
  { suit: 'hearts', rank: 13 },
  { suit: 'diamonds', rank: 12 },
]

/** AI 思考中的动态圆点指示器 */
function ThinkingDots() {
  return (
    <div className="flex items-center gap-0.5 bg-black/70 rounded-full px-2 py-1">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  )
}
