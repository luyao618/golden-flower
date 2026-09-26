import type { ServerEvent } from '../../domain/events'
import type { ActionRecordDTO, GameStateDTO } from '../../domain/game'
import { selectActions, selectCanStartRound, selectCompareTargets, selectCurrentActor, upsertRoundResults } from './selectors'
import { isCommandPending, MAX_EFFECTS } from './state'
import type { CommandState, GameEffect, GameSession, ReadonlyData, SessionAction, Snapshot } from './state'

function actionFingerprint(actions: ReadonlyData<ActionRecordDTO[]>): string {
  return JSON.stringify(actions.map(({ player_id, action, amount, target_id, timestamp }) =>
    [player_id, action, amount, target_id, timestamp]))
}

function uncertain(command: CommandState, reason: string): CommandState {
  return command.status !== 'idle' && isCommandPending(command) ? { ...command, status: 'uncertain', reason } : command
}

function clearPresentation(state: GameSession): GameSession['presentation'] {
  return { ...state.presentation, effects: [], reveals: [], resultEvents: [] }
}

function addEffect(state: GameSession, kind: GameEffect['kind'], roundNumber: number): GameSession {
  const effect: GameEffect = { id: state.presentation.nextEffectId, gameId: state.identity.gameId,
    generation: state.connection.generation, roundNumber, kind }
  // Deal/settlement duplicates coalesce; rapid activity remains bounded.
  const effects = kind === 'action' ? state.presentation.effects : state.presentation.effects.filter((item) =>
    item.kind !== kind || item.roundNumber !== roundNumber)
  return { ...state, presentation: { ...state.presentation,
    effects: [...effects, effect].slice(-MAX_EFFECTS), nextEffectId: effect.id + 1 } }
}

function reconcileCommand(state: GameSession, snapshot: Snapshot): CommandState {
  const pending = state.command
  if (pending.status === 'idle' || !isCommandPending(pending)) return pending
  const { command, roundNumber, actionCount, actionPrefix } = pending.attempt
  const round = snapshot.current_round
  let confirmed = false
  if (command.type === 'start_round') {
    confirmed = !!round && round.round_number > (roundNumber ?? 0)
  } else if (round && round.round_number === roundNumber) {
    if (command.data.action === 'check_cards') {
      confirmed = snapshot.players.some((player) => player.id === state.identity.playerId && player.status === 'active_seen')
    } else if (actionFingerprint(round.actions.slice(0, actionCount)) === actionPrefix) {
      confirmed = round.actions.slice(actionCount).some((action) => action.player_id === state.identity.playerId &&
        action.action === command.data.action &&
        (command.data.action !== 'compare' || action.target_id === command.data.target))
    }
  }
  if (confirmed) return { ...pending, status: 'acknowledged', reason: null }
  if (snapshot.status === 'finished' || (command.type === 'player_action' &&
    (round?.round_number !== roundNumber || round?.phase === 'settlement' || round?.phase === 'game_over'))) {
    return uncertain(pending, 'Snapshot progressed without proof of this command')
  }
  return pending
}

function acceptSnapshot(state: GameSession, data: GameStateDTO): GameSession {
  if (data.game_id !== state.identity.gameId) return state
  if (!data.players.some((player) => player.id === state.identity.playerId)) {
    return syncError(state, 'Snapshot does not contain the session player')
  }
  const snapshot: Snapshot = { ...data, round_history: upsertRoundResults(data.round_history) }
  const roundNumber = snapshot.current_round?.round_number
  const sameRound = roundNumber !== undefined && roundNumber === state.snapshot?.current_round?.round_number
  return {
    ...state, snapshot, connection: { ...state.connection, sync: 'ready' }, eligibility: null,
    command: reconcileCommand(state, snapshot), notice: null,
    presentation: { ...state.presentation, resultEvents: [],
      effects: state.presentation.effects.filter((effect) => effect.roundNumber === roundNumber),
      reveals: sameRound ? state.presentation.reveals : [] },
    receipt: snapshot.status === 'finished' ? { gameId: snapshot.game_id,
      standings: snapshot.players.map(({ id, name, chips }) => ({ id, name, chips }))
        .sort((left, right) => right.chips - left.chips) } : null,
  }
}

function syncError(state: GameSession, message: string): GameSession {
  return { ...state, connection: { ...state.connection, sync: 'error' }, eligibility: null,
    command: uncertain(state.command, message), presentation: clearPresentation(state),
    notice: { kind: 'sync_error', message } }
}

function reduceEvent(state: GameSession, event: ServerEvent): GameSession {
  switch (event.type) {
    case 'game_state':
    case 'game_started':
      return acceptSnapshot(state, event.data)
    case 'round_started': {
      if (event.data.round_number <= (state.snapshot?.current_round?.round_number ?? 0)) return state
      const next = { ...state, eligibility: null, connection: { ...state.connection, sync: 'awaiting_snapshot' as const },
        presentation: clearPresentation(state) }
      return addEffect(next, 'deal', event.data.round_number)
    }
    case 'turn_changed': {
      const round = state.snapshot?.current_round
      if (state.connection.sync !== 'ready' || round?.phase !== 'betting' ||
        selectCurrentActor(state)?.id !== event.data.current_player_id ||
        event.data.current_player_id !== state.identity.playerId) return state
      return { ...state, eligibility: { roundNumber: round.round_number,
        playerId: event.data.current_player_id, actions: event.data.available_actions } }
    }
    case 'player_acted': {
      const round = state.snapshot?.current_round
      if (!round) return state
      const next: GameSession = { ...state, eligibility: null,
        connection: { ...state.connection, sync: 'awaiting_snapshot' } }
      const compare = event.data.compare_result
      if (event.data.action !== 'compare' || !compare ||
        ![compare.winner_id, compare.loser_id].includes(state.identity.playerId)) {
        return addEffect(next, 'action', round.round_number)
      }
      let reveals = state.presentation.reveals
      for (const [playerId, cards] of [[compare.winner_id, compare.winner_cards],
        [compare.loser_id, compare.loser_cards]] as const) {
        if (cards) reveals = [...reveals.filter((item) => item.playerId !== playerId),
          { roundNumber: round.round_number, playerId, cards }]
      }
      return addEffect({ ...next, presentation: { ...next.presentation, reveals } }, 'action', round.round_number)
    }
    case 'round_ended': {
      const next = { ...state, presentation: { ...state.presentation,
        resultEvents: upsertRoundResults([...state.presentation.resultEvents, event.data]) } }
      return state.snapshot?.current_round?.round_number === event.data.round_number
        ? addEffect(next, 'settlement', event.data.round_number) : next
    }
    case 'game_ended':
      return { ...state, eligibility: null,
        receipt: { gameId: state.identity.gameId, standings: event.data.final_standings } }
    case 'error':
      // No wire request IDs: this could be another operation's error, not a rejection of our wager.
      return { ...state, eligibility: null, connection: { ...state.connection, sync: 'awaiting_snapshot' },
        command: uncertain(state.command, event.data.message),
        notice: { kind: 'server_error', message: event.data.message } }
    case 'copilot_error':
      return { ...state, notice: { kind: 'copilot_error', message: event.data.message } }
    case 'cards_dealt':
      // Viewer snapshots already own the cards. This notification cannot authorize their faces.
      return state
    case 'chat_message':
    case 'ai_thinking':
    case 'ai_reviewing':
      return state
  }
}

/** Pure transition boundary. No timers, network sends, storage, UI or optimistic game facts. */
export function gameReducer(state: GameSession, action: SessionAction): GameSession {
  if (action.type === 'connection.started') {
    if (!Number.isSafeInteger(action.generation) || action.generation <= state.connection.generation) return state
    return { ...state, connection: { generation: action.generation, status: 'connecting', sync: 'awaiting_snapshot' },
      eligibility: null, presentation: clearPresentation(state), notice: null,
      command: uncertain(state.command, 'Connection replaced before confirmation') }
  }
  if (action.generation !== state.connection.generation) return state
  switch (action.type) {
    case 'connection.opened':
      return state.connection.status === 'connecting'
        ? { ...state, connection: { ...state.connection, status: 'open' } } : state
    case 'connection.closed':
      return { ...state, connection: { ...state.connection, status: 'disconnected', sync: 'awaiting_snapshot' },
        eligibility: null, presentation: clearPresentation(state),
        command: uncertain(state.command, 'Connection closed before confirmation') }
    case 'server.message':
      if (state.connection.status !== 'open' || action.message.kind === 'unknown') return state
      if (action.message.kind === 'invalid') return syncError(state, 'Invalid server message; snapshot required')
      // Own decoded inputs, including nested arrays, before retaining them in readonly state.
      return reduceEvent(state, structuredClone(action.message.event))
    case 'command.requested': {
      if (!Number.isSafeInteger(action.id) || action.id <= state.lastCommandId) return state
      const command = action.command
      if (command.type === 'start_round') {
        if (!selectCanStartRound(state)) return state
      } else {
        if (!selectActions(state)[command.data.action].enabled) return state
        if (command.data.action === 'compare' &&
          !selectCompareTargets(state).some((player) => player.id === command.data.target)) return state
      }
      const round = state.snapshot?.current_round
      return { ...state, lastCommandId: action.id, eligibility: null, command: { status: 'sending', reason: null,
        attempt: { id: action.id, generation: action.generation, command: structuredClone(command),
          roundNumber: round?.round_number ?? null, actionCount: round?.actions.length ?? 0,
          actionPrefix: actionFingerprint(round?.actions ?? []) } } }
    }
    case 'command.sent':
    case 'command.failed':
    case 'command.timed_out': {
      const pending = state.command
      if (pending.status === 'idle' || pending.attempt.id !== action.id ||
        pending.attempt.generation !== action.generation || !isCommandPending(pending)) return state
      if (action.type === 'command.sent') {
        return pending.status === 'sending' ? { ...state, command: { ...pending, status: 'awaiting_server' } } : state
      }
      if (action.type === 'command.failed' && action.delivery === 'not_sent' && pending.status === 'sending') {
        return { ...state, command: { ...pending, status: 'rejected', reason: action.message } }
      }
      return { ...state, eligibility: null, connection: { ...state.connection, sync: 'awaiting_snapshot' },
        command: uncertain(pending, action.type === 'command.failed' ? action.message : 'Confirmation timed out') }
    }
    case 'effect.finished': {
      const token = action.effect
      const effects = state.presentation.effects.filter((effect) => effect.id !== token.id ||
        effect.generation !== token.generation || effect.gameId !== token.gameId || effect.roundNumber !== token.roundNumber)
      return effects.length === state.presentation.effects.length ? state
        : { ...state, presentation: { ...state.presentation, effects } }
    }
  }
}
