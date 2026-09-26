import { decodeAddedModel, decodeAddedModels, decodeModelCatalog, decodeModels, decodeRemovedModel } from '../domain/decoders'
import type { AddModelRequestDTO, KeyProvider } from '../domain/providers'
import type { HttpClient, RequestContext } from './http'
import { pathId } from './paths'

const prefixes = { openrouter: '/openrouter', siliconflow: '/siliconflow', azure_openai: '/azure-openai', zhipu: '/zhipu' } as const

export function createModelApi(http: HttpClient) {
  const models = (provider: KeyProvider) => `${prefixes[provider]}/models`
  return {
    getAvailable: (options?: RequestContext) => http.request('/models', decodeModels, options),
    getCatalog: (provider: KeyProvider, options?: RequestContext) =>
      http.request(models(provider), decodeModelCatalog, options),
    getAdded: (provider: KeyProvider, options?: RequestContext) =>
      http.request(`${models(provider)}/added`, decodeAddedModels, options),
    add: <P extends KeyProvider>(provider: P, body: AddModelRequestDTO, options?: RequestContext) =>
      http.request(models(provider), (value) => decodeAddedModel(provider, value), { ...options, method: 'POST', body }),
    remove: (provider: KeyProvider, modelId: string, options?: RequestContext) =>
      http.request(`${models(provider)}/${pathId(modelId)}`, decodeRemovedModel, { ...options, method: 'DELETE' }),
  }
}
