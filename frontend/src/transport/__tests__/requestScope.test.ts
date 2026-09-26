import { describe, expect, it, vi } from 'vitest'
import { createRequestScope } from '../requestScope'
import type { RequestLease } from '../requestScope'
import { createHttpClient } from '../http'
import { createJournalApi } from '../journal'
import { createReadFixtures } from '../../test/fixtures/restFixtures'

describe('latest request scope', () => {
  it('aborts the previous request and guards late values, errors and cleanup', async () => {
    const scope = createRequestScope()
    const old = scope.begin()
    const apply = vi.fn()
    const newer = scope.begin()
    expect(old.signal.aborted).toBe(true)
    expect(old.isCurrent()).toBe(false)
    await Promise.resolve()
    expect(old.commit(() => apply('old value'))).toBe(false)
    expect(old.commit(() => apply('old error'))).toBe(false)
    expect(old.commit(() => apply('old finally'))).toBe(false)
    expect(newer.commit(() => apply('new value'))).toBe(true)
    expect(apply.mock.calls).toEqual([['new value']])
  })

  it('invalidates before dispatching abort callbacks; cancellation is idempotent', () => {
    const scope = createRequestScope()
    const old = scope.begin()
    const apply = vi.fn()
    old.signal.addEventListener('abort', () => old.commit(apply))
    scope.cancel()
    scope.cancel()
    expect(old.signal.aborted).toBe(true)
    expect(apply).not.toHaveBeenCalled()
    const fresh = scope.begin()
    expect(fresh.isCurrent()).toBe(true)
    expect(fresh.signal.aborted).toBe(false)
  })

  it('keeps independent resources isolated and rechecks at the actual commit time', async () => {
    const journal = createRequestScope()
    const providers = createRequestScope()
    const first = journal.begin()
    const provider = providers.begin()
    expect(first.isCurrent()).toBe(true)
    await Promise.resolve()
    journal.begin()
    expect(first.commit(vi.fn())).toBe(false)
    expect(provider.isCurrent()).toBe(true)
    expect(provider.signal.aborted).toBe(false)
  })

  it.each(['success', 'failure'] as const)('ignores a late fetch %s after switching journal selection', async (outcome) => {
    const scope = createRequestScope()
    const fetch = vi.fn<typeof globalThis.fetch>()
    let resolveOld!: (response: Response) => void
    let rejectOld!: (error: Error) => void
    let resolveNew!: (response: Response) => void
    // Deliberately ignores AbortSignal to reproduce an uncooperative transport.
    fetch.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveOld = resolve
      rejectOld = reject
    })).mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve }))
    const api = createJournalApi(createHttpClient({ fetch }))
    const visible: string[] = []
    let loading = true
    const load = async (lease: RequestLease, agentId: string) => {
      try {
        const result = await api.getThoughts('fixture-game', agentId, { signal: lease.signal })
        lease.commit(() => visible.push(result.agent_id))
      } catch {
        lease.commit(() => visible.push('error'))
      } finally {
        lease.commit(() => { loading = false })
      }
    }
    const old = load(scope.begin(), 'ai-1')
    const latest = load(scope.begin(), 'ai-2')
    await old
    expect(visible).toEqual([])
    expect(loading).toBe(true)
    const { emptyThoughts } = createReadFixtures()
    resolveNew(new Response(JSON.stringify({ ...emptyThoughts, agent_id: 'ai-2' })))
    await latest
    if (outcome === 'success') resolveOld(new Response(JSON.stringify(emptyThoughts)))
    else rejectOld(new Error('late failure'))
    await Promise.resolve()
    expect(visible).toEqual(['ai-2'])
    expect(loading).toBe(false)
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(false)
  })
})
