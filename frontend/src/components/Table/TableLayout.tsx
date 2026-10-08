import { useCallback, useMemo } from 'react'
import type { ChatMessage, Player } from '../../types/game'
import { useGameStore } from '../../stores/gameStore'
import { useUIStore } from '../../stores/uiStore'
import PlayerSeat from '../Player/PlayerSeat'
import GameInfoPanel from './GameInfoPanel'
import DealingAnimation from './DealingAnimation'
import ChipFlyAnimation, { WinChipAnimation } from './ChipFlyAnimation'

interface TableLayoutProps {
  className?: string
  onCheckCards?: () => void
}

// ============================================================
// 座位排列算法
// 第一人称视角：人类玩家在屏幕近端（底部），
// AI 对手坐在牌桌对面（5 个固定位置），水平排列
// 双坐标系：牌位置（桌面上）+ 角色位置（桌面远边缘，坐姿效果）
// ============================================================

interface SeatPositionSet {
  card: { x: number; y: number }       // 牌的位置（桌面上）
  character: { x: number; y: number }   // 角色的位置（桌面远边缘，坐姿对齐）
}

/**
 * 5 个固定的 AI 座位位置（从左到右）
 *
  * 角色 y≈30-33%：桌面内侧，角色锚点对齐到这里，
  *                配合 translate(-50%, -85%) 形成角色上半身在桌外、
  *                下半身被桌子遮挡的"坐在桌边"视觉效果
  * 牌 y≈36-39%：  牌放在桌面上，紧贴角色下方
  * x 均匀分布：15%, 30%, 50%, 70%, 85%
  * y 带微弧度：两侧稍低（透视效果）
 */
const FIXED_AI_SEATS: SeatPositionSet[] = [
  { card: { x: 19, y: 57 }, character: { x: 19, y: 50 } },
  { card: { x: 32, y: 55 }, character: { x: 32, y: 48 } },
  { card: { x: 45, y: 55 }, character: { x: 45, y: 48 } },  // 中间稍高（透视）
  { card: { x: 58, y: 55 }, character: { x: 58, y: 48 } },
  { card: { x: 71, y: 57 }, character: { x: 71, y: 50 } },
]

/**
 * 计算座位位置：人类 + AI（从 5 个固定位置中选取）
 *
 * 无论有多少 AI，固定位置不变，只是不使用的位置不显示。
 * AI 玩家按顺序分配到固定位置：
 *   1 AI → 居中位置 [2]
 *   2 AI → [1, 3]
 *   3 AI → [0, 2, 4]
 *   4 AI → [0, 1, 3, 4]
 *   5 AI → [0, 1, 2, 3, 4]
 */
const AI_SEAT_ASSIGNMENT: Record<number, number[]> = {
  1: [2],        // 3号贴图
  2: [1, 3],     // 2号、4号贴图
  3: [1, 2, 3],  // 2号、3号、4号贴图（默认）
  4: [1, 2, 3, 4], // 2号、3号、4号、5号贴图
  5: [0, 1, 2, 3, 4], // 全部显示
}

function calculateSeatPositions(
  playerCount: number
): SeatPositionSet[] {
  const positions: SeatPositionSet[] = []

  // 第一个位置永远是人类玩家（底部中央）
  positions.push({
    card: { x: 43, y: 83 },
    character: { x: 50, y: 95 }, // 人类不使用角色位置
  })

  const aiCount = Math.min(playerCount - 1, 5)
  if (aiCount <= 0) return positions

  const assignment = AI_SEAT_ASSIGNMENT[aiCount] ?? AI_SEAT_ASSIGNMENT[5]
  for (const seatIdx of assignment) {
    positions.push(FIXED_AI_SEATS[seatIdx])
  }

  return positions
}

/**
 * 对玩家列表重新排序：人类玩家放在第一位
 * 这样 calculateSeatPositions 的第一个位置（底部中央）就分配给人类
 */
function reorderPlayersHumanFirst(players: Player[]): Player[] {
  const humanIndex = players.findIndex((p) => p.player_type === 'human')
  if (humanIndex <= 0) return players

  return [...players.slice(humanIndex), ...players.slice(0, humanIndex)]
}

/**
 * 牌桌布局组件 — 第一人称视角
 *
 * 功能：
 * - 背景图提供赛博朋克牌桌场景（无 CSS 绘制牌桌）
 * - 底池筹码显示（桌面中央）
 * - AI 对手站在牌桌对面（屏幕上半部分水平排列）
 * - 人类玩家手牌在屏幕底部
 * - 当前行动玩家高亮
 * - 庄家标记
 */
export default function TableLayout({ className = '', onCheckCards }: TableLayoutProps) {
  const {
    players,
    currentRound,
    myPlayerId,
    myCards,
    chatMessages,
  } = useGameStore()

  const {
    setCompareTarget,
    isCompareMode,
    stopDealingAnimation,
    setShowPlayerCards,
    winAnimation,
    clearWinAnimation,
  } = useUIStore()

  // 重新排序：人类放底部
  const orderedPlayers = reorderPlayersHumanFirst(players)
  const seatPositions = calculateSeatPositions(orderedPlayers.length)

  // 每个玩家的最新非系统聊天消息（用于头顶气泡）
  const latestMessageByPlayer = useMemo(() => {
    const map: Record<string, ChatMessage> = {}
    for (const msg of chatMessages) {
      if (msg.message_type !== 'system_message') {
        map[msg.player_id] = msg
      }
    }
    return map
  }, [chatMessages])

  // 当前行动玩家
  const currentPlayerIndex = currentRound?.phase === 'betting' ? currentRound.current_player_index : -1
  const currentPlayerId = players[currentPlayerIndex]?.id ?? null

  // 庄家
  const dealerIndex = currentRound?.dealer_index ?? -1
  const dealerId = players[dealerIndex]?.id ?? null

  // 构建 playerID → 座位位置的映射（供 ChipFlyAnimation 使用，用牌位置坐标）
  const playerPositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {}
    orderedPlayers.forEach((player, index) => {
      if (seatPositions[index]) {
        map[player.id] = seatPositions[index].card
      }
    })
    return map
  }, [orderedPlayers, seatPositions])

  // 赢家座位位置
  const winnerPosition = useMemo(() => {
    if (!winAnimation) return null
    return playerPositions[winAnimation.winnerId] ?? null
  }, [winAnimation, playerPositions])

  // 发牌动画完成回调
  const handleDealingComplete = useCallback(() => {
    stopDealingAnimation()
    setShowPlayerCards(true)
  }, [stopDealingAnimation, setShowPlayerCards])

  // 看牌回调 — 仅发送请求，收到服务端确认后才翻牌
  const handleLookAtCards = useCallback(() => {
    onCheckCards?.()
  }, [onCheckCards])

  // 赢家动画完成回调
  const handleWinAnimationComplete = useCallback(() => {
    clearWinAnimation()
  }, [clearWinAnimation])

  return (
    <div className={`relative w-full h-full ${className}`}>
      {/* 牌桌由背景图 game-bg.jpg 提供，无需 CSS 绘制 */}

      {/* 底池 + 行动日志 — 上方正中间合并面板 */}
      <div className="absolute left-1/2 -translate-x-1/2 z-[25]"
        style={{ top: '40px' }}
      >
        <GameInfoPanel />
      </div>

      {/* 玩家座位 */}
      {orderedPlayers.map((player, index) => {
        const isHuman = player.player_type === 'human'
        // AI 在 orderedPlayers 中的顺序索引（0-based，跳过 human）
        const aiOrderIndex = isHuman ? -1 : orderedPlayers.slice(0, index).filter(p => p.player_type !== 'human').length
        // 映射到固定位置的 slot 索引（用于角色图片分配）
        const aiCount = Math.min(orderedPlayers.filter(p => p.player_type !== 'human').length, 5)
        const assignment = aiCount > 0 ? (AI_SEAT_ASSIGNMENT[aiCount] ?? AI_SEAT_ASSIGNMENT[5]) : []
        const fixedSlotIndex = isHuman ? -1 : (assignment[aiOrderIndex] ?? aiOrderIndex)

        return (
          <PlayerSeat
            key={player.id}
            player={player}
            cardPosition={seatPositions[index].card}
            characterPosition={isHuman ? undefined : seatPositions[index].character}
            seatIndex={fixedSlotIndex}
            isActive={player.id === currentPlayerId}
            isMe={player.id === myPlayerId}
            isDealer={player.id === dealerId}
            latestMessage={latestMessageByPlayer[player.id] ?? null}
            myCards={player.id === myPlayerId ? myCards : undefined}
            onLookAtCards={player.id === myPlayerId ? handleLookAtCards : undefined}
            onClick={
              isCompareMode
                ? () => setCompareTarget(player.id)
                : undefined
            }
          />
        )
      })}

      {/* 发牌动画（使用牌位置坐标） */}
      <DealingAnimation
        seatPositions={seatPositions.map(s => s.card)}
        playerCount={orderedPlayers.length}
        onComplete={handleDealingComplete}
      />

      {/* 下注筹码飞行动画 */}
      <ChipFlyAnimation playerPositions={playerPositions} />

      {/* 赢家筹码飞行动画 */}
      <WinChipAnimation
        winnerPosition={winnerPosition}
        amount={winAnimation?.amount ?? 0}
        isPlaying={winAnimation?.isPlaying ?? false}
        onComplete={handleWinAnimationComplete}
      />

      {/* 游戏等待提示 */}
      {players.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-[var(--text-muted)] text-lg">等待游戏开始...</div>
        </div>
      )}
    </div>
  )
}
