import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const imports = vi.hoisted(() => ({ legacy: vi.fn(), rebuild: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.doMock('../LegacyApp', () => {
    imports.legacy()
    return { default: () => <div>Legacy app</div> }
  })
  vi.doMock('../WebGameApp', () => {
    imports.rebuild()
    return { default: () => <div>Rebuild app</div> }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('whole-app build flag', () => {
  it.each([undefined, '', '0', 'true'])('keeps %s on legacy without importing the rebuild', async (flag) => {
    vi.stubEnv('VITE_WEB_GAME_REBUILD', flag)
    const { default: AppEntry } = await import('../AppEntry')
    render(<AppEntry />)
    expect(await screen.findByText('Legacy app')).toBeInTheDocument()
    expect(imports.legacy).toHaveBeenCalledOnce()
    expect(imports.rebuild).not.toHaveBeenCalled()
    expect(screen.queryByText('Rebuild app')).not.toBeInTheDocument()
  })

  it('lazily imports only the rebuild for exactly 1', async () => {
    vi.stubEnv('VITE_WEB_GAME_REBUILD', '1')
    const { default: AppEntry } = await import('../AppEntry')
    expect(imports.rebuild).not.toHaveBeenCalled()
    render(<AppEntry />)
    expect(screen.getByRole('status')).toHaveTextContent('正在打开牌室')
    expect(await screen.findByText('Rebuild app')).toBeInTheDocument()
    expect(imports.rebuild).toHaveBeenCalledOnce()
    expect(imports.legacy).not.toHaveBeenCalled()
    expect(screen.queryByText('Legacy app')).not.toBeInTheDocument()
  })
})
