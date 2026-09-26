/** IDs are opaque. Encode once; never split slashes, trim, or derive registry IDs. */
export function pathId(id: string): string {
  // URL parsers normalize dot-only segments even when percent-encoded.
  if (typeof id !== 'string' || !id.trim() || id === '.' || id === '..') {
    throw new TypeError('Expected a nonempty, non-dot path ID')
  }
  return encodeURIComponent(id)
}

export function roundPath(round: number): string {
  if (!Number.isSafeInteger(round)) throw new TypeError('Expected an integer round number')
  return String(round)
}
