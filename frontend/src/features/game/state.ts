import type { DecodedServerEvent } from '../../domain/decoders'
import type { ClientCommand } from '../../domain/events'
import type { CardDTO, GameStateDTO, RoundResultDTO, StandingDTO } from '../../domain/game'

export type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T
export type Snapshot = ReadonlyData<GameStateDTO>
export type RoundResult = ReadonlyData<RoundResultDTO>
export type GameCommand = Exclude<ClientCommand, { type: 'chat_message' }>

export interface SessionIdentity {
  readonly gameId: string
  readonly playerId: string
}

export interface CommandAttempt {
  /** Local monotonic token, never sent as a wire request ID. */
  readonly id: number
  readonly generation: number
  readonly command: ReadonlyData<GameCommand>
  readonly roundNumber: number | null
  readonly actionCount: number
  readonly actionPrefix: string
}

export type CommandState = { readonly status: 'idle' } | {
  readonly status: 'sending' | 'awaiting_server' | 'acknowledged' | 'rejected' | 'uncertain'
  readonly attempt: CommandAttempt
  readonly reason: string | null
}

export interface EffectToken {
  readonly id: number
  readonly gameId: string
  readonly generation: number
  readonly roundNumber: number
}

export interface GameEffect extends EffectToken {
  readonly kind: 'deal' | 'action' | 'settlement'
}

export interface FinalReceipt {
  readonly gameId: string
  readonly standings: ReadonlyData<StandingDTO[]>
}

export interface GameSession {
  readonly identity: SessionIdentity
  /** The only owner of players, balances, phase, pot, actions and current round. */
  readonly snapshot: Snapshot | null
  readonly connection: {
    readonly generation: number
    readonly status: 'disconnected' | 'connecting' | 'open'
    readonly sync: 'awaiting_snapshot' | 'ready' | 'error'
  }
  readonly eligibility: {
    readonly roundNumber: number
    readonly playerId: string
    readonly actions: readonly string[]
  } | null
  readonly command: CommandState
  readonly lastCommandId: number
  readonly presentation: {
    readonly effects: readonly GameEffect[]
    readonly nextEffectId: number
    /** Supplemental result delivery, discarded at the next authoritative snapshot. */
    readonly resultEvents: readonly RoundResult[]
    /** Viewer-authorized comparison cards; never recovered from an unscoped read. */
    readonly reveals: readonly {
      readonly roundNumber: number
      readonly playerId: string
      readonly cards: ReadonlyData<CardDTO[]>
    }[]
  }
  readonly receipt: FinalReceipt | null
  readonly notice: { readonly kind: 'server_error' | 'copilot_error' | 'sync_error', readonly message: string } | null
}

export type SessionAction = { readonly generation: number } & (
  | { type: 'connection.started' | 'connection.opened' | 'connection.closed' }
  | { type: 'server.message', message: DecodedServerEvent }
  | { type: 'command.requested', id: number, command: GameCommand }
  | { type: 'command.sent' | 'command.timed_out', id: number }
  | { type: 'command.failed', id: number, delivery: 'not_sent' | 'unknown', message: string }
  | { type: 'effect.finished', effect: EffectToken }
)

export const MAX_EFFECTS = 32

export function isCommandPending(command: CommandState): boolean {
  return command.status === 'sending' || command.status === 'awaiting_server' || command.status === 'uncertain'
}

export function createGameSession(identity: SessionIdentity): GameSession {
  return {
    identity: { ...identity }, snapshot: null,
    connection: { generation: 0, status: 'disconnected', sync: 'awaiting_snapshot' },
    eligibility: null, command: { status: 'idle' }, lastCommandId: 0,
    presentation: { effects: [], nextEffectId: 1, resultEvents: [], reveals: [] },
    receipt: null, notice: null,
  }
}
