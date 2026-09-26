import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeSettings } from '../../domain/decoders'
import { createHttpClient, TransportError } from '../http'
import type { ProviderKeys } from '../credentials'

const settings = { llm_max_tokens: null, ai_thinking_mode: 'fast', llm_timeout: 30,
  llm_max_retries: 0, llm_temperature: 0.7 }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function setup(getProviderKeys?: () => ProviderKeys) {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const client = createHttpClient({ fetch, getProviderKeys })
  return { fetch, client }
}

afterEach(() => vi.restoreAllMocks())

describe('HTTP boundary', () => {
  it('decodes JSON without coercing nulls and adds only needed headers', async () => {
    const { fetch, client } = setup()
    fetch.mockResolvedValue(json(settings))
    await expect(client.request('/settings', decodeSettings)).resolves.toEqual(settings)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/settings')
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json')
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
    expect(new Headers(init?.headers).has('X-Provider-Keys')).toBe(false)
    expect(init?.redirect).toBe('error')
  })

  it('sends partial JSON bodies with explicit null and zero intact', async () => {
    const { fetch, client } = setup()
    fetch.mockResolvedValue(json(settings))
    await client.request('/settings', decodeSettings, {
      method: 'POST', body: { llm_max_tokens: null, llm_max_retries: 0 },
    })
    expect(fetch.mock.calls[0][1]?.body).toBe('{"llm_max_tokens":null,"llm_max_retries":0}')
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Content-Type')).toBe('application/json')
  })

  it('snapshots fresh keys per request as ASCII JSON, never URI/base64 encoding', async () => {
    let keys: ProviderKeys = { openrouter: 'fake-"\\\n密钥🔑', azure_openai: 'fake-azure',
      siliconflow: 'fake-silicon', zhipu: 'fake-zhipu' }
    const { fetch, client } = setup(() => keys)
    fetch.mockImplementation(async () => json(settings))
    await client.request('/settings', decodeSettings)
    const header = new Headers(fetch.mock.calls[0][1]?.headers).get('X-Provider-Keys')!
    expect([...header].every((char) => char.charCodeAt(0) < 128)).toBe(true)
    expect(JSON.parse(header)).toEqual(keys)
    keys = { zhipu: 'fake-replacement' }
    await client.request('/settings', decodeSettings)
    expect(JSON.parse(new Headers(fetch.mock.calls[1][1]?.headers).get('X-Provider-Keys')!)).toEqual(keys)
    keys = {}
    await client.request('/settings', decodeSettings)
    expect(new Headers(fetch.mock.calls[2][1]?.headers).has('X-Provider-Keys')).toBe(false)
  })

  it('retains HTTP status and string detail (including a 422 business failure)', async () => {
    const { fetch, client } = setup()
    for (const status of [400, 404, 422, 500]) {
      fetch.mockResolvedValueOnce(json({ detail: '当前操作不可用' }, status))
      await expect(client.request('/settings', decodeSettings)).rejects.toMatchObject({
        name: 'TransportError', kind: 'http', code: 'HTTP_ERROR', status,
        message: '当前操作不可用', detail: '当前操作不可用', issues: [],
      })
    }
  })

  it('maps Pydantic 422 locations/types without retaining input or context', async () => {
    const { fetch, client } = setup()
    fetch.mockResolvedValue(json({ detail: [
      { loc: ['body', 'ai_opponents', 1, 'model_id'], type: 'string_type', msg: 'Input should be a valid string',
        input: 'fake-private-input', ctx: { private: 'fake-private-context' }, url: 'unused' },
      { loc: ['body', 'ante'], type: 'greater_than_equal', msg: 'Input should be greater than or equal to 1' },
    ] }, 422))
    const error = await client.request('/settings', decodeSettings).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransportError)
    expect(error).toMatchObject({ kind: 'validation', code: 'VALIDATION_ERROR', status: 422,
      issues: [
        { loc: ['body', 'ai_opponents', 1, 'model_id'], type: 'string_type', message: 'Input should be a valid string' },
        { loc: ['body', 'ante'], type: 'greater_than_equal', message: 'Input should be greater than or equal to 1' },
      ] })
    expect(JSON.stringify(error)).not.toContain('fake-private')
    expect(String(error)).not.toContain('[object Object]')
  })

  it.each(['<html>Bad Gateway</html>', '', '{', 'null', '[]', '{"detail":{}}',
    '{"detail":[]}', '{"detail":[{"loc":"bad","msg":1}]}', '{"detail":""}'])(
    'uses a stable status fallback for unrecognized error bodies: %s', async (body) => {
    const { fetch, client } = setup()
    fetch.mockResolvedValue(new Response(body, { status: 502, statusText: 'do not reflect proxy text' }))
    await expect(client.request('/settings', decodeSettings)).rejects.toMatchObject({
      kind: 'http', status: 502, message: 'HTTP 502', detail: null,
    })
  })

  it.each(['<html>OK?</html>', '', '{}', 'null', JSON.stringify({ ...settings, llm_timeout: '30' })])(
    'rejects invalid successful responses: %s', async (body) => {
    const { fetch, client } = setup()
    fetch.mockResolvedValue(new Response(body))
    await expect(client.request('/settings', decodeSettings)).rejects.toMatchObject({
      kind: 'invalid-response', code: 'INVALID_RESPONSE', status: 200,
    })
  })

  it('classifies network failures and interrupted response bodies without raw causes', async () => {
    const { fetch, client } = setup()
    fetch.mockRejectedValueOnce(new TypeError('fake-secret /private-url'))
    await expect(client.request('/settings', decodeSettings)).rejects.toMatchObject({
      kind: 'network', code: 'NETWORK_ERROR', status: null, message: 'Network request failed',
    })
    const response = json(settings)
    vi.spyOn(response, 'text').mockRejectedValueOnce(new TypeError('private body failure'))
    fetch.mockResolvedValueOnce(response)
    const error = await client.request('/settings', decodeSettings).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'network', status: 200 })
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toContain('private')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('redacts supplied keys from diagnostic strings and never logs requests/errors', async () => {
    const logs = ['log', 'info', 'warn', 'error', 'debug'] as const
    const spies = logs.map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    const { fetch, client } = setup(() => ({ openrouter: 'fake-saved-key' }))
    fetch.mockResolvedValueOnce(json({ detail: 'rejected fake-saved-key and fake-unsaved-key' }, 400))
    const error = await client.request('/providers/openrouter/verify', decodeSettings, {
      method: 'POST', body: { key: 'fake-unsaved-key' }, secrets: ['fake-unsaved-key'],
    }).catch((e: unknown) => e)
    expect(error).toMatchObject({ message: 'rejected [redacted] and [redacted]' })
    expect(JSON.stringify(error)).not.toContain('fake-')
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('AbortSignal cancellation', () => {
  it('rejects an already aborted signal without reading credentials or fetching', async () => {
    const getKeys = vi.fn(() => ({}))
    const { fetch, client } = setup(getKeys)
    const signal = AbortSignal.abort('private cancellation reason')
    await expect(client.request('/settings', decodeSettings, { signal })).rejects.toMatchObject({
      kind: 'aborted', code: 'ABORTED', status: null,
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(getKeys).not.toHaveBeenCalled()
  })

  it('forwards the exact signal and cancels even a fetch mock that ignores it', async () => {
    const { fetch, client } = setup()
    const controller = new AbortController()
    let resolve!: (response: Response) => void
    fetch.mockImplementation(() => new Promise((done) => { resolve = done }))
    const request = client.request('/settings', decodeSettings, { signal: controller.signal })
    const assertion = expect(request).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal)
    controller.abort(new Error('private reason'))
    await assertion
    resolve(json(settings))
  })

  it('cancels while the response body is pending and removes listeners', async () => {
    const { fetch, client } = setup()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const response = json(settings)
    let reject!: (error: Error) => void
    const text = vi.spyOn(response, 'text').mockImplementation(() => new Promise((_, fail) => { reject = fail }))
    fetch.mockResolvedValue(response)
    const request = client.request('/settings', decodeSettings, { signal: controller.signal })
    const assertion = expect(request).rejects.toMatchObject({ kind: 'aborted' })
    await vi.waitFor(() => expect(text).toHaveBeenCalled())
    controller.abort()
    await assertion
    reject(new Error('late ignored failure'))
    for (const [event, callback] of add.mock.calls) {
      expect(remove).toHaveBeenCalledWith(event, callback)
    }
  })

  it('normalizes native AbortError and cleans up listeners on normal completion', async () => {
    const { fetch, client } = setup()
    fetch.mockRejectedValueOnce(new DOMException('private', 'AbortError'))
    await expect(client.request('/settings', decodeSettings)).rejects.toMatchObject({ kind: 'aborted' })
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    fetch.mockResolvedValue(json(settings))
    await client.request('/settings', decodeSettings, { signal: controller.signal })
    for (const [event, callback] of add.mock.calls) expect(remove).toHaveBeenCalledWith(event, callback)
  })
})
