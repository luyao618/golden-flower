import { StrictMode } from 'react'
import { cleanup, configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebGameApp from '../WebGameApp'
import { installDialogTestApi } from '../../test/dialog'

// Lazy chunks are transformed on first use, concurrently with the legacy suite.
// This is a wait-for bound, not a sleep or retry of a failed assertion.
configure({ asyncUtilTimeout: 5000 })

// Importing the old app's transport/store graph is itself a failure, even if an
// effect happens not to issue a request in the current scenario.
vi.mock('../../services/api', () => { throw new Error('Legacy API imported') })
vi.mock('../../stores/gameStore', () => { throw new Error('Legacy game store imported') })
vi.mock('../../hooks/useWebSocket', () => { throw new Error('Legacy socket hook imported') })

const network = vi.fn(() => { throw new Error('Scenario attempted live transport') })
let restoreDialog: () => void
beforeEach(() => {
  vi.clearAllMocks()
  for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource']) vi.stubGlobal(name, network)
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: network })
  restoreDialog = installDialogTestApi()
  localStorage.setItem('gf-2c-isolation', 'keep')
})
afterEach(() => {
  cleanup()
  restoreDialog()
  Reflect.deleteProperty(navigator, 'sendBeacon')
  expect(network).not.toHaveBeenCalled()
  expect(localStorage.getItem('gf-2c-isolation')).toBe('keep')
  localStorage.removeItem('gf-2c-isolation')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function visit(path: string) {
  window.history.replaceState(null, '', path)
  return render(<StrictMode><WebGameApp /></StrictMode>)
}

describe('isolated lazy routes', { timeout: 15000 }, () => {
  it('loads home, follows scenario links and moves focus to the new page heading', async () => {
    visit('/')
    // The first route compiles a fresh lazy chunk in Vitest, which can exceed
    // Testing Library's 1s default on a loaded machine.
    expect(await screen.findByRole('heading', { name: /三张牌，\s*一场心局。/ }, { timeout: 5000 })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-CN')
    await userEvent.click(screen.getByRole('link', { name: /浏览场景/ }))
    const heading = await screen.findByRole('heading', { name: '等待入席' })
    expect(heading).toHaveFocus()
    expect(window.location.pathname).toBe('/scenarios/waiting')
    await userEvent.click(screen.getByRole('link', { name: '看牌之后' }))
    expect(await screen.findByRole('heading', { name: '看牌之后' })).toHaveFocus()
    expect(screen.getByRole('img', { name: '黑桃 A' })).toBeInTheDocument()
  })

  it.each([
    ['waiting', '等待入席', 3], ['blind', '盲牌在手', 3],
    ['seen', '看牌之后', 3], ['settlement', '本局落定', 3],
    ['six-seats', '六人同席', 6], ['compare-private', '旁观比牌', 3],
  ])('opens /scenarios/%s directly and never connects to a transport', async (id, title, seats) => {
    visit(`/scenarios/${id}`)
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '席位名册' })).getAllByRole('listitem')).toHaveLength(seats)
    expect(screen.queryByRole('button', { name: /跟注|加注|开始游戏/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '场景说明' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('固定快照')
  })

  it('keeps blind cards out of the DOM and uses exactly the settled fixture balances', async () => {
    const view = visit('/scenarios/blind')
    await screen.findByRole('heading', { name: '盲牌在手' })
    expect(screen.getByRole('img', { name: '三张未看牌' })).toBeInTheDocument()
    expect(screen.queryByLabelText('黑桃 A')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('♠')
    view.unmount()
    visit('/scenarios/settlement')
    await screen.findByRole('heading', { name: '本局落定' })
    const roster = screen.getByRole('list', { name: '席位名册' })
    expect(roster).toHaveTextContent('1,060')
    expect(roster).toHaveTextContent('960')
    expect(roster).toHaveTextContent('980')
  })

  it.each([
    ['six-seats', '六人同席', 6000, 5890, 110],
    ['waiting', '等待入席', 3000, 3000, 0],
  ])('shows stacks plus the actual pot conserving chips in %s', async (id, title, total, stacks, pot) => {
    visit(`/scenarios/${id}`)
    await screen.findByRole('heading', { name: title })
    const roster = screen.getByRole('list', { name: '席位名册' })
    const displayedStacks = [...roster.querySelectorAll('.gf-chip-count strong')]
      .reduce((sum, element) => sum + Number(element.textContent?.replaceAll(',', '')), 0)
    const displayedPot = Number(screen.getByText('当前底池', { selector: 'dt' }).nextElementSibling?.textContent?.replaceAll(',', ''))
    expect(displayedStacks).toBe(stacks)
    expect(displayedPot).toBe(pot)
    expect(displayedStacks + displayedPot).toBe(total)
    expect(screen.getByText('底注', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^10$/)
  })

  it('labels the settled pot as already paid, rather than presenting it as unclaimed chips', async () => {
    visit('/scenarios/settlement')
    await screen.findByRole('heading', { name: '本局落定' })
    expect(screen.getByText('本局底池（已派发）', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^130$/)
    expect(screen.queryByText('当前底池', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it.each(['/game/fixture-game', '/game/real-id', '/result/fixture-game', '/result/real-id'])(
    'preserves %s as an honest placeholder without injecting fixture state', async (path) => {
      visit(path)
      expect(await screen.findByRole('heading', { name: '这里还未开放实战' })).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: '席位名册' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('link', { name: '返回牌室' }))
      expect(await screen.findByRole('heading', { name: /三张牌，\s*一场心局。/ })).toBeInTheDocument()
    },
  )

  it.each(['/scenarios/missing', '/missing'])('gives %s a clear route back', async (path) => {
    visit(path)
    expect(await screen.findByRole('heading', { name: '没有找到这一页' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回牌室' })).toHaveAttribute('href', '/')
  })

  it('resolves the scenario index deterministically', async () => {
    visit('/scenarios')
    expect(await screen.findByRole('heading', { name: '等待入席' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/scenarios/waiting')
  })

  it('validates a local note, restores focus and clears it on the next scenario mount', async () => {
    visit('/scenarios/six-seats')
    const user = userEvent.setup()
    const opener = await screen.findByRole('button', { name: '添加便签' })
    expect(opener).toHaveAccessibleDescription('便签仅保留在当前页面，刷新或切换场景后清空。')
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: '保存便签' }))
    const field = screen.getByRole('textbox', { name: '便签内容' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    await user.type(field, '保留此刻')
    await user.click(screen.getByRole('button', { name: '保存便签' }))
    expect(screen.getByRole('button', { name: '编辑便签' })).toHaveFocus()
    expect(screen.getByText('保留此刻')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '编辑便签' }))
    expect(field).toHaveValue('保留此刻')
    await user.clear(field)
    await user.type(field, '取消这次修改')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByText('保留此刻')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '编辑便签' }))
    expect(field).toHaveValue('保留此刻')
    await user.clear(field)
    await user.type(field, '已更新的便签')
    await user.click(screen.getByRole('button', { name: '保存便签' }))
    expect(screen.getByText('已更新的便签')).toBeVisible()
    expect(screen.getByText('当前底池', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^110$/)
    await user.click(screen.getByRole('link', { name: '盲牌在手' }))
    await user.click(screen.getByRole('link', { name: '六人同席' }))
    expect(screen.queryByText('已更新的便签')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加便签' })).toBeInTheDocument()
  })
})
