import { expect, type Page } from '@playwright/test'
import type { Card, GameState } from '../../src/types/game'

interface LiveProvider {
  provider: 'openrouter' | 'siliconflow'
  model: string
  key: string
}

/** Never discover credentials from .env, saved profiles, or other variables. */
export function readLiveProvider(): { config?: LiveProvider; reason: string } {
  const provider = process.env.GF_LIVE_PROVIDER?.trim().toLowerCase()
  const model = process.env.GF_LIVE_MODEL?.trim()
  const key = process.env.GF_LIVE_KEY?.trim()
  if (!provider || !model || !key) {
    return { reason: 'UNMET real-provider gate: supply GF_LIVE_PROVIDER, GF_LIVE_MODEL and GF_LIVE_KEY; a skipped test is not live acceptance.' }
  }
  if (provider !== 'openrouter' && provider !== 'siliconflow') {
    return { reason: 'UNMET real-provider gate: this three-variable runner supports OpenRouter and SiliconFlow only; Azure needs endpoint configuration and Copilot needs interactive OAuth.' }
  }
  return { config: { provider, model, key }, reason: '' }
}

export function isEndpoint(url: string, path: string): boolean {
  return new URL(url).pathname === path
}

/** Configure the real provider and model registry exclusively through visible UI. */
export async function configureProvider(page: Page, config: LiveProvider): Promise<string> {
  await page.getByRole('button', { name: /配\s*置\s*模\s*型/ }).click()
  await page.getByRole('button', { name: config.provider === 'openrouter' ? /OpenRouter/ : /SiliconFlow/ }).click()
  await page.locator('input[type="password"]').fill(config.key)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  // Saving refreshes provider status and remounts the section; its success toast
  // is transient, while the Remove Key control reflects the saved configuration.
  await expect(page.getByRole('button', { name: '移除 Key', exact: true })).toBeVisible()

  const verified = page.waitForResponse(response =>
    isEndpoint(response.url(), `/api/providers/${config.provider}/verify`) && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  const verification = await verified
  expect(verification.ok(), 'Provider verification HTTP success').toBe(true)
  expect((await verification.json()).valid === true, 'Provider key must verify successfully').toBe(true)

  await page.getByPlaceholder('搜索模型名称...').fill(config.model)
  const escapedModel = config.model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const modelId = page.locator('span').filter({ hasText: new RegExp(`^${escapedModel}(?:\\s*\\| ctx:.*)?$`) }).last()
  const row = modelId.locator('..').locator('..')
  const added = page.waitForResponse(response =>
    isEndpoint(response.url(), `/api/${config.provider}/models`) && response.request().method() === 'POST',
  )
  await row.getByRole('button', { name: '添加', exact: true }).click()
  const response = await added
  expect(response.ok(), 'Selected catalog model is added to the real registry').toBe(true)
  const result = await response.json() as { model_id: string }
  expect(typeof result.model_id === 'string' && result.model_id.length > 0).toBe(true)
  await page.getByRole('button', { name: '完成', exact: true }).click()
  return result.model_id
}

interface WireFrame {
  direction: 'received' | 'sent'
  type: string
  data: Record<string, unknown>
}

const frameTypes = new Set([
  'game_state', 'game_started', 'round_started', 'cards_dealt', 'turn_changed',
  'player_acted', 'round_ended', 'game_ended', 'ai_thinking', 'ai_reviewing',
  'chat_message', 'error', 'copilot_error', 'player_action', 'start_round',
])
const actions = new Set(['check_cards', 'call', 'raise', 'fold', 'compare'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const safeId = (value: unknown) => typeof value === 'string' && uuid.test(value) ? value : undefined

/** Raw frames stay in memory. Never record URLs, headers or console output. */
export function observeGame(page: Page) {
  const frames: WireFrame[] = []
  const connections: Array<{ gameId?: string; playerId?: string }> = []
  page.on('websocket', socket => {
    const url = new URL(socket.url())
    if (!url.pathname.startsWith('/ws/')) return
    connections.push({ gameId: safeId(url.pathname.slice(4)), playerId: safeId(url.searchParams.get('player_id')) })
    const collect = (direction: WireFrame['direction'], payload: string | Buffer) => {
      try {
        const frame = JSON.parse(payload.toString()) as { type?: unknown; data?: unknown }
        if (typeof frame.type !== 'string') return
        frames.push({
          direction,
          type: frame.type,
          data: frame.data && typeof frame.data === 'object' ? frame.data as Record<string, unknown> : {},
        })
      } catch {
        // Non-JSON traffic is neither evidence nor safe report content.
      }
    }
    socket.on('framereceived', ({ payload }) => collect('received', payload))
    socket.on('framesent', ({ payload }) => collect('sent', payload))
  })
  return {
    frames,
    connections,
    async waitFor(predicate: (frame: WireFrame) => boolean, after = 0) {
      await expect.poll(() => frames.slice(after).some(predicate), { timeout: 150000, message: 'Expected live protocol event' }).toBe(true)
      return frames.slice(after).find(predicate)!
    },
    sanitized() {
      return {
        connections,
        sequence: frames.map((frame, index) => ({
          index,
          direction: frame.direction,
          type: frameTypes.has(frame.type) ? frame.type : 'other',
          gameId: safeId(frame.data.game_id),
          playerId: safeId(frame.data.player_id ?? frame.data.current_player_id),
          winnerId: safeId(frame.data.winner_id),
          round: Number.isInteger(frame.data.round_number) ? frame.data.round_number : undefined,
          action: typeof frame.data.action === 'string' && actions.has(frame.data.action) ? frame.data.action : undefined,
          isFallback: typeof frame.data.is_fallback === 'boolean' ? frame.data.is_fallback : undefined,
        })),
      }
    },
  }
}

export async function viewerState(page: Page, gameId: string, playerId: string): Promise<GameState> {
  const response = await page.request.get(`/api/game/${encodeURIComponent(gameId)}?player_id=${encodeURIComponent(playerId)}`)
  expect(response.ok(), 'Viewer-scoped REST snapshot succeeds').toBe(true)
  return response.json() as Promise<GameState>
}

/** Compare visible ranks/suits without putting private values in assertion output. */
export async function expectSeenCards(page: Page, cards: Card[]): Promise<void> {
  const suits = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
  const ranks: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
  const expected = cards.map(card => `${ranks[card.rank] ?? card.rank}${suits[card.suit]}`)
  expect(cards.length, 'Server supplied a complete human hand').toBe(3)
  await expect.poll(async () => {
    const actual = await page.locator('.card-size-md .card-inner.flipped .card-corner-top').allTextContents()
    return JSON.stringify(actual) === JSON.stringify(expected)
  }, { message: 'Three visible human cards match the viewer snapshot' }).toBe(true)
}
