import { decodeCopilotConnect, decodeCopilotPoll, decodeCopilotStatus, decodeMessage } from '../domain/decoders'
import type { HttpClient, RequestContext } from './http'

/** Single HTTP operations; device-flow scheduling/lifecycle belongs to its future controller. */
export function createCopilotApi(http: HttpClient) {
  return {
    connect: (options?: RequestContext) => http.request('/copilot/connect', decodeCopilotConnect, { ...options, method: 'POST' }),
    poll: (options?: RequestContext) => http.request('/copilot/poll', decodeCopilotPoll, options),
    getStatus: (options?: RequestContext) => http.request('/copilot/status', decodeCopilotStatus, options),
    disconnect: (options?: RequestContext) => http.request('/copilot/disconnect', decodeMessage, { ...options, method: 'POST' }),
  }
}
