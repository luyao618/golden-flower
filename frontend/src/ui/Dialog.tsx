import { useId, useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import Button from './Button'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
}

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Native modal top layer makes the background inert; the same surface is a
 * bottom sheet on narrow screens. Callers own open state and avoid stacking. */
export default function Dialog({ open, onClose, title, description, children, initialFocusRef }: DialogProps) {
  const id = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  // Passive cleanup restores focus after React's own selection restoration.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    const requested = initialFocusRef?.current
    if (requested && dialog.contains(requested)) requested.focus()
    else titleRef.current?.focus()
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      if (opener?.isConnected) opener.focus()
    }
  }, [open, initialFocusRef])

  function containTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return
    const candidates = [...event.currentTarget.querySelectorAll<HTMLElement>('*')]
      .filter((element) => element.matches(focusable))
      .filter((element) => !element.closest('[hidden], [inert]') && element.getAttribute('type') !== 'hidden')
    const first = candidates[0]
    const last = candidates.at(-1)
    const active = document.activeElement
    if (!first || !last) {
      event.preventDefault()
      titleRef.current?.focus()
    } else if (event.shiftKey && (active === first || !candidates.includes(active as HTMLElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !candidates.includes(active as HTMLElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  return <dialog ref={dialogRef} className="gf-dialog" aria-labelledby={`${id}-title`}
    aria-describedby={description ? `${id}-description` : undefined}
    onCancel={(event) => { event.preventDefault(); onClose() }} onKeyDown={containTab}>
    <div className="gf-dialog-heading room:flex room:items-center room:justify-between">
      <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1}>{title}</h2>
      <Button variant="secondary" aria-label={`关闭${title}`} onClick={onClose}>关闭</Button>
    </div>
    {description && <p id={`${id}-description`} className="gf-muted">{description}</p>}
    {children}
  </dialog>
}
