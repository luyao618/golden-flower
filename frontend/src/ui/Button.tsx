import type { ButtonHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'
  busy?: boolean
}

export default function Button({ variant = 'primary', busy = false, disabled, className = '', type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`gf-button room:inline-flex room:items-center room:justify-center room:gap-3 gf-button--${variant} ${className}`} />
}
