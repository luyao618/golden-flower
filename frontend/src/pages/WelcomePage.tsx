// ============================================================
// 欢迎页面 - 使用真实大厅配置创建游戏
// ============================================================

import { useState } from 'react'
import ModelConfigPanel from '../components/Lobby/ModelConfigPanel'
import GameConfigForm from '../components/Lobby/GameConfigForm'
import ChipsConfig from '../components/Lobby/ChipsConfig'
import StartButton from '../components/Lobby/StartButton'
import GameSettingsModal from '../components/Lobby/GameSettingsModal'
import lobbyBg from '../assets/lobby-bg.jpeg'

export default function WelcomePage() {
  const [configOpen, setConfigOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[var(--bg-deepest)] flex flex-col items-center p-4 relative">
      {/* 背景图 — object-position 往下偏移，露出机器人和牌桌 */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={lobbyBg}
          alt=""
          className="w-full h-full object-cover"
          style={{ objectPosition: 'center 80%', filter: 'brightness(1.0) contrast(1.12) saturate(1.1)' }}
        />
        {/* 暗色叠加层 — 极轻压暗，保持背景明亮 */}
        <div className="absolute inset-0"
          style={{
            background: `
              linear-gradient(to bottom, rgba(5,5,15,0.06) 0%, rgba(5,5,15,0.10) 50%, rgba(5,5,15,0.25) 100%)
            `
          }}
        />
      </div>

      {/* 标题区域 — 放在顶部暗色区域 */}
      <div className="relative z-10 flex flex-col items-center mt-10 mb-4">
        {/* 主标题 — 霓虹灯招牌闪烁风格 */}
        <h1 className="text-4xl sm:text-7xl font-black neon-sign-flicker tracking-widest mb-3"
            style={{ fontFamily: 'var(--font-display)' }}>
           大模型炸金花
        </h1>

        {/* 副标题 */}
        <p className="text-[var(--text-secondary)] text-base tracking-[0.3em] uppercase mb-4"
           style={{ fontFamily: 'var(--font-display)' }}>
          LLM Golden Flower Poker
        </p>

        {/* 装饰线 */}
        <div className="title-deco-line w-64 rounded-full" />
      </div>

      <div className="relative z-10 w-full max-w-xl space-y-4 bg-black/60 rounded-xl p-4 mb-4">
        <GameConfigForm />
        <ChipsConfig />
        <StartButton onNeedModelConfig={() => setConfigOpen(true)} />
      </div>

      <div className="relative z-10 flex flex-col gap-3 w-full max-w-sm mb-8">
        {/* 配置模型 — 紫色霓虹 */}
        <button
          onClick={() => setConfigOpen(true)}
          className="welcome-btn welcome-btn-primary py-4 flex items-center justify-center gap-3 cursor-pointer active:scale-[0.98]"
          style={{ background: 'rgba(139, 92, 246, 0.08)' }}
        >
          <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
               style={{ color: '#f0e4ff', filter: 'drop-shadow(0 0 6px rgba(139,92,246,0.8)) drop-shadow(0 0 14px rgba(139,92,246,0.5))' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xl font-black tracking-[0.25em]"
                style={{ fontFamily: 'var(--font-display)', color: '#f0e4ff', textShadow: '0 0 10px rgba(139,92,246,0.9), 0 0 30px rgba(139,92,246,0.6), 0 0 60px rgba(139,92,246,0.3)' }}>
            配 置 模 型
          </span>
        </button>

        {/* 游戏设置 — 金色霓虹（改为弹窗模式） */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="welcome-btn py-3.5 flex items-center justify-center gap-3 cursor-pointer active:scale-[0.98]"
          style={{ background: 'rgba(255, 185, 0, 0.06)' }}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
               style={{ color: '#fff0c0', filter: 'drop-shadow(0 0 6px rgba(255,185,0,0.8)) drop-shadow(0 0 14px rgba(255,185,0,0.5))' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-xl font-black tracking-[0.25em]"
                style={{ fontFamily: 'var(--font-display)', color: '#fff0c0', textShadow: '0 0 10px rgba(255,185,0,0.9), 0 0 30px rgba(255,185,0,0.6), 0 0 60px rgba(255,185,0,0.3)' }}>
            游 戏 设 置
          </span>
        </button>
      </div>

      {/* 底部版本号 */}
      <p className="text-[var(--text-disabled)] text-xs pb-4 relative z-10 tracking-wider">
        LLM Golden Flower Poker v0.1
      </p>

      {/* 模型配置面板 */}
      <ModelConfigPanel open={configOpen} onClose={() => setConfigOpen(false)} />

      {/* 游戏设置（Max Token 等）弹窗 */}
      <GameSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
