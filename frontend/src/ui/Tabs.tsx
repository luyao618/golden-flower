import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'

interface TabItem { id: string, label: string, content: ReactNode, disabled?: boolean }

/** Horizontal, automatically activated tabs; contents are local and immediate. */
export default function Tabs({ label, items }: { label: string, items: readonly TabItem[] }) {
  const id = useId()
  const enabled = items.filter((item) => !item.disabled)
  const [selected, setSelected] = useState(enabled[0]?.id)
  const active = enabled.some((item) => item.id === selected) ? selected : enabled[0]?.id

  function navigate(event: KeyboardEvent<HTMLButtonElement>, current: string) {
    const index = enabled.findIndex((item) => item.id === current)
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % enabled.length; break
      case 'ArrowLeft': next = (index - 1 + enabled.length) % enabled.length; break
      case 'Home': next = 0; break
      case 'End': next = enabled.length - 1; break
      default: return
    }
    event.preventDefault()
    const target = enabled[next]
    if (!target) return
    setSelected(target.id)
    document.getElementById(`${id}-tab-${target.id}`)?.focus()
  }

  return <div className="gf-tabs">
    <div role="tablist" aria-label={label}>
      {items.map((item) => <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`}
        aria-controls={`${id}-panel-${item.id}`} aria-selected={item.id === active}
        tabIndex={item.id === active ? 0 : -1} disabled={item.disabled}
        onClick={() => setSelected(item.id)} onKeyDown={(event) => navigate(event, item.id)}>{item.label}</button>)}
    </div>
    {items.map((item) => <div key={item.id} id={`${id}-panel-${item.id}`} role="tabpanel"
      tabIndex={0} aria-labelledby={`${id}-tab-${item.id}`} hidden={item.id !== active}>{item.content}</div>)}
  </div>
}
