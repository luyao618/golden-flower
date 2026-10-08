import { test, expect } from '@playwright/test'
import type { CreateGameResponse, GameState, RoundResult } from '../src/types/game'
import { configureProvider, expectSeenCards, isEndpoint, observeGame, readLiveProvider, viewerState } from './support/liveGame'

const live = readLiveProvider()
test.skip(!live.config, live.reason)

test('real provider: create, deal, act, restore seen hand, settle and deal again', async ({ browser }, testInfo) => {
  if (!live.config) return

  // Close our context before surfacing failures, preventing automatic error-context
  // DOM snapshots from including cards, chat, or credential-panel key previews.
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.setDefaultNavigationTimeout(15000)
  const observed = observeGame(page)
  let phase = 'visible provider configuration'
  let failed = false
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '大模型炸金花', exact: true })).toBeVisible()
    const modelId = await configureProvider(page, live.config)
    while (await page.getByRole('button', { name: '移除', exact: true }).count()) {
      await page.getByRole('button', { name: '移除', exact: true }).last().click()
    }
    await page.getByRole('combobox').selectOption(modelId)
    await page.getByPlaceholder('人类一败涂地').fill('验收玩家')
    await page.getByPlaceholder('自定义名称').fill('验收对手')
    await page.getByRole('button', { name: /标准局/ }).click()

    phase = 'one real create request and returned identities'
    let createRequests = 0
    page.on('request', request => {
      if (request.method() === 'POST' && isEndpoint(request.url(), '/api/game/create')) createRequests++
    })
    const createdResponse = page.waitForResponse(response =>
      isEndpoint(response.url(), '/api/game/create') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '开始游戏', exact: true }).click()
    const response = await createdResponse
    expect(response.ok()).toBe(true)
    const created = await response.json() as CreateGameResponse
    const human = created.players.find(player => player.player_type === 'human')!
    const ai = created.players.find(player => player.player_type === 'ai')!
    expect(created.players.length).toBe(2)
    expect(human.name === '验收玩家' && ai.name === '验收对手' && ai.model_id === modelId).toBe(true)
    expect(/^[0-9a-f-]{36}$/i.test(created.game_id)).toBe(true)
    await expect(page).toHaveURL(`/game/${created.game_id}`)
    await observed.waitFor(frame => frame.type === 'game_state' && frame.data.game_id === created.game_id)
    expect(observed.connections.some(connection => connection.gameId === created.game_id && connection.playerId === human.id)).toBe(true)
    expect(createRequests).toBe(1)
    const initial = await viewerState(page, created.game_id, human.id)
    expect(initial.status === 'waiting' && initial.current_round === null).toBe(true)
    expect(initial.players.every(player => player.chips === 1000)).toBe(true)
    expect(initial.config).toEqual({ initial_chips: 1000, ante: 10, max_bet: 200, max_turns: 10 })

    let humanCovered = false
    let firstSettlement: GameState | undefined
    let previousDealer: number | undefined
    // A natural AI fold can end hand 1 before a human opportunity. In hand 2,
    // dealer rotation makes the human first; no LLM or server state is scripted.
    for (let round = 1; round <= 2; round++) {
      phase = `real deal ${round}`
      const offset = observed.frames.length
      await page.getByRole('button', { name: round === 1 ? '开始第一局' : '开始下一局', exact: true }).click()
      const started = await observed.waitFor(frame => frame.type === 'round_started' && frame.data.round_number === round, offset)
      const dealtState = await observed.waitFor(frame => frame.type === 'game_state' && (frame.data.current_round as { round_number?: number } | null)?.round_number === round, offset)
      await observed.waitFor(frame => frame.type === 'cards_dealt', offset)
      const dealt = dealtState.data as unknown as GameState
      expect(dealt.game_id === created.game_id && started.data.pot === 20).toBe(true)
      expect(dealt.players.reduce((total, player) => total + player.chips, 0) + (dealt.current_round?.pot ?? 0)).toBe(2000)
      if (round === 2) {
        expect(started.data.dealer_index).toBe((previousDealer! + 1) % 2)
        expect(dealt.players.every(player => player.chips === firstSettlement!.players.find(previous => previous.id === player.id)!.chips - 10)).toBe(true)
        // Hold hand 2 on the human turn past the former settlement timer window.
        const stableUntil = Date.now() + 3500
        await expect.poll(async () => {
          expect(await page.getByRole('button', { name: /跟注/ }).isEnabled()).toBe(true)
          const current = await viewerState(page, created.game_id, human.id)
          expect(current.current_round?.round_number).toBe(2)
          expect(current.players.reduce((total, player) => total + player.chips, 0) + current.current_round!.pot).toBe(2000)
          return Date.now() >= stableUntil
        }).toBe(true)
        if (humanCovered) break
      }
      previousDealer = started.data.dealer_index as number

      phase = `AI or human turn ${round}`
      const opportunity = await observed.waitFor(frame =>
        frame.type === 'round_ended' || (frame.type === 'turn_changed' && frame.data.current_player_id === human.id), offset,
      )
      if (opportunity.type !== 'round_ended') {
        phase = 'accepted peek and reload restoration'
        await expect(page.locator('.card-size-md')).toHaveCount(3)
        await expect(page.locator('.card-size-md .card-inner.flipped')).toHaveCount(0)
        const before = await viewerState(page, created.game_id, human.id)
        const peekOffset = observed.frames.length
        await page.getByRole('button', { name: /看牌/ }).click()
        await observed.waitFor(frame => frame.type === 'player_acted' && frame.data.player_id === human.id && frame.data.action === 'check_cards' && frame.data.amount === 0, peekOffset)
        const seen = await viewerState(page, created.game_id, human.id)
        const seenHuman = seen.players.find(player => player.id === human.id)!
        expect(seenHuman.status === 'active_seen' && seenHuman.chips === before.players.find(player => player.id === human.id)!.chips).toBe(true)
        expect(seen.current_round?.current_player_index).toBe(before.current_round?.current_player_index)
        await expectSeenCards(page, seenHuman.hand!)
        const reloadOffset = observed.frames.length
        await page.reload()
        await observed.waitFor(frame => frame.type === 'game_state' && frame.data.game_id === created.game_id, reloadOffset)
        await observed.waitFor(frame => frame.type === 'turn_changed' && frame.data.current_player_id === human.id, reloadOffset)
        await expectSeenCards(page, seenHuman.hand!)
        expect(observed.connections.at(-1)?.playerId === human.id).toBe(true)
        expect(createRequests).toBe(1)

        phase = 'human call and real AI response'
        const actionOffset = observed.frames.length
        const cost = seen.current_round!.current_bet * 2
        const call = page.getByRole('button', { name: /跟注/ })
        expect((await call.textContent())?.includes(String(cost))).toBe(true)
        await call.click()
        const acceptedCall = await observed.waitFor(frame => frame.type === 'player_acted' && frame.data.player_id === human.id && frame.data.action === 'call' && frame.data.amount === cost, actionOffset)
        humanCovered = true
        const next = await observed.waitFor(frame =>
          frame.type === 'round_ended' || (frame.type === 'turn_changed' && frame.data.current_player_id === human.id), observed.frames.indexOf(acceptedCall) + 1,
        )
        if (next.type !== 'round_ended') {
          phase = 'fold confirmation and cancellation'
          await page.getByRole('button', { name: /弃牌/ }).click()
          await page.getByRole('button', { name: '取消', exact: true }).click()
          expect(observed.frames.slice(actionOffset).some(frame => frame.direction === 'sent' && frame.data.action === 'fold')).toBe(false)
          await page.getByRole('button', { name: /弃牌/ }).click()
          await page.getByRole('button', { name: '确认弃牌', exact: true }).click()
        }
      }

      phase = `settlement ${round}`
      const ended = await observed.waitFor(frame => frame.type === 'round_ended' && frame.data.round_number === round, offset)
      const settled = await viewerState(page, created.game_id, human.id)
      const result = ended.data as unknown as RoundResult
      expect(settled.players.reduce((total, player) => total + player.chips, 0)).toBe(2000)
      expect(settled.round_history.filter(item => item.round_number === round).length).toBe(1)
      const stored = settled.round_history.find(item => item.round_number === round)!
      expect(stored.winner_id === result.winner_id && stored.pot === result.pot && stored.win_method === result.win_method).toBe(true)
      expect(JSON.stringify(stored.player_chip_changes) === JSON.stringify(result.player_chip_changes)).toBe(true)
      for (const player of settled.players) {
        await expect(page.getByText(player.chips.toLocaleString(), { exact: true }).first()).toBeVisible()
      }
      await expect(page.getByRole('button', { name: '开始下一局', exact: true })).toBeEnabled()
      if (round === 1) firstSettlement = settled
    }

    phase = 'non-fallback real-provider acceptance gate'
    expect(humanCovered, 'A human peek, reload and paid action completed').toBe(true)
    expect(observed.frames.some(frame => frame.type === 'player_acted' && frame.data.player_id === ai.id && frame.data.is_fallback === false), 'At least one actual AI decision must be explicitly non-fallback').toBe(true)
    expect(createRequests).toBe(1)
  } catch {
    // Never forward diagnostics that could quote input values or page content.
    failed = true
  } finally {
    await context.close()
    await testInfo.attach('sanitized-live-sequence', {
      body: JSON.stringify(observed.sanitized(), null, 2),
      contentType: 'application/json',
    })
  }
  if (failed) throw new Error(`UNMET live acceptance gate during: ${phase}. See sanitized-live-sequence; raw diagnostics intentionally omitted.`)
})
