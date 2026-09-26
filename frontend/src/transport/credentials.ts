import type { KeyProvider } from '../domain/providers'
export type { KeyProvider } from '../domain/providers'
export type ProviderKeys = Readonly<Partial<Record<KeyProvider, string>>>

/** Backend json.loads expects JSON, not URI/base64 encoding. Escape Unicode for Headers' ByteString. */
export function encodeProviderKeys(keys: ProviderKeys): string | undefined {
  const entries = Object.entries(keys).filter(([, value]) => typeof value === 'string' && value.trim())
  if (entries.length === 0) return undefined
  return JSON.stringify(Object.fromEntries(entries)).replace(/[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
