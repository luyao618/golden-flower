import { StrictMode, useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Button from '../Button'
import Dialog from '../Dialog'
import Field from '../Field'
import Status from '../Status'
import Tabs from '../Tabs'
import { installDialogTestApi } from '../../test/dialog'

// jsdom has no top layer/inert or native modal keyboard behavior; browser tests
// separately exercise those. Only model the native open/close API here.
let restoreDialog: () => void
beforeEach(() => { restoreDialog = installDialogTestApi() })
afterEach(() => {
  cleanup()
  restoreDialog()
  vi.restoreAllMocks()
})

function DialogExample({ initialInput = false }: { initialInput?: boolean }) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return <>
    <Button onClick={() => setOpen(true)}>打开说明</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="牌室说明"
      description="这里只展示固定场景。" initialFocusRef={initialInput ? input : undefined}>
      <Field ref={input} label="称呼" />
      <Button onClick={() => setOpen(false)}>完成</Button>
    </Dialog>
  </>
}

describe('accessible primitives', () => {
  it('uses a safe button type and prevents duplicate busy actions', async () => {
    const action = vi.fn()
    const view = render(<Button busy onClick={action}>保存</Button>)
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(action).not.toHaveBeenCalled()
    view.rerender(<Button onClick={action}>保存</Button>)
    await userEvent.click(button)
    expect(action).toHaveBeenCalledOnce()
  })

  it('associates field labels, help, errors and caller descriptions', () => {
    render(<><p id="extra">仅保存在本页。</p>
      <Field label="称呼" hint="最多 12 字。" error="请输入称呼。" required aria-describedby="extra" />
    </>)
    const input = screen.getByRole('textbox', { name: '称呼' })
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('仅保存在本页。 最多 12 字。 请输入称呼。')
  })

  it('focuses a safe heading, traps both Tab directions, cancels and restores the opener in StrictMode', async () => {
    const user = userEvent.setup()
    render(<StrictMode><DialogExample /></StrictMode>)
    const trigger = screen.getByRole('button', { name: '打开说明' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '牌室说明' })
    expect(dialog).toHaveAccessibleDescription('这里只展示固定场景。')
    expect(screen.getByRole('heading', { name: '牌室说明' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: '完成' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '关闭牌室说明' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('textbox')).toHaveFocus()
    fireEvent(dialog, new Event('cancel', { cancelable: true, bubbles: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(trigger).toHaveFocus()
  })

  it('supports explicit initial focus and cleans up an open dialog on unmount', async () => {
    document.body.style.overflow = 'auto'
    const view = render(<DialogExample initialInput />)
    await userEvent.click(screen.getByRole('button', { name: '打开说明' }))
    expect(screen.getByRole('textbox')).toHaveFocus()
    view.unmount()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('uses one tab stop, wraps with arrows, skips disabled tabs and supports Home/End', async () => {
    const user = userEvent.setup()
    render(<Tabs label="场景信息" items={[
      { id: 'overview', label: '概览', content: <p>概览内容</p> },
      { id: 'later', label: '稍后', content: <p>不可用</p>, disabled: true },
      { id: 'details', label: '详情', content: <p>详情内容</p> },
    ]} />)
    await user.tab()
    const overview = screen.getByRole('tab', { name: '概览' })
    const details = screen.getByRole('tab', { name: '详情' })
    expect(overview).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(details).toHaveFocus()
    expect(details).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('详情')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('详情内容')
    expect(overview).toHaveAttribute('tabindex', '-1')
    await user.keyboard('{ArrowRight}')
    expect(overview).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(details).toHaveFocus()
    await user.keyboard('{Home}')
    expect(overview).toHaveFocus()
    await user.keyboard('{End}')
    expect(details).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('tabpanel')).toHaveFocus()
  })

  it('announces status politely and only blocking errors assertively, with visible text', () => {
    const view = render(<Status>示例已载入</Status>)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    view.rerender(<Status tone="danger">无法打开场景，请返回牌室。</Status>)
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开场景，请返回牌室。')
  })
})
