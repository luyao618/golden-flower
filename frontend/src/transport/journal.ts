import { decodeCancelledSummaries, decodeChatList, decodeNarrative, decodeReviewList,
  decodeSummary, decodeThoughtList } from '../domain/decoders'
import type { HttpClient, RequestContext } from './http'
import { pathId, roundPath } from './paths'

/** Preserve envelopes/nulls and 404s. Completed-hand access and caching belong to callers. */
export function createJournalApi(http: HttpClient) {
  const game = (id: string) => `/game/${pathId(id)}`
  return {
    getThoughts: (gameId: string, agentId: string, options?: RequestContext) =>
      http.request(`${game(gameId)}/thoughts/${pathId(agentId)}`, decodeThoughtList, options),
    getRoundThoughts: (gameId: string, agentId: string, round: number, options?: RequestContext) =>
      http.request(`${game(gameId)}/thoughts/${pathId(agentId)}/round/${roundPath(round)}`, decodeThoughtList, options),
    getNarrative: (gameId: string, agentId: string, round: number, options?: RequestContext) =>
      http.request(`${game(gameId)}/narrative/${pathId(agentId)}/round/${roundPath(round)}`, decodeNarrative, options),
    getSummary: (gameId: string, agentId: string, options?: RequestContext) =>
      http.request(`${game(gameId)}/summary/${pathId(agentId)}`, decodeSummary, options),
    getReviews: (gameId: string, agentId: string, options?: RequestContext) =>
      http.request(`${game(gameId)}/reviews/${pathId(agentId)}`, decodeReviewList, options),
    getChat: (gameId: string, options?: RequestContext) =>
      http.request(`${game(gameId)}/chat`, decodeChatList, options),
    getRoundChat: (gameId: string, round: number, options?: RequestContext) =>
      http.request(`${game(gameId)}/chat/round/${roundPath(round)}`, decodeChatList, options),
    cancelSummaries: (gameId: string, options?: RequestContext) =>
      http.request(`${game(gameId)}/cancel-summaries`, decodeCancelledSummaries, { ...options, method: 'POST' }),
  }
}
