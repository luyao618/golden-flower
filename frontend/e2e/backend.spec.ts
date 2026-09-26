import { test, expect } from './backend.fixture'
import {
  decodeCreateGameResponse, decodeGameState, decodeNarrative, decodeServerEvent, decodeThoughtList,
} from '../src/domain/decoders'
import type { ClientCommand, ServerEvent } from '../src/domain/events'
import type { CreateGameResponseDTO, GameStateDTO } from '../src/domain/game'

// Browser transport probe, not a product page or intercepted HTTP/WS replay.
declare global {
  interface Window {
    harnessSocket: WebSocket
    harnessEvents: ServerEvent[]
  }
}

for (const opponents of [1, 5]) {
  test(`${opponents + 1} seats: create → connect → start → peek/call → settlement/read`, async ({ page, backendURL }) => {
    await page.goto(`${backendURL}/__harness__/`)
    const created = await page.evaluate(async (count): Promise<CreateGameResponseDTO> => {
      const response = await fetch('/api/game/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_name: 'Browser human',
          ai_opponents: Array.from({ length: count }, (_, i) => ({
            model_id: 'harness-call-then-fold', name: `Scripted ${i + 1}`,
          })),
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }, opponents)
    expect(decodeCreateGameResponse(created).ok).toBe(true)
    const human = created.players[0]
    const opponent = created.players[1]
    const statePath = `/api/game/${created.game_id}?player_id=${human.id}`
    const readState = () => page.evaluate(async (path): Promise<GameStateDTO> => {
      const response = await fetch(path)
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }, statePath)
    const send = (command: ClientCommand) => page.evaluate((message) => {
      window.harnessSocket.send(JSON.stringify(message))
    }, command)
    const waitFor = async (type: ServerEvent['type'], count = 1) => {
      await page.waitForFunction(({ type, count }) => {
        const error = window.harnessEvents.find((e) => e.type === 'error' || e.type === 'copilot_error')
        if (error) throw new Error(JSON.stringify(error))
        return window.harnessEvents.filter((e) => e.type === type).length >= count
      }, { type, count }, { timeout: 15000 })
    }

    await page.evaluate(({ game_id, humanId }) => new Promise<void>((resolve, reject) => {
      window.harnessEvents = []
      const socket = new WebSocket(`ws://${location.host}/ws/${game_id}?player_id=${humanId}`)
      window.harnessSocket = socket
      socket.onmessage = (event) => window.harnessEvents.push(JSON.parse(event.data))
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('WebSocket connection failed'))
    }), { game_id: created.game_id, humanId: human.id })
    await waitFor('game_state')
    expect((await readState()).current_round).toBeNull()
    await send({ type: 'start_round' })
    await waitFor('turn_changed')
    const betting = await readState()
    expect(betting.current_round?.phase).toBe('betting')
    expect(betting.current_round?.pot).toBe(10 * (1 + 2 * opponents))
    expect(betting.players.slice(1).every((p) => p.hand === null)).toBe(true)
    const turn = await page.evaluate(() => window.harnessEvents.findLast((e) => e.type === 'turn_changed'))
    expect(turn?.data).toMatchObject({
      current_player_id: human.id, available_actions: expect.arrayContaining(['call', 'check_cards']),
    })

    await send({ type: 'player_action', data: { action: 'check_cards' } })
    await waitFor('turn_changed', 2)
    const seen = await readState()
    expect(seen.players[0].chips).toBe(990)
    expect(seen.players[0].hand).toHaveLength(3)
    expect(seen.players[0].status).toBe('active_seen')
    await send({ type: 'player_action', data: { action: 'call' } })
    await waitFor('round_ended')
    await page.waitForFunction(() => {
      const index = window.harnessEvents.findIndex((e) => e.type === 'round_ended')
      return index >= 0 && window.harnessEvents[index + 1]?.type === 'game_state'
    })
    const events = await page.evaluate(() => window.harnessEvents)
    for (const event of events) expect(decodeServerEvent(event).kind).toBe('event')
    const index = events.findIndex((e) => e.type === 'round_ended')
    expect(events.slice(index - 1, index + 2).map((e) => e.type)).toEqual(['game_state', 'round_ended', 'game_state'])
    expect(events[index - 1]).toEqual(events[index + 1])
    expect(events.filter((e) => e.type === 'player_acted').every((e) => !e.data.is_fallback)).toBe(true)
    expect(events.find((e) => e.type === 'player_acted' && e.data.player_id === human.id && e.data.action === 'call')?.data).toMatchObject({ amount: 20 })
    const settled = await readState()
    expect(decodeGameState(settled).ok).toBe(true)
    expect(settled.current_round?.phase).toBe('settlement')
    expect(settled.round_history).toHaveLength(1)
    expect(settled.round_history[0]).toMatchObject({ winner_id: human.id, pot: 30 + 20 * opponents })
    expect(settled.players.map((p) => p.chips)).toEqual([1000 + 20 * opponents, ...Array<number>(opponents).fill(980)])

    const read = (path: string) => page.evaluate(async (path) => {
      const response = await fetch(path)
      return { status: response.status, body: await response.json() }
    }, path)
    const thoughts = await read(`/api/game/${created.game_id}/thoughts/${opponent.id}/round/1`)
    expect(thoughts.status).toBe(200)
    expect(decodeThoughtList(thoughts.body).ok).toBe(true)
    expect(thoughts.body.thoughts.map((t: { decision: string }) => t.decision)).toEqual(['call', 'fold'])
    const narrativePath = `/api/game/${created.game_id}/narrative/${opponent.id}/round/1`
    await expect.poll(async () => (await read(narrativePath)).status).toBe(200)
    expect(decodeNarrative((await read(narrativePath)).body).ok).toBe(true)
    expect((await read(`/api/game/${created.game_id}/summary/${opponent.id}`)).status).toBe(404)
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.harnessSocket.onclose = () => resolve()
      window.harnessSocket.close()
    }))
  })
}
