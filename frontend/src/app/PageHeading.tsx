import { useEffect, useRef, type ReactNode } from 'react'

export default function PageHeading({ children, title }: { children: ReactNode, title: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${title} · 大模型炸金花`
    ref.current?.focus({ preventScroll: true })
    return () => { document.title = previousTitle }
  }, [title])
  return <h1 ref={ref} tabIndex={-1}>{children}</h1>
}
