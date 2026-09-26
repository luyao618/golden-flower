import type { ReactNode } from 'react'

export default function Status({ children, tone = 'info' }: { children: ReactNode, tone?: 'info' | 'success' | 'danger' }) {
  return <p className={`gf-status gf-status--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}
    aria-live={tone === 'danger' ? 'assertive' : 'polite'} aria-atomic="true">
    <span aria-hidden="true">{tone === 'danger' ? '!' : tone === 'success' ? '✓' : '○'}</span>
    {children}
  </p>
}
