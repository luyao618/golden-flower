import { decodeActionResponse, decodeCreateGameResponse, decodeEndGameResponse,
  decodeGameState, decodeStartGameResponse } from '../domain/decoders'
import type { CreateGameRequestDTO, PlayerActionRequestDTO } from '../domain/game'
import type { HttpClient, RequestContext } from './http'
import { pathId } from './paths'

/** REST compatibility only. Start/action do not implement the WebSocket AI orchestration. */
export function createGameApi(http: HttpClient) {
  return {
    create: (body: CreateGameRequestDTO, options?: RequestContext) =>
      http.request('/game/create', decodeCreateGameResponse, { ...options, method: 'POST', body }),
    getState(gameId: string, viewerId: string, options?: RequestContext) {
      if (typeof viewerId !== 'string' || !viewerId.trim()) throw new TypeError('A viewer ID is required')
      const query = new URLSearchParams({ player_id: viewerId })
      return http.request(`/game/${pathId(gameId)}?${query}`, decodeGameState, options)
    },
    start: (gameId: string, options?: RequestContext) =>
      http.request(`/game/${pathId(gameId)}/start`, decodeStartGameResponse, { ...options, method: 'POST' }),
    action: (gameId: string, body: PlayerActionRequestDTO, options?: RequestContext) =>
      http.request(`/game/${pathId(gameId)}/action`, decodeActionResponse, { ...options, method: 'POST', body }),
    end: (gameId: string, options?: RequestContext) =>
      http.request(`/game/${pathId(gameId)}/end`, decodeEndGameResponse, { ...options, method: 'POST' }),
  }
}
