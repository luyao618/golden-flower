import { decodeSettings } from '../domain/decoders'
import type { SettingsDTO } from '../domain/rest'
import type { HttpClient, RequestContext } from './http'

export function createSettingsApi(http: HttpClient) {
  return {
    get: (options?: RequestContext) => http.request('/settings', decodeSettings, options),
    // Accept server-returned values. Write serialization/coalescing belongs to package 4E.
    update: (body: Partial<SettingsDTO>, options?: RequestContext) =>
      http.request('/settings', decodeSettings, { ...options, method: 'POST', body }),
  }
}
