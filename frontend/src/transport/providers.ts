import { decodeProviderConfig, decodeProviders, decodeVerifyKey } from '../domain/decoders'
import type { KeyProvider, ProviderConfigDTO } from '../domain/providers'
import type { HttpClient, RequestContext } from './http'

export function createProviderApi(http: HttpClient) {
  return {
    getAll: (options?: RequestContext) => http.request('/providers', decodeProviders, options),
    verify: (provider: KeyProvider, key: string | null = null, options?: RequestContext) =>
      http.request(`/providers/${provider}/verify`, decodeVerifyKey,
        { ...options, method: 'POST', body: { key }, secrets: key === null ? [] : [key] }),
    configure: (provider: KeyProvider, body: ProviderConfigDTO, options?: RequestContext) =>
      http.request(`/providers/${provider}/config`, decodeProviderConfig, { ...options, method: 'POST', body }),
  }
}
