import type { DecodeResult } from '../domain/decoders'
import { encodeProviderKeys } from './credentials'
import type { ProviderKeys } from './credentials'

export interface FieldIssue {
  /** Keep the full Pydantic location, including body/query and array indexes. */
  loc: (string | number)[]
  type: string
  message: string
}

export type ErrorKind = 'http' | 'validation' | 'network' | 'invalid-response' | 'aborted'
const codes = { http: 'HTTP_ERROR', validation: 'VALIDATION_ERROR', network: 'NETWORK_ERROR',
  'invalid-response': 'INVALID_RESPONSE', aborted: 'ABORTED' } as const

/** Safe diagnostics only: no request, headers, raw response, validation input/context, or cause. */
export class TransportError extends Error {
  readonly kind: ErrorKind
  readonly code: typeof codes[ErrorKind]
  readonly status: number | null
  readonly detail: string | FieldIssue[] | null
  readonly issues: FieldIssue[]

  constructor(kind: ErrorKind, message: string, status: number | null = null,
    detail: string | FieldIssue[] | null = null) {
    super(message)
    this.name = 'TransportError'
    this.kind = kind
    this.code = codes[kind]
    this.status = status
    this.detail = detail
    this.issues = Array.isArray(detail) ? detail : []
  }
}

export interface RequestContext {
  signal?: AbortSignal
}

export interface RequestOptions extends RequestContext {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  /** Additional request secrets (e.g. an unsaved verification key) to redact from errors. */
  secrets?: readonly string[]
}

export interface HttpClient {
  request<T>(path: string, decode: (value: unknown) => DecodeResult<T>, options?: RequestOptions): Promise<T>
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const aborted = () => new TransportError('aborted', 'Request cancelled')
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw aborted() }

/** Also handles mocks/transports which ignore the signal; observes late rejections and cleans listeners. */
function cancellable<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal)
  if (!signal) return task()
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { cleanup(); reject(aborted()) }
    const cleanup = () => signal.removeEventListener('abort', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    try {
      task().then((value) => {
        cleanup()
        if (signal.aborted) reject(aborted())
        else resolve(value)
      }, (error: unknown) => { cleanup(); reject(error) })
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function httpError(status: number, payload: unknown, secrets: readonly string[]): TransportError {
  const redact = (value: string) => secrets.filter(Boolean).sort((a, b) => b.length - a.length)
    .reduce((text, secret) => text.split(secret).join('[redacted]'), value)
  const detail = record(payload) ? payload.detail : undefined
  if (typeof detail === 'string' && detail.trim()) {
    const safe = redact(detail)
    return new TransportError('http', safe, status, safe)
  }
  if (Array.isArray(detail)) {
    const issues: FieldIssue[] = []
    for (const issue of detail) {
      if (!record(issue) || !Array.isArray(issue.loc) || typeof issue.msg !== 'string' ||
        typeof issue.type !== 'string' || !issue.loc.every((part: unknown) =>
          typeof part === 'string' || (typeof part === 'number' && Number.isSafeInteger(part)))) continue
      issues.push({ loc: issue.loc.map((part: string | number) => typeof part === 'string' ? redact(part) : part),
        type: redact(issue.type), message: redact(issue.msg) })
    }
    if (issues.length) return new TransportError('validation', 'Request validation failed', status, issues)
  }
  return new TransportError('http', `HTTP ${status}`, status)
}

/** Same-origin /api only. Dependencies are explicit; no stores, persistence, logging, or retries. */
export function createHttpClient(dependencies: {
  fetch?: typeof globalThis.fetch
  getProviderKeys?: () => ProviderKeys
} = {}): HttpClient {
  return {
    async request<T>(path: string, decode: (value: unknown) => DecodeResult<T>, options: RequestOptions = {}): Promise<T> {
      checkAbort(options.signal)
      const keys = dependencies.getProviderKeys?.() ?? {}
      const secrets = [...Object.values(keys), ...(options.secrets ?? [])]
      const headers = new Headers({ Accept: 'application/json' })
      const encodedKeys = encodeProviderKeys(keys)
      if (encodedKeys) headers.set('X-Provider-Keys', encodedKeys)
      const body = options.body === undefined ? undefined : JSON.stringify(options.body)
      if (body !== undefined) headers.set('Content-Type', 'application/json')
      let response: Response | undefined
      let text: string
      try {
        response = await cancellable(() => (dependencies.fetch ?? globalThis.fetch)(`/api${path}`, {
          method: options.method ?? 'GET', headers, body, signal: options.signal,
          // Never forward credentials via an unexpected redirect to another origin.
          redirect: 'error',
        }), options.signal)
        text = await cancellable(() => response!.text(), options.signal)
        checkAbort(options.signal)
      } catch (error) {
        if (options.signal?.aborted || (error instanceof TransportError && error.kind === 'aborted') ||
          (record(error) && error.name === 'AbortError')) throw aborted()
        throw new TransportError('network', 'Network request failed', response?.status ?? null)
      }
      let payload: unknown
      try { payload = JSON.parse(text) } catch {
        if (!response.ok) throw httpError(response.status, null, secrets)
        throw new TransportError('invalid-response', 'Invalid server response', response.status)
      }
      if (!response.ok) throw httpError(response.status, payload, secrets)
      const result = decode(payload)
      if (!result.ok) throw new TransportError('invalid-response', 'Invalid server response', response.status)
      return result.value
    },
  }
}
