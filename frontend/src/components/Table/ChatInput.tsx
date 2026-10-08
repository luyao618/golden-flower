// ============================================================
// 聊天输入组件 (T6.4)
//
// 玩家输入框 + 发送按钮。
// 支持 Enter 发送，Shift+Enter 换行。
// ============================================================

import { useState, useCallback, useRef, type KeyboardEvent } from 'react'

interface ChatInputProps {
  /** 发送消息的回调 */
  onSend: (content: string) => boolean | void
  /** 是否禁用（如未连接时） */
  disabled?: boolean
  /** 占位符文本 */
  placeholder?: string
}

/**
 * 聊天输入框
 * 支持 Enter 发送，Shift+Enter 换行
 */
export default function ChatInput({
  onSend,
  disabled = false,
  placeholder = '说点什么...',
}: ChatInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return

    if (onSend(trimmed) === false) return
    setText('')
    inputRef.current?.focus()
  }, [text, disabled, onSend])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex items-center gap-2 px-2 py-2 border-t border-green-800/40 bg-black/20">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={200}
        className={`
          flex-1 bg-green-900/40 border border-green-700/40
          rounded-lg px-3 py-1.5 text-xs text-white/90
          placeholder:text-green-700/50
          focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors
        `}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className={`
          px-3 py-1.5 rounded-lg text-xs font-medium
          transition-all duration-200 cursor-pointer
          ${
            text.trim() && !disabled
              ? 'bg-green-600 hover:bg-green-500 text-white shadow-sm'
              : 'bg-green-800/30 text-green-700/40 cursor-not-allowed'
          }
        `}
      >
        发送
      </button>
    </div>
  )
}
