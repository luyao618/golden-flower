import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createHandReplay } from '../../test/fixtures/gameReplays'
import { createReadFixtures } from '../../test/fixtures/restFixtures'
import type { GameStateDTO } from '../../domain/game'
import type { SettingsDTO } from '../../domain/rest'
import { createHttpClient } from '../http'
import type { HttpClient, RequestContext } from '../http'
import type { KeyProvider } from '../credentials'
import { createGameApi } from '../game'
import { createJournalApi } from '../journal'
import { createSettingsApi } from '../settings'
import { createProviderApi } from '../providers'
import { createModelApi } from '../models'
import { createCopilotApi } from '../copilot'

const gameId = 'game/桌?x=1%2F+#'
const agentId = 'agent/智?x=2%2F+#'
const modelId = 'registry/opaque:模型?revision=2%2F+#'
const gamePath = '/game/game%2F%E6%A1%8C%3Fx%3D1%252F%2B%23'
const agentPath = 'agent%2F%E6%99%BA%3Fx%3D2%252F%2B%23'
const modelPath = 'registry%2Fopaque%3A%E6%A8%A1%E5%9E%8B%3Frevision%3D2%252F%2B%23'
const game = createHandReplay().rest
const reads = createReadFixtures()
const settings: SettingsDTO = { llm_max_tokens: null, ai_thinking_mode: 'fast', llm_timeout: 30,
  llm_max_retries: 0, llm_temperature: 0.7 }
const copilotModels = [{ id: 'copilot-gpt4o', model: 'gpt-4o', display_name: 'Copilot GPT-4o' }]

interface EndpointCase {
  name: string
  path: string
  method: 'GET' | 'POST' | 'DELETE'
  response: unknown
  body?: unknown
  run: (http: HttpClient, options: RequestContext) => Promise<unknown>
}

const cases: EndpointCase[] = [
  { name: 'create game', path: '/game/create', method: 'POST', response: game.createResponse,
    body: game.createRequest, run: (http, o) => createGameApi(http).create(game.createRequest, o) },
  { name: 'viewer state', path: `${gamePath}?player_id=viewer%2F%E4%BA%BA+%3F%26%3D%2B%23%25`,
    method: 'GET', response: game.viewerResponse,
    run: (http, o) => createGameApi(http).getState(gameId, 'viewer/人 ?&=+#%', o) },
  { name: 'start game', path: `${gamePath}/start`, method: 'POST', response: game.startResponse,
    run: (http, o) => createGameApi(http).start(gameId, o) },
  { name: 'REST action', path: `${gamePath}/action`, method: 'POST', response: game.actionResponse,
    body: game.actionRequest, run: (http, o) => createGameApi(http).action(gameId, game.actionRequest, o) },
  { name: 'end game', path: `${gamePath}/end`, method: 'POST', response: game.endResponse,
    run: (http, o) => createGameApi(http).end(gameId, o) },
  { name: 'all thoughts', path: `${gamePath}/thoughts/${agentPath}`, method: 'GET', response: reads.emptyThoughts,
    run: (http, o) => createJournalApi(http).getThoughts(gameId, agentId, o) },
  { name: 'round thoughts', path: `${gamePath}/thoughts/${agentPath}/round/1`, method: 'GET', response: reads.thoughts,
    run: (http, o) => createJournalApi(http).getRoundThoughts(gameId, agentId, 1, o) },
  { name: 'narrative', path: `${gamePath}/narrative/${agentPath}/round/1`, method: 'GET', response: reads.narrative,
    run: (http, o) => createJournalApi(http).getNarrative(gameId, agentId, 1, o) },
  { name: 'summary', path: `${gamePath}/summary/${agentPath}`, method: 'GET', response: reads.emptySummary,
    run: (http, o) => createJournalApi(http).getSummary(gameId, agentId, o) },
  { name: 'reviews', path: `${gamePath}/reviews/${agentPath}`, method: 'GET', response: reads.reviews,
    run: (http, o) => createJournalApi(http).getReviews(gameId, agentId, o) },
  { name: 'all chat', path: `${gamePath}/chat`, method: 'GET', response: reads.chat,
    run: (http, o) => createJournalApi(http).getChat(gameId, o) },
  { name: 'round chat', path: `${gamePath}/chat/round/1`, method: 'GET', response: { ...reads.chat, round_number: 1 },
    run: (http, o) => createJournalApi(http).getRoundChat(gameId, 1, o) },
  { name: 'cancel summaries', path: `${gamePath}/cancel-summaries`, method: 'POST',
    response: { game_id: gameId, cancelled: 0 },
    run: (http, o) => createJournalApi(http).cancelSummaries(gameId, o) },
  { name: 'settings read', path: '/settings', method: 'GET', response: settings,
    run: (http, o) => createSettingsApi(http).get(o) },
  { name: 'settings update', path: '/settings', method: 'POST', response: settings,
    body: { llm_max_tokens: null, llm_max_retries: 0 },
    run: (http, o) => createSettingsApi(http).update({ llm_max_tokens: null, llm_max_retries: 0 }, o) },
  { name: 'registry models', path: '/models', method: 'GET', response: reads.models,
    run: (http, o) => createModelApi(http).getAvailable(o) },
  { name: 'providers', path: '/providers', method: 'GET', response: [
    { provider: 'openrouter', name: 'OpenRouter', configured: false, key_preview: null },
    { provider: 'azure_openai', name: 'Azure OpenAI', configured: true, key_preview: 'fake...masked',
      extra_config: { api_version: '2024-10-21', api_host: '' } },
  ], run: (http, o) => createProviderApi(http).getAll(o) },
  { name: 'copilot connect', path: '/copilot/connect', method: 'POST',
    response: { user_code: 'FAKE-CODE', verification_uri: 'https://github.com/login/device', expires_in: 900 },
    run: (http, o) => createCopilotApi(http).connect(o) },
  { name: 'copilot pending', path: '/copilot/poll', method: 'GET', response: { status: 'pending' },
    run: (http, o) => createCopilotApi(http).poll(o) },
  { name: 'copilot slow down', path: '/copilot/poll', method: 'GET',
    response: { status: 'pending', slow_down: true, interval: 10 },
    run: (http, o) => createCopilotApi(http).poll(o) },
  { name: 'copilot connected', path: '/copilot/poll', method: 'GET', response: { status: 'connected', models: copilotModels },
    run: (http, o) => createCopilotApi(http).poll(o) },
  { name: 'copilot status', path: '/copilot/status', method: 'GET',
    response: { connected: true, has_valid_token: false, models: copilotModels },
    run: (http, o) => createCopilotApi(http).getStatus(o) },
  { name: 'copilot disconnect', path: '/copilot/disconnect', method: 'POST', response: { message: 'Copilot disconnected' },
    run: (http, o) => createCopilotApi(http).disconnect(o) },
]

const families: { provider: KeyProvider, prefix: string, original: string }[] = [
  { provider: 'openrouter', prefix: 'openrouter', original: 'openrouter_id' },
  { provider: 'siliconflow', prefix: 'siliconflow', original: 'siliconflow_id' },
  { provider: 'azure_openai', prefix: 'azure-openai', original: 'azure_id' },
  { provider: 'zhipu', prefix: 'zhipu', original: 'zhipu_id' },
]
for (const { provider, prefix, original } of families) {
  cases.push(
    { name: `${provider} catalog`, path: `/${prefix}/models`, method: 'GET', response: reads.catalog,
      run: (http, o) => createModelApi(http).getCatalog(provider, o) },
    { name: `${provider} registered models`, path: `/${prefix}/models/added`, method: 'GET',
      response: { models: reads.models.filter((model) => model.provider === provider) },
      run: (http, o) => createModelApi(http).getAdded(provider, o) },
    { name: `${provider} add model`, path: `/${prefix}/models`, method: 'POST',
      body: { model_id: 'vendor/original', display_name: '自定义' },
      response: { message: 'added', model_id: modelId, [original]: 'vendor/original', display_name: '自定义' },
      run: (http, o) => createModelApi(http).add(provider, { model_id: 'vendor/original', display_name: '自定义' }, o) },
    { name: `${provider} remove opaque model`, path: `/${prefix}/models/${modelPath}`, method: 'DELETE',
      response: { message: 'removed', model_id: modelId },
      run: (http, o) => createModelApi(http).remove(provider, modelId, o) },
    { name: `${provider} verify header key`, path: `/providers/${provider}/verify`, method: 'POST',
      body: { key: null }, response: { valid: false, message: 'Invalid API Key' },
      run: (http, o) => createProviderApi(http).verify(provider, null, o) },
    { name: `${provider} configure`, path: `/providers/${provider}/config`, method: 'POST',
      body: { api_host: 'https://example.invalid', api_version: '2024-10-21' },
      response: { message: 'updated', provider, extra_config: { api_host: 'https://example.invalid', api_version: '2024-10-21' } },
      run: (http, o) => createProviderApi(http).configure(provider, { api_host: 'https://example.invalid', api_version: '2024-10-21' }, o) },
  )
}

describe('typed REST adapters', () => {
  it.each(cases)('$name: URL, verb, body, credentials, signal and decoded response', async (test) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(test.response)))
    const http = createHttpClient({ fetch, getProviderKeys: () => ({ zhipu: 'fake-key' }) })
    const signal = new AbortController().signal
    await expect(test.run(http, { signal })).resolves.toEqual(test.response)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`/api${test.path}`)
    expect(init).toMatchObject({ method: test.method, signal })
    expect(init?.body).toBe(test.body === undefined ? undefined : JSON.stringify(test.body))
    expect(JSON.parse(new Headers(init?.headers).get('X-Provider-Keys')!)).toEqual({ zhipu: 'fake-key' })
  })

  it.each(cases)('$name: rejects a malformed success and supports cancellation', async (test) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"unexpected":true}'))
    const http = createHttpClient({ fetch })
    await expect(test.run(http, {})).rejects.toMatchObject({ kind: 'invalid-response' })
    await expect(test.run(http, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('requires a viewer at compile time and rejects empty/missing viewers before fetching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const api = createGameApi(createHttpClient({ fetch }))
    expectTypeOf(api.getState).returns.toEqualTypeOf<Promise<GameStateDTO>>()
    expectTypeOf(api.getState).parameters.toEqualTypeOf<[string, string, RequestContext?]>()
    for (const id of ['', '   ', undefined, null]) {
      await expect(async () => api.getState(gameId, id as string)).rejects.toThrow('viewer')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['.', '..', '', '   '])('rejects unsafe empty/dot path IDs: %s', async (id) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const api = createModelApi(createHttpClient({ fetch }))
    await expect(async () => api.remove('openrouter', id)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps report 404s distinguishable from nullable/sparse report data', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
      new Response('{"detail":"Not generated"}', { status: 404 }))
    const api = createJournalApi(createHttpClient({ fetch }))
    await expect(api.getSummary(gameId, agentId)).rejects.toMatchObject({ kind: 'http', status: 404 })
    await expect(api.getNarrative(gameId, agentId, 1)).rejects.toMatchObject({ kind: 'http', status: 404 })
  })

  it('sends the unsaved verification key in the body and redacts reflected failures', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('{"detail":"invalid fake-unsaved"}', { status: 400 }))
    const api = createProviderApi(createHttpClient({ fetch }))
    await expect(api.verify('zhipu', 'fake-unsaved')).rejects.toMatchObject({ detail: 'invalid [redacted]' })
    expect(fetch.mock.calls[0][1]?.body).toBe('{"key":"fake-unsaved"}')
  })

  it.each(families)('$provider add requires its own original ID metadata', async ({ provider }) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      message: 'added', model_id: modelId, display_name: 'name', unrelated_id: 'vendor/model',
    })))
    const api = createModelApi(createHttpClient({ fetch }))
    await expect(api.add(provider, { model_id: 'vendor/model', display_name: 'name' }))
      .rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it.each([
    { status: 'connected' }, { status: 'pending', interval: '10' }, { status: 'unknown' },
    { status: 'connected', models: [{}] },
  ])('rejects malformed OAuth poll data: %j', async (response) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(response)))
    await expect(createCopilotApi(createHttpClient({ fetch })).poll()).rejects.toMatchObject({ kind: 'invalid-response' })
  })
})
