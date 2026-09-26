export interface RequestLease {
  signal: AbortSignal
  isCurrent(): boolean
  /** Synchronous guard at application time, for data, errors AND finally/loading cleanup. */
  commit(apply: () => void): boolean
}

/** One scope per independently displayed resource. Cancel on selection change/unmount.
 * Use for reads; cancelling a write cannot undo server work or serialize settings saves.
 */
export function createRequestScope() {
  let current: AbortController | undefined
  return {
    begin(): RequestLease {
      const previous = current
      const controller = new AbortController()
      current = controller
      previous?.abort()
      const isCurrent = () => current === controller && !controller.signal.aborted
      return { signal: controller.signal, isCurrent, commit(apply) {
        if (!isCurrent()) return false
        apply()
        return true
      } }
    },
    cancel() {
      const previous = current
      current = undefined
      previous?.abort()
    },
  }
}
