/** Three petals for a three-card hand. Decorative; the parent provides a name. */
export default function FlowerMark({ className = '' }: { className?: string }) {
  return <svg className={`gf-flower ${className}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M32 34C13 25 19 7 32 7S51 25 32 34ZM32 34C48 21 62 35 55 46S33 55 32 34ZM32 34C34 55 12 57 7 45S16 21 32 34Z" fill="currentColor" />
    <circle cx="32" cy="34" r="5" fill="var(--gf-ink)" />
  </svg>
}
