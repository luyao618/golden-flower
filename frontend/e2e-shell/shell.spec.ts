import { readFile, readdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('production outputs contain only their selected application; legacy still opens', async ({ page }, testInfo) => {
  const legacyAssets = await readdir('.shell-preview/legacy/assets')
  const rebuildAssets = await readdir('.shell-preview/rebuild/assets')
  expect(legacyAssets.some((name) => /WebGameApp|ScenarioPage|HomePage/.test(name))).toBe(false)
  expect(rebuildAssets.some((name) => /LegacyApp|lobby-bg|game-bg|result-bg/.test(name))).toBe(false)
  expect(await readFile('.shell-preview/legacy/index.html', 'utf8')).toContain('https://fonts.googleapis.com')
  expect(await readFile('.shell-preview/rebuild/index.html', 'utf8')).not.toContain('https://fonts.')
  // Preserve legacy font links, but make this offline preview deterministic.
  await page.route('https://fonts.*/**', (route) => route.abort())
  await page.goto(`http://127.0.0.1:${process.env.SHELL_LEGACY_PORT ?? 4292}`)
  await expect(page.getByRole('heading', { name: '大模型炸金花' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开 始 游 戏' })).toBeVisible()
  await expect(page.locator('.gf-app')).toHaveCount(0)
  await expect(page.locator('.welcome-btn')).toHaveCount(3)
  await page.screenshot({ path: testInfo.outputPath('legacy-desktop.png'), fullPage: true })
  // A legacy direct route remains on the original router.
  await page.goto(`http://127.0.0.1:${process.env.SHELL_LEGACY_PORT ?? 4292}/demo/cards`)
  await expect(page.locator('.gf-app')).toHaveCount(0)
  await expect(page.getByRole('heading').first()).toBeVisible()
})

test.describe('offline rebuild preview', () => {
  let transport: string[]
  let errors: string[]
  let requests: string[]
  test.beforeEach(async ({ page, baseURL }) => {
    transport = []
    errors = []
    requests = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('websocket', (socket) => transport.push(socket.url()))
    page.on('request', (request) => {
      requests.push(request.url())
      if (!request.url().startsWith(`${baseURL}/`) || ['fetch', 'xhr', 'ping', 'eventsource'].includes(request.resourceType())
        || /\/(api|ws)(\/|\?|$)/.test(new URL(request.url()).pathname)) transport.push(request.url())
    })
    await page.addInitScript(() => {
      const attempts: string[] = []
      Object.defineProperty(window, '__gfTransportAttempts', { value: attempts })
      const fail = () => {
        attempts.push('attempt')
        throw new Error('Live transport is forbidden in a shell scenario')
      }
      window.fetch = fail
      window.WebSocket = class { constructor() { fail() } } as unknown as typeof WebSocket
      window.XMLHttpRequest = class { constructor() { fail() } } as unknown as typeof XMLHttpRequest
      window.EventSource = class { constructor() { fail() } } as unknown as typeof EventSource
      navigator.sendBeacon = fail
    })
  })
  test.afterEach(async ({ page }) => {
    expect(transport).toEqual([])
    expect(errors).toEqual([])
    expect(await page.evaluate(() => Reflect.get(window, '__gfTransportAttempts'))).toEqual([])
  })

  test('loads scenario code on navigation, supports back/forward and direct refresh', async ({ page }, testInfo) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /三张牌，\s*一场心局。/ })).toBeVisible()
    expect(requests.some((url) => url.includes('ScenarioPage-'))).toBe(false)
    await expect(page.locator('.welcome-btn')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('home-desktop.png'), fullPage: true })
    await page.getByRole('link', { name: /浏览场景/ }).click()
    await expect(page.getByRole('heading', { name: '等待入席' })).toBeFocused()
    expect(requests.some((url) => url.includes('ScenarioPage-'))).toBe(true)
    await page.goBack()
    await expect(page.getByRole('heading', { name: /三张牌，\s*一场心局。/ })).toBeFocused()
    await page.goForward()
    await expect(page.getByRole('heading', { name: '等待入席' })).toBeFocused()
    await page.reload()
    await expect(page.getByRole('heading', { name: '等待入席' })).toBeVisible()
    await page.getByRole('link', { name: '六人同席' }).click()
    await expect(page.getByRole('list', { name: '席位名册' }).getByRole('listitem')).toHaveCount(6)
    await page.screenshot({ path: testInfo.outputPath('six-seats-desktop.png'), fullPage: true })
  })

  test('native modal traps focus, makes the background inert, handles Escape and restores focus', async ({ page }, testInfo) => {
    await page.goto('/scenarios/seen')
    const opener = page.getByRole('button', { name: '添加便签' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: '场景便签' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading')).toBeFocused()
    await expect(page.locator('dialog:modal')).toHaveCount(1)
    // Native inertness prevents even a programmatic background focus attempt.
    await page.getByRole('link', { name: '大模型炸金花 · 牌室首页' }).evaluate((element) => (element as HTMLElement).focus())
    await expect(dialog.getByRole('heading')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: '保存便签' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: '关闭场景便签' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('textbox', { name: '便签内容' })).toBeFocused()
    await page.keyboard.type('A quiet hand')
    await page.screenshot({ path: testInfo.outputPath('dialog-desktop.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(opener).toBeFocused()
    await opener.click()
    await dialog.getByRole('textbox').fill('只在这里')
    await dialog.getByRole('button', { name: '保存便签' }).click()
    await expect(page.getByRole('button', { name: '编辑便签' })).toBeFocused()
    await expect(page.getByRole('status')).toHaveText(/便签已更新/)
    await page.getByRole('link', { name: '盲牌在手' }).click()
    await expect(page.getByText('只在这里')).toHaveCount(0)
    await expect(page.getByRole('img', { name: '三张未看牌' })).toBeVisible()
    await expect(page.getByRole('img', { name: '黑桃 A' })).toHaveCount(0)
  })

  test('keyboard tabs and skip link work without a mouse', async ({ page }) => {
    await page.goto('/scenarios/seen')
    await expect(page.getByRole('heading', { name: '看牌之后' })).toBeFocused()
    await page.getByRole('tab', { name: '席位与手牌' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: '场景说明' })).toBeFocused()
    await expect(page.getByRole('tabpanel')).toContainText('固定快照')
    await page.keyboard.press('Home')
    await expect(page.getByRole('tab', { name: '席位与手牌' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('tabpanel')).toBeFocused()
    const skip = page.getByRole('link', { name: '跳到主要内容' })
    await skip.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()
  })

  test('six-seat chips reconcile and temporary notes save, edit, cancel and clear without changing them', async ({ page }, testInfo) => {
    await page.goto('/scenarios/six-seats')
    await expect(page.getByRole('heading', { name: '六人同席' })).toBeVisible()
    async function expectConservedChips() {
      const stacks = (await page.getByRole('list', { name: '席位名册' }).locator('.gf-chip-count strong').allTextContents())
        .map((text) => Number(text.replaceAll(',', '')))
      expect(stacks).toEqual([990, 980, 980, 980, 980, 980])
      const pot = Number(await page.locator('.gf-snapshot-facts > div')
        .filter({ has: page.getByText('当前底池', { exact: true }) }).getByRole('definition').textContent())
      expect(pot).toBe(110)
      expect(stacks.reduce((sum, chips) => sum + chips, 0) + pot).toBe(6000)
      await expect(page.locator('.gf-snapshot-facts > div')
        .filter({ has: page.getByText('底注', { exact: true }) }).getByRole('definition')).toHaveText(/^10$/)
    }
    await expectConservedChips()
    const add = page.getByRole('button', { name: '添加便签' })
    const edit = page.getByRole('button', { name: '编辑便签' })
    await expect(add).toHaveAccessibleDescription('便签仅保留在当前页面，刷新或切换场景后清空。')
    await add.click()
    const dialog = page.getByRole('dialog', { name: '场景便签' })
    const field = dialog.getByRole('textbox', { name: '便签内容' })
    await field.fill('记录这一刻')
    await dialog.getByRole('button', { name: '保存便签' }).click()
    await expect(edit).toBeFocused()
    await expect(page.locator('.gf-note')).toHaveText('记录这一刻')
    await edit.click()
    await expect(field).toHaveValue('记录这一刻')
    await field.fill('不保存的修改')
    await page.keyboard.press('Escape')
    await expect(edit).toBeFocused()
    await expect(page.locator('.gf-note')).toHaveText('记录这一刻')
    await edit.click()
    await expect(field).toHaveValue('记录这一刻')
    await field.fill('取消修改')
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(page.locator('.gf-note')).toHaveText('记录这一刻')
    await edit.click()
    await expect(field).toHaveValue('记录这一刻')
    await field.fill('5,890 筹码 + 110 底池 = 6,000')
    await dialog.getByRole('button', { name: '保存便签' }).click()
    await expect(edit).toBeFocused()
    await expect(page.locator('.gf-note')).toHaveText('5,890 筹码 + 110 底池 = 6,000')
    await expectConservedChips()
    // Start the full-page capture at the top so offscreen fixed controls stay offscreen.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('six-seats-note-saved.png'), fullPage: true })
    await page.reload()
    await expect(add).toBeVisible()
    await expect(page.locator('.gf-note')).toHaveCount(0)
    await expectConservedChips()
    await add.click()
    await field.fill('切换场景后清空')
    await dialog.getByRole('button', { name: '保存便签' }).click()
    await page.getByRole('link', { name: '等待入席' }).click()
    await page.getByRole('link', { name: '六人同席' }).click()
    await expect(add).toBeVisible()
    await expect(page.locator('.gf-note')).toHaveCount(0)
    await expectConservedChips()
  })

  test('remaining direct URLs stay offline and never substitute a fixture for a live ID', async ({ page }) => {
    for (const [path, title] of [
      ['/scenarios/blind', '盲牌在手'], ['/scenarios/settlement', '本局落定'],
      ['/scenarios/compare-private', '旁观比牌'], ['/game/fixture-game', '这里还未开放实战'],
      ['/result/fixture-game', '这里还未开放实战'], ['/scenarios/missing', '没有找到这一页'],
    ]) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
      if (!path.startsWith('/scenarios/')) await expect(page.getByRole('list', { name: '席位名册' })).toHaveCount(0)
    }
  })

  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900], [1920, 1080], [844, 390]]) {
    test(`home, six seats and open sheet fit ${width}×${height}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height })
      for (const path of ['/', '/scenarios/six-seats']) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`${path === '/' ? 'home' : 'six-seats'}-${width}.png`), fullPage: true })
      }
      await page.getByRole('button', { name: '添加便签' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const bounds = await dialog.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height)
      await dialog.getByRole('textbox').fill('小屏幕也能从容阅读。')
      await page.screenshot({ path: testInfo.outputPath(`sheet-${width}.png`) })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: '添加便签' })).toBeFocused()
    })
  }
})
