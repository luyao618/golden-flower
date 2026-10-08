# 大模型炸金花 Playable Game Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The controller owns package/PR scheduling; this document does not authorize delegation, pushing, deployment, or PR creation.

**Goal:** Rebuild 大模型炸金花 directly from its working game into an immersive, desktop-first and phone-usable card table, preserving every working user capability and completing the missing connections required for a real hand, journal/replay, results, and another game.

**Architecture:** Keep React Router, Zustand, the existing REST client and WebSocket transport, FastAPI, the Python rules engine, and SQLite. Migrate the real home, game, and results pages incrementally in place; backend snapshots own chips, turns, cards, and settlement, while presentation state owns drawers, animation, and sound. Add narrowly scoped lifecycle, persistence, and history contracts where the existing transport cannot deliver the approved experience.

**Tech Stack:** React 19, TypeScript strict mode, Vite 7, Tailwind 4, Framer Motion, Lucide, Zustand 5; Python/FastAPI/Pydantic, LiteLLM, SQLAlchemy async/SQLite; Vitest/Testing Library, Playwright, pytest, Ruff. These dependencies already exist. Use browser Web Audio for sound; no new UI framework, game engine, state library, or audio dependency.

---

## 1. Scope, provenance, and execution boundary

- Plan filename is the user-requested `2026-10-01` filename. Inspection occurred on **2026-10-08**.
- Repository: `luyao618/golden-flower`. Branch: **`feat/playable-game-rebuild`**. Isolated worktree: `/Users/yao/.herdr/worktrees/golden-flower/feat-playable-game-rebuild`.
- Inspected baseline: **`08817106201990c788b39b4ff64ab84245d96761`**. At inspection, `HEAD` and the local `origin/main` ref both resolve to that commit. No fetch, branch switch, or import from another worktree is needed.
- This first task changes **only this plan**. Implementation checkboxes are future work, not claims of completion. Commit this document with `docs: plan playable game rebuild`; do not push or create a PR.
- Preserve product name **大模型炸金花** in page title, home, table, and results. Home is the playable game's setup surface: player name, 1–5 opponents, models, stakes, and entry to the table.
- **Rejected source:** `feat/web-game-2c-shell`. Never merge, cherry-pick, copy, import assets/styles/components from, or use its page structure. No hero/features/testimonials/pricing/CTA funnel in the game. Do not inspect that branch as a design template.
- There is no separately identifiable promotional-shell subtree in the inspected stable tree to delete now. Delete any shell-only entry points, routes, components, styles, assets, fixtures, and copy if introduced during integration, before that package can pass. Do not delete shared working game code merely because it looks old.
- Remove the stable `GamePage` development mock injection in **P1**. Stable demo pages are not the rejected branch, but production routes must not expose them as the game. Remove production demo routes in P1 and delete their unused files at P8. Tests may use fixtures; production pages may not fall back to fixtures.
- Existing `docs/redesign-plan.md`, `docs/frontend-redesign-tasks.md`, `docs/design-system.md`, `docs/character-upgrade-plan.md`, and `docs/game-table-3d-upgrade.md` describe earlier visual directions. They do not override this plan. `docs/PRD.md` and `docs/TECH_DESIGN.md` are background; current code wins when they disagree.
- A package is reviewable only when its changed behavior runs against the real backend. P1 must already complete a real hand. Final acceptance additionally requires a complete game/results/new-game flow and all parity rows below. No package consisting only of tokens, primitives, portraits, or screenshots may be the first implementation package.

## 2. What the baseline actually does

### 2.1 Real frontend migration map

| Existing source | Observed responsibility | Migration destination |
| --- | --- | --- |
| `frontend/src/App.tsx` | `/`, `/lobby`, `/game/:id`, `/result/:id`, four unguarded `/demo/*` routes; global errors | Preserve public game URLs; real pages remain default; remove demo routes |
| `frontend/src/pages/WelcomePage.tsx` | Three menu buttons open model setup, game setup, and LLM settings | Inline game configuration on home; keep provider/settings access |
| `frontend/src/pages/LobbyPage.tsx` | Redirects to `/` | Preserve redirect |
| `frontend/src/components/Lobby/GameSetupModal.tsx` | Validates setup, creates game through store, navigates with returned ID | Move orchestration into home/StartButton; retire duplicate modal after parity |
| `frontend/src/components/Lobby/GameConfigForm.tsx` | Player name; per-opponent name/model; model refresh; add/remove opponents | Retain logic, support five opponents, modernize form |
| `frontend/src/components/Lobby/ChipsConfig.tsx` | Three presets and four advanced numeric settings | Retain values/ranges and explain effective betting limit |
| `frontend/src/components/Lobby/StartButton.tsx` | Already contains create/navigation/error/model-configuration behavior | Reuse on home; keep one create handler |
| `frontend/src/components/Lobby/ModelConfigPanel.tsx` | OpenRouter/Azure/Copilot/SiliconFlow; key save/check/remove; endpoint settings; catalog search/add/remove | Reuse first; refactor within existing component boundary in P2 |
| `frontend/src/components/Lobby/CopilotConnect.tsx` | Device code/link/copy, polling/slow-down, connection status, disconnect | Preserve full device flow and cancellation |
| `frontend/src/components/Lobby/GameSettingsModal.tsx` | Thinking mode, timeout, retries, temperature, max-token presets | Reuse first; accessible settings drawer in P2/P5 |
| `frontend/src/stores/gameStore.ts` | Setup plus non-persisted runtime state; create/model requests | Keep domain state, separate session identity, derive table selectors |
| `frontend/src/stores/settingsStore.ts` | Browser-persisted provider keys plus server runtime settings | Preserve storage key and semantics; add separate persistent mute store |
| `frontend/src/hooks/useWebSocket.ts` | Same-origin URL, key query, reconnect, three outbound commands | Keep single transport; stale socket guards, send result, terminal close handling |
| `frontend/src/hooks/useGame.ts` | WS events to game/UI stores, effects, action log | Snapshot reconciliation; transient effects cannot mutate authoritative game state |
| `frontend/src/pages/GamePage.tsx` | Actual socket/game page, table, chat, journal, next round, results navigation; also DEV mock injection | Actual full-screen centered table with fixed bottom dock; remove mock injection |
| `frontend/src/components/Table/TableLayout.tsx` | Seats, own cards, dealer/active IDs, animation coordinates, log/pot | Responsive six-seat geometry, common coordinates for cards/chips |
| `frontend/src/components/Player/PlayerSeat.tsx` | Portrait, chips, status, card backs/reveals, journal shortcut | Replace portrait presentation; retain all seat state and shortcuts |
| `frontend/src/components/Cards/CardFace.tsx`, `frontend/src/components/Cards/CardHand.tsx` | Suit/rank rendering and card hand | Reuse data/rendering; resize for phone, accessible visible-card names |
| `frontend/src/components/Actions/ActionPanel.tsx`, `frontend/src/components/Actions/CompareSelector.tsx` | Server actions, cost labels, fold confirmation, compare selection | Dock uses these behaviors; pending state follows acknowledgment, not a 500 ms timer |
| `frontend/src/components/Table/ChatPanel.tsx`, `frontend/src/components/Table/ChatInput.tsx`, `frontend/src/components/Player/ChatBubble.tsx` | Messages, 200-character input, send/Enter, bubbles | Chat drawer plus restrained transient seat bubble |
| `frontend/src/components/Table/GameInfoPanel.tsx`, `frontend/src/components/Table/GameLog.tsx`, `frontend/src/components/Table/PotDisplay.tsx` | Pot, round/current wager, action history, fallback/compare outcomes | Compact table HUD and journal action tab |
| `frontend/src/components/Thought/ThoughtDrawer.tsx`, `frontend/src/components/Thought/ThoughtTimeline.tsx`, `frontend/src/components/Thought/ThoughtCard.tsx`, `frontend/src/components/Thought/NarrativeView.tsx` | Per-AI/per-completed-hand decisions, narrative, reviews, loading/empty/retry | Journal drawer tabs; keep all structured fields; add replay |
| `frontend/src/pages/ResultPage.tsx`, `frontend/src/components/Settlement/Leaderboard.tsx`, `frontend/src/components/Settlement/AgentSummaryCard.tsx` | Rankings/net chips, strategy reviews, return to setup; summary component exists but receives null | Authoritative persisted results, journal/replay entry, actual summaries, new game |
| `frontend/src/components/ErrorPopup.tsx`, `frontend/src/components/CopilotErrorModal.tsx` | Error queue, dismissal, Copilot subscription explanation/account switch | Preserve actionable errors without covering dock indefinitely |
| `frontend/src/utils/theme.ts`, `frontend/src/index.css`, `frontend/src/styles/cards.css` | Old neon theme, character images, global/table/card styles | Incremental restrained table styles; remove unused old art only after all imports migrate |

### 2.2 Backend ownership and immutable game semantics

`backend/app/main.py` registers HTTP and WS routes. `backend/app/api/game_store.py` stores active games **in memory**; the database is not an active-game recovery system. `backend/app/agents/agent_manager.py` owns per-game agents. `backend/app/agents/base_agent.py` owns LLM routing, response parsing, legal-action fallback, retry/timeout, and per-agent keys. `backend/app/agents/chat_engine.py` generates table talk/reactions. `backend/app/thought/reporter.py` and `backend/app/agents/experience.py` already implement reporting/review logic, but not every path is wired into live games.

Preserve `backend/app/engine/deck.py`, `backend/app/engine/evaluator.py`, `backend/app/engine/rules.py`, and `backend/app/engine/game_manager.py` semantics:

- 52 cards, three per participating player. Order: 豹子 > 同花顺 > 同花 > 顺子 > 对子 > 散牌. A-2-3 is the lowest straight. Suits do not break ties. Compare ties eliminate the initiator; forced showdown retains the existing best-hand selection/tie behavior.
- Blind call costs `current_bet`; seen call costs `2 * current_bet`. Blind raise costs `2 * current_bet`; seen raise costs `4 * current_bet`; raising doubles the base `current_bet`. **No arbitrary raise amount, slider, all-in action, or side-pot rule exists.**
- Compare requires a seen initiator, an active other player, and enough chips; cost equals the initiator's call cost. Fold and peek cost zero. Peek does not consume the turn.
- `max_bet` limits the doubled **base wager**, not cumulative investment or pot size, despite the old label “单局下注上限”. Use “基础注额上限” with a short explanation in new UI; do not silently change engine math.
- Ante collection uses `min(ante, chips)`. Zero-chip players become out at settlement; preserve underfunded-player behavior and the available-action rules.
- First dealer is the first alive player (normally human/index 0), despite a stale “random” docstring. First actor is the next alive player. Dealer rotates thereafter. Preserve the engine's existing `turn_count` timing and max-turn settlement, including characterization tests before any bug fix.
- Hand ends with one active player or forced showdown at max turns. The pot is already awarded by `settle_round`; `player_chip_changes` is the **net change from the start of the hand**, not a patch to an already settled snapshot. Game ends naturally when at most one funded player remains.
- Distinguish **hand** (`round_number`, 局) from **game** (`game_id`, 整场). “下一局” retains game/players/chips; “再开一场” creates a new ID and resets initial chips from setup.
- Preserve free LLM strategy: portraits may communicate temperament visually, but do not introduce hardcoded personalities, change prompts to force a persona, or couple portrait gender to play strategy.

### 2.3 Confirmed gaps, not functionality to copy

| Finding in inspected source | Consequence | Required package |
| --- | --- | --- |
| `GamePage.tsx` calls `useDevMock()` when no store game exists | Development URL can show fictitious players/cards even when no real game exists | P1 |
| `gameStore.ts` and `GameConfigForm.tsx` cap opponents at 4 | Backend accepts five but UI cannot configure five | P2 |
| Runtime game/player IDs are memory-only | Refresh/direct game URL cannot establish the correct session | P1 |
| `useGame.ts` adds net chip changes after a settled snapshot, appends duplicate results, and clears `currentRound` on a delayed timer | Transient double counting and old timers erasing a new hand; phase depends on animation | P1 |
| Table peek flips UI before server acknowledgment; snapshot reconnect does not restore seen/show-card flags | Rejected peek and refresh can display the wrong card visibility | P1/P3 |
| `ActionPanel.tsx` uses a 500 ms cooldown; transport silently drops disconnected sends | Slow or stale connections can accept repeated clicks or lose intent | P1/P3/P4 |
| “结束游戏” only disconnects/navigates; REST `/end` removes memory game | Backend keeps playing on UI exit; directly wiring `/end` would break result reload | P4/P6 |
| WS handlers await the entire AI loop inside receive processing | Chat/peek can queue behind a slow AI call; reconnect can race old socket cleanup | P4 |
| WS assigns keys to agents only when the parsed map is non-empty | Removing all browser keys then reconnecting can leave an old game's prior key map attached | P4a |
| `_handle_round_end` has no `RoundDB`/chip/status persistence | Most browser-played hands have no durable round records; REST action route alone writes them | P4 |
| `_maybe_experience_review` is a no-op; summary task launch is commented out | Review/summary modules and UI exist but live games do not produce those records | P6 |
| Narrative job receives mutable `player`/chat context | Starting a hand can alter data used for the previous hand's narrative | P4/P6 |
| Thought/review wire fields can be null; frontend often expects non-null values | Empty/mode-dependent records can break rendering | P5 |
| WS chat omits game/round numbers; client sets round to 0; DB history uses numeric IDs instead of live UUIDs | History cannot safely merge with live messages by ID | P5 |
| No replay endpoint or screen; `docs/PRD.md` lists replay as future work | Replay must be completed as an approved requirement, not claimed as existing | P6 |
| No audio or persistent mute implementation found | Add real event-driven sound, not a decorative toggle | P7 |
| README/deployment text says keys are memory-only | Actual keys persist in browser localStorage and travel by header/WS query; preserve truthful copy | P2/P8 |
| `/api/game/{id}` without viewer returns debug full state; WS own cards arrive before peek | Never use viewerless state to hydrate active UI; blind own-card masking is presentation today, not a new secrecy guarantee | P1/P4 |
| Playwright config points to absent `frontend/e2e`; CI runs frontend unit tests/build only | Browser acceptance and backend checks must be added, not assumed green | P1/P8 |

## 3. Actual wire contract at 0881710

All REST URLs below are relative to the browser origin. Vite proxies `/api` and `/ws` to port 8000. `deploy/nginx.conf` supplies the production equivalent. There is no separate frontend API base environment variable today.

### 3.1 Configuration, identity, and credentials

| Method/path | Request → response/semantics |
| --- | --- |
| `GET /health` | `{status: "ok", app}`; direct backend health check |
| `GET /api/models` | `AIModelInfo[]`: `id`, `model`, `display_name`, `provider`, provider-specific metadata. Dynamic models are returned even if this browser has no key; Copilot models depend on server connection |
| `GET /api/providers` | `ProviderStatus[]`: `provider`, `name`, `configured`, masked `key_preview`, optional `extra_config` |
| `POST /api/providers/{provider}/verify` | `{key: string | null}` → `{valid, message}`; body key or current request header, never another browser's key |
| `POST /api/providers/{provider}/config` | Partial `{api_host, api_version}` → `{message, provider, extra_config}`; runtime server configuration |
| `POST /api/copilot/connect` | Device `user_code`, `verification_uri`, `expires_in` |
| `GET /api/copilot/poll` | Pending/connected status; optional `slow_down`, `interval`, model list |
| `GET /api/copilot/status` | `{connected, models, ...}` |
| `POST /api/copilot/disconnect` | Disconnect server Copilot session |
| `GET /api/{catalog}/models` | `{models, total}`; catalogs: `openrouter`, `siliconflow`, `azure-openai`, `zhipu` |
| `GET /api/{catalog}/models/added` | `{models}`; server game model IDs differ from upstream IDs |
| `POST /api/{catalog}/models` | `{model_id, display_name}` → registered `model_id`, provider upstream ID, display name/message |
| `DELETE /api/{catalog}/models/{model_id:path}` | Remove registered model; preserve slash-safe path handling |
| `GET /api/settings`, `POST /api/settings` | Read/partial update `llm_max_tokens`, `ai_thinking_mode`, `llm_timeout`, `llm_max_retries`, `llm_temperature` |

Visible provider tabs are OpenRouter, Azure OpenAI, GitHub Copilot, SiliconFlow. Zhipu routes, registry, tests, and key-store support exist, but it has no visible tab/API wrapper; retain backend compatibility and model choices without claiming an old Zhipu panel exists. Adding a new visible tab is outside required migration parity.

Keys live under **`golden-flower-provider-keys`** in localStorage. `frontend/src/services/api.ts` injects JSON in `X-Provider-Keys`. WS sends URL-encoded JSON in `provider_keys`; backend assigns the parsed map to this game's agents. Keep key isolation from commit `d8fc19d` and `backend/tests/test_agent_api_keys.py`: explicit per-agent keys, read-only environment fallback, no cross-agent credential inheritance. Never capture keys/query URLs in acceptance artifacts. Endpoint/version settings, registered model catalogs, Copilot OAuth and runtime LLM settings remain process-scoped; this rebuild is not a multi-user tenancy/auth rewrite.

Settings: modes `detailed | fast | turbo`; timeout 5–120 seconds; retries 0–10; temperature 0–2. Max-token UI presets 2048, 4096, 8192, 16384, 40960, null/unlimited. Explicit null updates max tokens; omitted fields remain unchanged. Explain turbo's lack of thoughts instead of fabricating journal entries.

### 3.2 Game REST

```ts
// Existing request; do not send a cosmetic portrait or arbitrary bet amount.
interface CreateGameRequest {
  player_name: string
  ai_opponents: Array<{ model_id: string; name?: string }>
  initial_chips: number
  ante: number
  max_bet: number
  max_turns: number
}
```

| Method/path | Observed behavior |
| --- | --- |
| `POST /api/game/create` | 1–5 AI configs; chips 100–100000, ante 1–1000, max_bet 10–10000, max_turns 3–50. Returns `{game_id, message, players}`. Find human by `player_type`, never hardcode ID/index for identity. Creates DB game/players, memory game/agents, but **does not deal** |
| `GET /api/game/{game_id}?player_id={human_id}` | `{game_id, status, players, current_round, round_history, config}`. Viewer hides other players' hands. 404 if not in memory. No active DB recovery |
| `POST /api/game/{game_id}/start` | Starts a hand and returns visible state; **does not start the WS AI orchestration**. Preserve API compatibility but browser must not combine this with WS `start_round` |
| `POST /api/game/{game_id}/action` | `{player_id, action, target_id?}` → success/action/player/amount/message/compare_result/round_ended/round_result/game_state. No arbitrary amount. Out-of-turn/illegal actions rejected. This route is not the live UI's AI driver |
| `POST /api/game/{game_id}/end` | Marks finished, persists player chips, removes memory game, returns `{message, game_id, final_standings}`. Current tests explicitly expect removal. Preserve response/removal behavior; add read-only results separately |

Game status is `waiting | playing | finished`. Current frontend flattens waiting to playing; P1 must distinguish “connected, ready to deal” from betting. Player statuses are `active_blind | active_seen | folded | compare_lost | out`. Engine snapshots retain the settled `current_round`; **null is not the only next-hand condition**.

### 3.3 WebSocket protocol and event ordering

Connect to `/ws/{game_id}?player_id={human_id}&provider_keys={encoded_json}` using `ws:` or `wss:` according to origin. Close codes before admission: 4001 missing player, 4003 wrong player, 4004 missing game. Current transport retries everything; P1 makes these terminal with a recoverable home/error screen.

Client messages are exactly:

```json
{"type":"start_round"}
{"type":"player_action","data":{"action":"check_cards"}}
{"type":"player_action","data":{"action":"call"}}
{"type":"player_action","data":{"action":"raise"}}
{"type":"player_action","data":{"action":"fold"}}
{"type":"player_action","data":{"action":"compare","target":"opponent-player-id"}}
{"type":"chat_message","data":{"content":"这局看看你的实力"}}
```

WS compare uses **`target`**, REST compare uses **`target_id`**. Preserve both.

| Server event | `data` shape | Client responsibility |
| --- | --- | --- |
| `game_state` | Visible `GameState` | Replace domain state; reconcile identity/visibility/phase; no animation on plain reconnect |
| `game_started` | Visible `GameState` | Keep support; builder exists, but normal start-round path does not emit it |
| `round_started` | `round_number, dealer, dealer_index, pot, current_bet, max_turns` | Reset hand-scoped effects; start bounded dealing presentation |
| `cards_dealt` | `your_cards: Card[] | null` | Own cards only; mask until accepted peek/seen snapshot |
| `turn_changed` | `current_player, current_player_id, available_actions: string[]` | Enable server actions only for this human, connected, no pending command |
| `player_acted` | `player_id, player_name, action, amount, compare_result, is_fallback` | Log/acknowledge/effects; chips come from snapshot |
| `chat_message` | `id, player_id, player_name, message_type, content, timestamp` | Render four types: action_talk, bystander_react, player_message, system_message |
| `round_ended` | `RoundResult`: round/winner/name/pot/win_method/hands_revealed/player_chip_changes | Upsert hand result; show settlement; do not add deltas to settled chips |
| `game_ended` | `{final_standings: [{id, name, chips}]}` | Mark finished, offer results/new game |
| `ai_thinking` | `player_id, player_name` | Status at seat/dock; no fake progress percentage |
| `ai_reviewing` | `player_id, player_name, trigger` | Retain handler; live producer is not wired at baseline |
| `error` | `{message}` | Clear matching pending state, show recoverable error; don't pretend success |
| `copilot_error` | `{message, error_code}` | Preserve dismiss and disconnect/switch-account flow |

Baseline ordering:

1. Connect → `game_state`; if the connected player has the current betting turn, `turn_changed` follows.
2. `start_round` → `round_started` → ante-adjusted `game_state` → private `cards_dealt` → AI loop until human turn/settlement.
3. Action → `player_acted` → updated `game_state`. AI loop emits thinking/action/state/talk until human turn or hand end.
4. Terminal action already settles in the engine before step 3's snapshot. Then `_handle_round_end` emits `round_ended` → another settled `game_state` → `game_ended` only if naturally finished.
5. Narratives and bystander messages may complete later. They must be bound to the originating hand, not whichever hand is current when the asynchronous task finishes.

Compare event cards/hand descriptions go only to the two participants. Other connections receive null sensitive fields. Forced showdown can reveal `hands_revealed` in the public result; folding does not reveal everyone. Preserve this distinction in table and replay. A blind human currently receives their own cards on the wire; do not claim network-level blind-hand secrecy. Never render other players' private cards from debug APIs.

### 3.4 Journal/history REST

Under `/api/game/{game_id}`:

- `GET /thoughts/{agent_id}` and `GET /thoughts/{agent_id}/round/{round_num}` return `{game_id, agent_id, round_number?, thoughts, count}`. Fields include hand/opponent/chat/risk analysis, reasoning, confidence, emotion, decision, decision_target, table_talk, raw_response, created_at. UI shows the structured fields, not raw LLM dumps by default.
- `GET /narrative/{agent_id}/round/{round_num}` returns narrative/outcome metadata; 404 means no record yet, not necessarily a broken connection.
- `GET /summary/{agent_id}` returns nested `stats` and narrative/review fields. `api.ts` already flattens `stats` for `GameSummary`; preserve this adapter.
- `GET /reviews/{agent_id}` returns `{reviews, count, ...}`. Preserve trigger, reviewed rounds, self-analysis, opponent patterns, adjustment, confidence shift, strategy context.
- `POST /cancel-summaries` cancels registered summary tasks and returns count; retain API even while P6 repairs generation.
- `GET /chat` and `GET /chat/round/{round_num}` return `{messages, count, ...}` from SQLite. Live chat UUID and persisted numeric ID differ today.

These APIs do not currently gate all data on completed hands; the drawer only offers `round_history` hands. Preserve the UI boundary and explicitly filter newly added replay responses. There is no existing `/results`, `/rounds`, or `/replay` route: contracts in section 5 are additions.

## 4. Target architecture and visible experience

### 4.1 Route and state boundaries

Keep `/` → `/game/:id` → `/result/:id`; keep `/lobby` as redirect. No parallel replacement SPA, no `/new-game` static preview default, and no copied legacy application tree. Every package updates the real route while untouched working components remain reachable.

```text
WelcomePage (inline real setup; providers/settings drawers)
  └─ gameStore.createGame → POST /api/game/create
       └─ sessionStore saves {gameId, playerId} → /game/:id
            └─ GamePage / useGame / useWebSocket
                 ├─ server snapshots → gameStore → table/dock
                 ├─ accepted events → uiStore → short effects/audio
                 ├─ REST history → chat/journal/replay drawers
                 └─ end request / natural finish → persisted results
                      └─ ResultPage → retained setup → new create request
```

State responsibilities:

| File | Responsibility and interface |
| --- | --- |
| Existing `frontend/src/stores/gameStore.ts` | Authoritative last snapshot plus setup. Keep create/fetchModels and existing public selectors; upsert results by round number. Store `status: waiting` honestly. Remove chip arithmetic from event effects |
| New `frontend/src/stores/sessionStore.ts` | Zustand `persist` with sessionStorage name `golden-flower-session-v1`; `sessions: Record<gameId, {playerId}>`, `remember(gameId, playerId)`, `forget(gameId)`. Store no cards, results, keys, or simulated state |
| Existing `frontend/src/stores/uiStore.ts` | Open drawer, selected AI/hand, compare/fold confirmation, pending command, visual effects. `resetUI` cancels timers/effects; mute is not reset here |
| New `frontend/src/stores/preferencesStore.ts` | Persist `{muted}` under `golden-flower-preferences-v1` in localStorage; default false, audio remains locked until gesture |
| Existing `frontend/src/hooks/useGame.ts` | Single event adapter per mounted game; snapshot replacement and accepted command effects; reject stale game/socket events. Rehydrate seen/card display from server status |
| Existing `frontend/src/hooks/useWebSocket.ts` | `sendAction`, `sendChatMessage`, `sendStartRound` return boolean for sent/not sent; no automatic replay of a betting command after reconnect; maintain current retry backoff for recoverable closes |
| New `frontend/src/hooks/useGameSession.ts` | Resolve route ID against remembered identity, fetch viewer state, then connect; states `loading`, `ready`, `missing`, `error`; explicit retry/home actions, not endless spinner |
| New `frontend/src/utils/gameView.ts` | Pure `canStartHand`, `canPeek`, `getActionCost`, `getTablePhase` selectors; costs display engine formulas, authorization still comes from server |
| Existing `frontend/src/services/api.ts` | Existing request/key behavior plus typed result/history calls. Add structured HTTP error status for 404-pending versus transport errors without exposing request credentials |
| New `frontend/src/types/history.ts` | Explicit DTOs for the additive history/result APIs; don't overload live `GameState` with replay cursor state |
| New `frontend/src/hooks/useGameAudio.ts`, `frontend/src/services/gameAudio.ts` | Gesture-unlocked, muted-aware event sound; never a driver of game progress |

A hard reload with a remembered identity fetches `/api/game/{id}?player_id=...`, then receives a fresh WS snapshot. A mismatched or missing identity offers return to setup; it must not select a player from a viewerless debug response. Missing active game after backend restart is shown as unavailable; completed results/history can still load from DB after P4. Do not promise resumable active games across backend restart or multiple backend workers.

P1 snapshot rules:

```ts
// frontend/src/utils/gameView.ts
import type { GameState, Player, RoundState } from '../types/game'

export function canStartHand(game: GameState | null): boolean {
  return game !== null && game.status !== 'finished' &&
    (!game.current_round || game.current_round.phase === 'settlement')
}

export function canPeek(game: GameState | null, player: Player | undefined): boolean {
  return game?.status === 'playing' && game.current_round?.phase === 'betting' &&
    player?.status === 'active_blind'
}

export function getActionCost(
  action: 'call' | 'raise' | 'compare', round: RoundState, player: Player,
): number {
  const call = player.status === 'active_blind' ? round.current_bet :
    player.status === 'active_seen' ? round.current_bet * 2 : 0
  return action === 'raise' ? call * 2 :
    action === 'compare' && player.status !== 'active_seen' ? 0 : call
}

export function getTablePhase(game: GameState | null) {
  if (!game) return 'loading' as const
  if (game.status === 'finished') return 'finished' as const
  if (canStartHand(game)) return 'ready' as const
  return 'betting' as const
}
```

Do not set `currentRound = null` when an animation completes. A settlement panel may be dismissed independently, but the last server round remains intact. `round_ended` upserts by `round_number`, triggers one win effect, and leaves chip amounts to the adjacent snapshot. Snapshot reconciliation restores `hasLookedAtCards` from the human's `active_seen` status; a local tap never flips cards before acknowledgment. A new hand resets old reveals. `hands_revealed` from forced showdown is also displayed; do not only handle compare events.

Pending commands disable relevant actions until matching acknowledgment/error, phase/turn change, or connection loss. A failed send retains chat draft/compare choice and reports not connected. A timeout clears neither money nor the turn locally: show “等待服务器确认”, request fresh state/reconnect, and require an explicit subsequent action after reconciliation. In P4, an optional request ID makes retries/double delivery idempotent. Keep opponent thinking, connection status, and whose turn it is visible while a drawer is open.

Use one explicit pending-command contract in `uiStore.ts`: `pendingCommand: { requestId: string; kind: 'start_round' | 'player_action'; action?: GameAction; target?: string; roundNumber: number | null } | null`, with `setPendingCommand(command)` and reset on game change. P1 correlates the one pending command with existing action/round events; P4a adds the optional wire ID. Transport signatures after P4a are `sendAction(action: GameAction, target?: string, requestId?: string): boolean`, `sendStartRound(requestId?: string): boolean`, and `sendChatMessage(content: string, requestId?: string): boolean`. `UseGameReturn` and transport return types must change together. UI camelCase `requestId` serializes as top-level `request_id`; events echo that top-level key. Chat does not share the betting-command lock.

### 4.2 Table and responsive layout

Create `frontend/src/components/Table/TableShell.tsx` as the **layout for the connected children**, not a fixture page. Create `frontend/src/components/Actions/ActionDock.tsx` for connected action/settlement controls. Continue using `TableLayout`, `PlayerSeat`, `CardHand`, and `ActionPanel` until their in-place migrations are verified.

- Desktop 1440×900 and 1280×720: `height: 100dvh`; compact top bar; centered felt table using CSS gradients/edge/shadow; six clearly separated seats around its perimeter, human at bottom; pot and wager at center; dock spans bottom with safe-area padding. Reserve actual dock height from table content; no absolute floating chat panel colliding with cards.
- Phone 390×844 and 360×640: vertical table; compact opponent seat cards in two upper/side rows; readable human cards above a two-row dock; five opponents remain individually identifiable. No horizontal document scroll or scaled-down desktop canvas. Landscape 844×390 uses compact seats and one-row controls where possible.
- Seat priority: turn indicator, portrait/name/model, chips, blind/seen/fold/out status, three cards, contribution. Decorative character bodies/backgrounds must not displace chips/cards. Use CSS grid/percentage anchors with minimum seat sizes; use one shared geometry map for chip paths and seat positions.
- Restrained palette: charcoal surroundings, deep green felt, warm ivory type/cards, muted brass for pot/winner, one teal accent for primary action, red for destructive/error. No continuously pulsing neon, perspective background images, or unrelated character styles.
- Card deal 120–180 ms stagger; chip movement 180–240 ms; winner emphasis under 900 ms. Motion does not hold the authoritative state or delay next-hand availability. `prefers-reduced-motion` disables travel/scale while keeping state indicators.
- Home shows real setup above the fold on desktop, scrolls naturally on phone, and has a persistent create action. Provider configuration and LLM settings are reachable from home and the table; returning from them retains setup.
- Chat/journal/settings use accessible drawers: dialog name, Escape/backdrop close, initial focus, focus trap, focus restoration, scrollable body, 44 px targets. Phone drawers use available viewport height and keep composer usable above the virtual keyboard. Only one drawer is modal at a time.
- Keyboard: real buttons, visible focus, no shortcut activation while typing/IME composition. Existing Q/W/E/R/F badges have no implemented key handler: either implement documented shortcuts in P3 with tests or remove the badges. This plan chooses to implement them for available actions only, retaining fold confirmation.

## 5. Necessary backend additions and compatibility limits

Do not change hand rankings, wagering rules, ante/dealer order, AI decision prompts, or existing action names. Do not replace the backend with a frontend simulation. Changes below fix end-to-end behavior and must carry regression tests.

### 5.1 Lifecycle serialization (P4)

Create `backend/app/services/game_runtime.py` with a per-game runtime owned by `GameStore`/the existing service singleton. It holds a mutation lock, one AI task, immutable hand snapshots for report jobs, and a bounded set of processed request IDs. It is not a new database, worker queue, or distributed service.

- Route REST and WS mutations through the same per-game lock. Never hold the mutation lock across an external LLM call. Capture acting player/hand/turn identity before a call, revalidate after it returns, and discard stale decisions after finish/new hand. Legal-action validation still uses the existing engine.
- Schedule one AI task per game; the receive loop remains available for chat and zero-cost peek. Multiple connections/duplicate starts cannot start two AI loops. Reconnect joins the existing task or restarts one only when none is running and an AI legitimately owns the turn.
- `disconnect(game_id, player_id, websocket)` only removes the same socket instance. An old socket closing must not unregister its replacement. `send_to_player` targets the current connection.
- Validate peek only during betting, on an active blind player. Record it in `current_round.actions` without advancing the actor. This repairs missing journal records while retaining the WS capability to peek outside the human's turn.
- Optional client envelope field `request_id: string`; optional echoed `request_id` on command events/errors; optional `event_id` and `round_number` on effect-bearing events. Old messages without them still work. Repeated request ID returns current state/ack without charging, dealing, or chatting twice. Bound cache to the game lifetime, at most 512 recent IDs. Do not auto-resend money commands from a client reconnect queue.
- On a new admitted socket, replace the game's agent key map even when the parsed map is empty. Test remove-all-keys then reconnect cannot retain the old browser key; existing read-only server environment fallback remains the same.
- On explicit end, cancel/invalidate the AI task before memory removal; clean up runtime/agents/sockets after persistence. Legacy `/end` still returns the existing standings shape and removes `GameStore` entry. New UI only invokes it before first deal or after settlement. During betting, “结束游戏” offers **完成本局后结束** or cancel: remember that intent, allow fold/play through the real hand, then call `/end`. Do not invent a mid-hand winner/refund rule.

### 5.2 Persisted completed hands and results (P4)

Add `persist_completed_round(db, game)` in `backend/app/api/persistence.py`; call it for both REST and WS terminal actions before announcing completion. Within the serialized game mutation, check `(game_id, round_number)` and write once. Use existing `RoundDB`, `PlayerDB`, `GameDB`; no destructive schema migration. Mark natural finishes in DB with `finished_at`. A persistence failure must be visible/retryable and must not cause the engine to pay the same pot again.

Store ordered `ActionRecord` dictionaries in `RoundDB.actions`; additional `compare_result` metadata is allowed in that JSON record. Capture all dealt hands internally in `RoundDB.hands` for authorized replay filtering, with the same player-ID-to-card-list shape. They are server-side data, never returned unfiltered. Existing baseline records may have only showdown hands: replay must display unknown cards for unavailable data and never fabricate them. No old caller receives additional hidden hands in a live snapshot.

Add routes in new `backend/app/api/history.py`, register under `/api/game` in `backend/app/main.py`:

```ts
// frontend/src/types/history.ts — new DTOs, not baseline contracts
import type { ActionRecord, Card, GameConfig, Player, RoundResult } from './game'

export interface GameResults {
  game_id: string
  status: 'waiting' | 'playing' | 'finished'
  config: GameConfig
  players: Array<Omit<Player, 'hand'> & { hand: null }>
  round_history: RoundResult[]
  final_standings: Array<{ id: string; name: string; chips: number }>
}

export interface ReplayAction extends ActionRecord {
  compare_result?: {
    winner_id: string
    loser_id: string
  } | null
}

export interface RoundReplay {
  game_id: string
  round_number: number
  initial_chips_by_player: Record<string, number>
  ante_by_player: Record<string, number>
  actions: ReplayAction[]
  result: RoundResult
  reveals: Array<{
    after_action: number
    at_settlement?: boolean
    player_id: string
    cards: Card[]
  }>
}
```

| New endpoint | Contract/error behavior |
| --- | --- |
| `GET /api/game/{game_id}/results` | `GameResults` from DB, never raw hands. Works after `/end` and process restart. 404 unknown game; reflects playing if not finished, which UI labels honestly |
| `GET /api/game/{game_id}/rounds` | `{game_id, rounds: RoundResult[]}` ordered completed hands; only public showdown cards in `hands_revealed` |
| `GET /api/game/{game_id}/rounds/{round_num}/replay?player_id={human_id}` | `RoundReplay` for a completed hand; 404 unavailable hand, 409 still active, 400 invalid viewer. Validate viewer belongs to game; this uses existing identity semantics, not a new authentication claim |

Derive starting stacks from `PlayerDB.initial_chips` plus earlier completed net changes, and antes by `min(config.ante, starting_stack)` for participating players. Replay cursor 0 represents the table after ante collection; cursor N includes the first N actions. Compute pot/contributions/statuses from recorded amounts/actions, not a fresh engine deal. Award pot once at the final settlement frame. `after_action` is this cursor count: own accepted peek reveals own cards then; human-involved compare reveals both participants then; AI-vs-AI compare reveals outcome only; forced showdown uses `after_action: actions.length, at_settlement: true` so its public hands appear only at the settlement frame. Other reveal entries omit `at_settlement` or set false. Unseen/folded/private hands remain backs. If old action records lack compare outcome, show the recorded action plus final result, not an invented elimination sequence.

Register specific history routes without shadowing the existing single-segment `/{game_id}` route. Keep existing thought/chat/model/settings APIs and tests. Use this DB read model for results rather than changing `/end`'s removal behavior.

### 5.3 Reliable chat/journal generation (P5/P6)

For chat, persist before publishing and use the DB row ID (string) as the live message ID, so GET history and WS agree without a schema migration. Add optional `game_id` and `round_number` to live chat data; old clients ignore them. Use captured hand number for delayed reactions. New client merges by ID, subscribes before fetching history, and merges fetched/live messages so no message falls into a load gap. Test the actual persistence session used by WS, not only FastAPI's `get_db` override.

For reports, copy settled hand/player/chat data before scheduling background jobs. Reuse `ThoughtReporter`; generated prose is asynchronous and must never hold the next-hand action hostage. Add `GET /api/game/{game_id}/journal-status` in `backend/app/api/thought.py` returning:

```ts
export interface JournalStatus {
  game_id: string
  narratives: Record<string, Record<string, 'pending' | 'ready' | 'failed'>>
  summaries: Record<string, 'pending' | 'ready' | 'failed' | 'cancelled'>
}
```

Agent IDs key both maps; stringified hand number keys narratives. Ready status derives from DB, pending from tracked running tasks; absent records with no task after restart are failed/unavailable, not eternally pending. No new DB schema is needed. Expose retry explicitly through `POST /api/game/{game_id}/journal-retry` with `{agent_id, round_number?: number}`: hand number retries its narrative, omission retries finished-game summary; reject active-hand/unfinished-summary requests with 409, unknown agent/game with 404, deduplicate running jobs. Build retry inputs from persisted records. Read-only polling must not silently make repeated paid LLM calls.

Retry resolves the persisted agent's model ID against the currently configured model registry and reads this request's keys with `parse_provider_keys_header`, then calls `agent.set_api_keys` on its own job agent. After a process restart, missing model registration/Copilot connection returns 409 with a reconfigure-model instruction; never silently select a different model. Capture the existing game agent and immutable report inputs before `/end` removes the live runtime, so finishing a game does not strand its summary job. Report jobs have their own lifecycle and do not keep a live game socket or AI turn loop alive.

Experience reviewers belong to a `(game_id, agent_id)` across hands. At each completed hand call `check_trigger` once, using the existing five-trigger semantics. Queue the resulting review for that agent's next decision (or final report if finished), broadcast `ai_reviewing`, load the last five completed-hand records/narratives, call `perform_review`, persist, and `set_strategy_context`. Never instantiate a fresh reviewer each turn or double-count the same completed hand. This connects the existing capability without imposing cosmetic personalities.

Enable full-game summaries through the existing `ThoughtReporter.generate_game_summary` after completed-hand data/report jobs are ready, with bounded waiting and explicit failure status. For providers rejecting `json_object`, retry that specific unsupported-format response without the response-format parameter and parse the response with existing parsers; do not broadly remove JSON constraints or retry authentication/403 errors as formatting problems. Test this before re-enabling the previously commented launch. Keep `/cancel-summaries` working and expose cancel while generating plus explicit retry after cancellation. Do not delete completed reports when the player starts another game.

## 6. Exhaustive acceptance/parity checklist

All rows remain unchecked until implementation evidence exists. “Repair” identifies a baseline gap, not permission to drop it. Package families P4 and P6 are split into focused PRs in section 7. Test paths listed there are mandatory owners of these behaviors.

| Done | Capability and acceptance condition | Owner | Evidence |
| --- | --- | --- | --- |
| [ ] | Product title is 大模型炸金花; `/` is real configuration, `/lobby` redirects | P1 | Home component/browser tests |
| [ ] | Player nickname, blank-name fallback, custom AI names and model-name shortening/deduplication | P1/P2 | gameStore and home tests |
| [ ] | Add/remove **1–5** AI opponents; sixth rejected; last opponent cannot be removed | P2 | Store/form tests and six-seat browser run |
| [ ] | Per-seat model selection, mixed providers, long IDs/names, catalog refresh and stale-model correction | P2 | Model panel/store tests |
| [ ] | OpenRouter key save/check/remove and catalog search/add/remove | P2 | Panel, API, key-isolation tests |
| [ ] | Azure key, endpoint, API version, deployment catalog/add/remove | P2 | Panel/API tests; real provider smoke when configured |
| [ ] | SiliconFlow key, custom host, catalog/search/add/remove | P2 | Panel/API tests |
| [ ] | Copilot device code, verification link/copy, pending, slow_down, expiry/denial, reconnect, disconnect | P2 | CopilotConnect tests/backend model-config suite |
| [ ] | Retain Zhipu backend APIs/model availability/key compatibility | P2 | Existing model/API/key tests |
| [ ] | Browser key persistence/removal affects future REST and newly opened WS connections; keys never appear in reports | P2/P4a | Header/URL tests using synthetic keys only |
| [ ] | Missing key/model, invalid key, network/catalog failure, loading and retry preserve editable setup | P1/P2 | Home/panel tests |
| [ ] | Presets 500/5/100/8, 1000/10/200/10, 5000/50/1000/15 retained | P2 | ChipsConfig tests |
| [ ] | All four advanced stake settings/ranges retained; base-wager limit labeled accurately | P2 | Form/API tests |
| [ ] | One create request per click sequence; returned IDs used; no fixtures on success/failure/invalid URL | P1 | Connected-hand browser test, GamePage test |
| [ ] | Connection indicator, recoverable reconnect/manual retry, terminal missing-game screen | P1/P4 | WS hook/runtime tests |
| [ ] | Refresh retains identity; seen hand/turn restored; another game cannot inherit stale state | P1/P4 | Session and browser reload tests |
| [ ] | First deal requires connected server; ante/pot/chips/cards originate in backend | P1 | Real hand and backend flow tests |
| [ ] | Human blind cards stay face down until accepted peek; three actual ranks/suits shown afterward | P1/P3 | Peek rejection/reload/browser tests |
| [ ] | Peek outside human turn remains supported; no turn/charge consumed; no settlement peek | P3/P4 | WS regression tests |
| [ ] | Call/raise costs match blind/seen formulas; raise doubles base; insufficient chips/max base disable actions | P3 | rules and ActionPanel tests |
| [ ] | Fold confirm/cancel works; accepted fold hands control to real AI sequence | P1/P3 | Actions/browser tests |
| [ ] | Compare selects only active opponents; cancel; participant reveal; losing state; ties lose for initiator | P3/P4 | engine/WS/privacy/browser tests |
| [ ] | AI-vs-AI private cards remain hidden; forced showdown reveals only public result hands | P3/P4/P6 | WS privacy and replay tests |
| [ ] | AI thinking, fallback action indicator, reviews and table talk are server-driven | P1/P6 | WS, journal, browser traces |
| [ ] | Delayed/invalid/failed LLM response uses existing fallback; Copilot error dismiss/account-switch stays reachable | P4/P6 | Agent/API/error UI tests |
| [ ] | No duplicate money action on double-click/reconnect; stale AI cannot act after end/new hand | P4 | Runtime concurrency tests |
| [ ] | Pot, contributions, stacks, round/turn, dealer/current actor and statuses remain prominent | P3 | Desktop/phone visual acceptance |
| [ ] | Live action log includes amount, target/outcome, peek and fallback annotation | P3/P4/P5 | Log/WS tests |
| [ ] | Human chat trims blank input, 200-character limit, Enter send, IME safe, draft kept on failed send | P5 | ChatInput and browser tests |
| [ ] | AI action talk, bystander reactions, system messages, seat bubbles retained | P5 | Chat engine/WS/drawer tests |
| [ ] | Chat drawer/history survives close/open/reconnect; per-hand history; live/GET merge does not duplicate | P5 | Persistence/history tests |
| [ ] | Journal reachable via button and AI seat; AI and completed-hand selection retained | P5 | Drawer tests |
| [ ] | Decision details: hand/opponents/risk/chat/reasoning/confidence/emotion/action/target/table talk | P5 | ThoughtCard tests with real DTO-shaped data |
| [ ] | Detailed/fast/turbo modes render partial/empty thoughts truthfully | P2/P5 | Settings/normalizer tests |
| [ ] | Narrative/outcome load, pending/failure/retry states, no previous-hand async contamination | P5/P6 | Report job/REST tests |
| [ ] | Experience triggers, reviewed rounds, analysis, patterns, adjustments/confidence/context preserved and generated | P6b | Existing experience suite plus live wiring test |
| [ ] | Replay selects completed hand, steps previous/next, play/pause/restart and scrubs recorded actions | P6a | Replay projection and real history browser tests |
| [ ] | Replay hides cards until permitted reveal; unknown legacy data remains unknown; cannot dispatch live actions | P6a | Replay privacy/browser tests |
| [ ] | Settlement winner/method/pot/net deltas are backend values; chip total conserved; result stored exactly once | P1/P4 | Event-order/DB assertions |
| [ ] | Next hand retains game/chips and rotates dealer; no leftover cards/timers; eliminated players remain identifiable | P1/P3/P4 | Two-hand real browser run |
| [ ] | Human eliminated: clear spectator/out state, remaining AI hand can finish, no enabled human betting controls | P3/P4 | Engine/WS/browser scenario |
| [ ] | Explicit end truly finalizes backend after current hand; cancel end stays at table | P4/P6a | End/result browser test |
| [ ] | Natural finish shows accurate ranking/net changes and no next-hand action | P4/P6a | Natural-finish backend/browser scenario |
| [ ] | Results survive reload and backend restart; no unrelated store game used for route | P4/P6a | Results API/Page tests |
| [ ] | Summary stats/key moments/impressions/reflection/chat strategy/learning/narrative; cancellation/retry | P6b | Reporter/API/summary UI tests |
| [ ] | New game returns to real setup, retains chosen setup/preferences, creates a different ID and fresh chips | P6a | Browser game→results→new-game path |
| [ ] | LLM settings all preserved; save errors do not show unaccepted values as saved | P2 | Settings store/modal tests |
| [ ] | Coherent semi-realistic portrait set, varied genders/temperaments, stable seat mapping across reload/results | P7 | Asset manifest/visual review |
| [ ] | Deal/chip/win sound plays only for accepted live events after gesture; mute persists through reload/new game | P7 | Audio/preferences tests and manual listening |
| [ ] | 1280×720/1440×900 and 360×640/390×844/844×390 usable with five AI | P3/P8 | Playwright viewport acceptance |
| [ ] | Dock visible, 44 px touch targets, keyboard focus/IME, accessible drawers, reduced-motion support | P3/P5/P7/P8 | Browser accessibility assertions/manual phone check |
| [ ] | No rejected shell, production demo routes, dev mock injection, or fake success/fallback data | P1/P8 | Source/import scan and backend-off browser check |
| [ ] | Real provider produces at least one non-fallback decision in complete browser hand/game evidence | P1/P8 | Sanitized live-provider acceptance record |

## 7. Ordered implementation packages / focused PRs

The controller may stage these packages as PRs, but this agent's current task only commits the plan. All implementation work for this integration remains on `feat/playable-game-rebuild` in this worktree. Do not create a second speculative implementation branch here. Each named test below is either an existing file to extend or explicitly marked **Create**. Per-package test-first steps are small checkpoints; finish the connected outcome before publishing a package. Commit commands stage explicit paths, never `git add .`.

| Order | Package | Independently reviewable connected outcome | Depends on |
| --- | --- | --- | --- |
| 1 | P1 — honest connected hand | Real setup→create→deal→AI→human action→settlement→next hand, no mock injection | Stable baseline |
| 2 | P2 — configuration parity | All real providers/settings/stakes and five opponents usable from home | P1 |
| 3 | P3 — immersive table/dock | Existing live game in modern desktop/phone table, all actions retained | P1/P2 |
| 4 | P4a — lifecycle/reconnection | Responsive chat/peek while AI works; serialized commands, safe end/reconnect | P3 |
| 5 | P4b — persisted rounds/results | Browser hands persisted and queryable; results survive memory removal | P4a |
| 6 | P5 — chat/journal drawers | Actual chat/history/thoughts/narratives with accessible drawers | P4b |
| 7 | P6a — results and replay | End whole game, inspect real replay/results, create new game | P5 |
| 8 | P6b — report/review completion | Existing review/summary modules connected, visible generation/retry/cancel | P6a |
| 9 | P7 — characters/audio | New coherent portraits and restrained persistent-mute sound in real table | P3/P6b |
| 10 | P8 — quality/cutover | Complete verified real-provider flow, phone acceptance, cleanup and release evidence | All above |

### P1 — Real connected vertical slice (first implementation PR)

**Modify:** `frontend/src/App.tsx`, `frontend/src/pages/WelcomePage.tsx`, `frontend/src/pages/GamePage.tsx`, `frontend/src/components/Lobby/StartButton.tsx`, `frontend/src/stores/gameStore.ts`, `frontend/src/stores/uiStore.ts`, `frontend/src/hooks/useGame.ts`, `frontend/src/hooks/useWebSocket.ts`, `frontend/src/services/api.ts`, `frontend/playwright.config.ts`.

**Create:** `frontend/src/stores/sessionStore.ts`, `frontend/src/hooks/useGameSession.ts`, `frontend/src/utils/gameView.ts`, `frontend/src/pages/__tests__/GamePage.test.tsx`, `frontend/src/pages/__tests__/WelcomePage.test.tsx`, `frontend/src/stores/__tests__/sessionStore.test.ts`, `frontend/e2e/connected-hand.spec.ts`, `frontend/e2e/support/liveGame.ts`.

**Extend tests:** `frontend/src/hooks/__tests__/useGame.test.ts`, `frontend/src/hooks/__tests__/useWebSocket.test.ts`, `frontend/src/stores/__tests__/gameStore.test.ts`, `frontend/src/components/Lobby/__tests__/GameSetupModal.test.tsx` while modal remains, `frontend/src/services/__tests__/api.test.ts`. No backend product changes in this package; run existing `backend/tests/test_game_api.py`, `backend/tests/test_websocket.py`.

- [ ] **1. Write a failing real event-order regression** in existing `useGame.test.ts`, using its existing `fire`, `resetStores`, `renderHook`, and mocked transport. Add this complete case; it fails at baseline because chips become 560/440 after the already settled state and round history duplicates.

```ts
it('does not pay settlement twice or erase the server round', () => {
  vi.useFakeTimers()
  try {
    renderHook(() => useGame({ gameId: 'g1', playerId: 'p1' }))
    const result = {
      round_number: 1, winner_id: 'p1', winner_name: 'Me', pot: 60,
      win_method: '其他玩家全部弃牌', hands_revealed: null,
      player_chip_changes: { p1: 30, p2: -30 },
    }
    fire({ type: 'game_state', data: {
      game_id: 'g1', status: 'playing',
      config: { initial_chips: 500, ante: 10, max_bet: 200, max_turns: 10 },
      players: [
        { id: 'p1', name: 'Me', avatar: '', player_type: 'human', chips: 530,
          status: 'active_seen', hand: null, total_bet_this_round: 30, model_id: null },
        { id: 'p2', name: 'Bot', avatar: '', player_type: 'ai', chips: 470,
          status: 'folded', hand: null, total_bet_this_round: 30, model_id: 'm1' },
      ],
      round_history: [result],
      current_round: { round_number: 1, pot: 60, current_bet: 10, dealer_index: 0,
        current_player_index: 0, actions: [], phase: 'settlement', turn_count: 1,
        max_turns: 10 },
    } })
    fire({ type: 'round_ended', data: result })
    expect(useGameStore.getState().players.map(p => p.chips)).toEqual([530, 470])
    expect(useGameStore.getState().roundHistory).toHaveLength(1)
    act(() => vi.advanceTimersByTime(2000))
    expect(useGameStore.getState().currentRound?.phase).toBe('settlement')
  } finally {
    vi.useRealTimers()
  }
})
```

- [ ] **2. Run the red test:** from `frontend`, `npm test -- src/hooks/__tests__/useGame.test.ts`. Expected: new case fails on chips/history; don't rewrite expectation to preserve the defect.
- [ ] **3. Repair reconciliation:** remove chip-delta updates and delayed domain clearing from `round_ended`; use the complete `gameView.ts` code in section 4; replace `addRoundResult` with the following upsert. Adjust the old test that explicitly expects client-side chip addition to assert snapshot ownership instead.

```ts
addRoundResult: (result) => set((state) => ({
  roundHistory: [...state.roundHistory.filter(
    existing => existing.round_number !== result.round_number,
  ), result].sort((a, b) => a.round_number - b.round_number),
})),
```

- [ ] **4. Write session tests:** remember g1/p1; rehydrate after resetting only runtime store; g2 cannot use p1; forget g1 removes only g1; no card/key fields in storage. Implement the session store exactly as below; call `remember` only after finding a real human in a successful create response. Missing human is an error, not a navigable game.

```ts
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface SessionState {
  sessions: Record<string, { playerId: string }>
  remember: (gameId: string, playerId: string) => void
  forget: (gameId: string) => void
}

export const useSessionStore = create<SessionState>()(persist((set) => ({
  sessions: {},
  remember: (gameId, playerId) => set(state => ({
    sessions: { ...state.sessions, [gameId]: { playerId } },
  })),
  forget: (gameId) => set(state => ({
    sessions: Object.fromEntries(Object.entries(state.sessions).filter(([id]) => id !== gameId)),
  })),
}), {
  name: 'golden-flower-session-v1',
  storage: createJSONStorage(() => sessionStorage),
  partialize: state => ({ sessions: state.sessions }),
}))
```

- [ ] **5. Connect real pages:** replace WelcomePage's three-button-only body with `GameConfigForm`, `ChipsConfig`, and `StartButton`, retaining model/settings controls. In `WelcomePage.test.tsx` verify name/model/stakes affect the real create request, create failure retains fields, and successful response navigates with its game ID; migrate applicable modal test cases without deleting them yet. Remove `DEV_MOCK_ENABLED`, all `MOCK_*`, `useDevMock`, and its call from GamePage. Keep existing real table/chat/journal/actions in this first slice. Remove the four demo imports/routes from App. Implement `useGameSession`'s four states from section 4: remembered viewer GET, mounted-request cancellation, state install, and explicit retry/home. Do not call REST `/start`; use the connected `sendStartRound` button for both first/next hand.
- [ ] **6. Add failing transport/route cases:** unknown game URL never renders mock players; reload restores seen human and legal action state; 4004 stops reconnect; disconnected send returns false; stale socket messages cannot update current game. Implement boolean `sendRaw`/wrappers and check socket identity in **onopen/onmessage/onerror as well as onclose**. Guard betting controls by connection status and pending state; do not discard chat text on a false return.
- [ ] **7. Add live browser test:** `connected-hand.spec.ts` must use real `/api` and `/ws`, no `page.route` response fixtures and no Zustand injection. `support/liveGame.ts` reads only `GF_LIVE_PROVIDER`, `GF_LIVE_MODEL`, `GF_LIVE_KEY` for the chosen configured provider; it configures through the visible panel, observes WS frame types and redacts content/URL. If unavailable, mark the automated live test skipped and record the unmet manual gate; never call that acceptance passed. Concrete browser path is section 9. Repair Playwright's shell-dependent `source` command to `uv run --frozen --extra dev uvicorn app.main:app --host 127.0.0.1 --port 8000` with backend cwd, and use `npm run dev -- --host 127.0.0.1 --strictPort`. Do not silently attach tests to unrelated existing servers.
- [ ] **8. Verify:** `npm test`, `npm run build`, `npm run lint`; `uv run --frozen --extra dev pytest tests/test_game_api.py tests/test_websocket.py`; `npm run test:e2e -- e2e/connected-hand.spec.ts --project=chromium`. Complete a real-provider hand and start the next hand. Expected: returned game ID, actual AI non-fallback action, human action acknowledged, server settlement/stack total, same game ID with round 2. Existing lint debt is recorded by file, not suppressed or called green; full cleanup belongs to P8.
- [ ] **9. Commit only this connected package:** stage the explicit Modify/Create/Extend files above and use `git commit -m "feat: restore an honest connected game flow"`. Attach sanitized observed IDs/action sequence and test results to the controller's package notes. Do not accept a home screenshot as proof.

### P2 — Complete configuration parity and five opponents

**Modify:** `frontend/src/pages/WelcomePage.tsx`, `frontend/src/components/Lobby/GameConfigForm.tsx`, `frontend/src/components/Lobby/ChipsConfig.tsx`, `frontend/src/components/Lobby/ModelConfigPanel.tsx`, `frontend/src/components/Lobby/CopilotConnect.tsx`, `frontend/src/components/Lobby/GameSettingsModal.tsx`, `frontend/src/stores/gameStore.ts`, `frontend/src/stores/settingsStore.ts`, `frontend/src/types/game.ts`, `frontend/src/services/api.ts`.

**Create tests:** `frontend/src/components/Lobby/__tests__/GameConfigForm.test.tsx`, `frontend/src/components/Lobby/__tests__/ChipsConfig.test.tsx`, `frontend/src/components/Lobby/__tests__/ModelConfigPanel.test.tsx`, `frontend/src/components/Lobby/__tests__/CopilotConnect.test.tsx`, `frontend/src/components/Lobby/__tests__/GameSettingsModal.test.tsx`.

**Extend tests:** `frontend/src/stores/__tests__/gameStore.test.ts`, `frontend/src/stores/__tests__/settingsStore.test.ts`, `frontend/src/services/__tests__/api.test.ts`. Backend compatibility: `backend/tests/test_model_config.py`, `backend/tests/test_api_models_and_settings.py`, `backend/tests/test_agent_api_keys.py`.

- [ ] **1. Change the cap test first** (existing store test initializes three opponents):

```ts
it('allows five AI opponents and refuses a sixth', () => {
  const store = useGameStore.getState()
  store.addAIOpponent()
  store.addAIOpponent()
  store.addAIOpponent()
  expect(useGameStore.getState().aiOpponents).toHaveLength(5)
})
```

- [ ] **2. Red/green:** run `npm test -- src/stores/__tests__/gameStore.test.ts`; expect 4 versus 5 failure. Change store guard to `if (state.aiOpponents.length >= 5) return state`, form add-button condition to `< 5`, and labels/counts to 1–5. Keep backend request schema unchanged. Rerun to pass.
- [ ] **3. Test provider workflows** with synthetic keys and the actual API adapter: save/check/remove each visible key provider; Azure endpoint/version save before verify; catalog load/search/add/remove refreshes `/api/models`; model deletion invalidates unavailable setup choices visibly; no-key, HTTP 401, HTTP 500 and retry states retain draft setup. Keep all four visible provider tabs. Unify frontend key-provider type to include existing `zhipu`; OAuth tab identity remains `github_copilot`, not a key provider.
- [ ] **4. Preserve exact settings and chip values:** section 3.1 and checklist provide presets/ranges; tests select each preset and inspect actual create JSON. Settings tests assert partial request keys, explicit null, saving disabled state, failed save restores server value. Remove duplicate `selectedTokens` state by reading `maxTokens` directly from settings store; do not alter server defaults.
- [ ] **5. Test Copilot timers:** fake-timer tests for pending→connected, slow_down interval, expiry/denial, unmount cleanup, clipboard failure, and disconnect→models refresh. Retain existing API contract. Make form controls labelled, errors associated with fields, and configuration panel fit narrow viewport.
- [ ] **6. Verify:** `npm test -- src/components/Lobby src/stores/__tests__ src/services/__tests__`, `npm run build`, `npm run lint`; backend `uv run --frozen --extra dev pytest tests/test_model_config.py tests/test_api_models_and_settings.py tests/test_agent_api_keys.py`. In real browser create a five-AI game from the visible form and confirm six server players. No fallback model silently presented as the user's selected model.
- [ ] **7. Commit:** explicit files above, `git commit -m "feat: preserve provider setup and support five AI opponents"`.

### P3 — Real table layout and fixed action dock

**Create:** `frontend/src/components/Table/TableShell.tsx`, `frontend/src/components/Actions/ActionDock.tsx`, `frontend/src/styles/table.css`, `frontend/src/components/Table/seatLayout.ts`, `frontend/src/components/Table/__tests__/seatLayout.test.ts`, `frontend/src/components/Actions/__tests__/ActionDock.test.tsx`, `frontend/e2e/table-layout.spec.ts`.

**Modify:** `frontend/src/pages/GamePage.tsx`, `frontend/src/components/Table/TableLayout.tsx`, `frontend/src/components/Table/PotDisplay.tsx`, `frontend/src/components/Table/GameInfoPanel.tsx`, `frontend/src/components/Player/PlayerSeat.tsx`, `frontend/src/components/Cards/CardHand.tsx`, `frontend/src/components/Cards/CardFace.tsx`, `frontend/src/components/Actions/ActionPanel.tsx`, `frontend/src/components/Actions/CompareSelector.tsx`, `frontend/src/stores/uiStore.ts`, `frontend/src/index.css`, `frontend/src/utils/gameView.ts`.

**Extend tests:** `frontend/src/components/Actions/__tests__/ActionPanel.test.tsx`, `frontend/src/components/Player/__tests__/PlayerSeat.test.tsx`, `frontend/src/hooks/__tests__/useGame.test.ts`. Keep `backend/tests/test_rules.py`, `backend/tests/test_evaluator.py`, `backend/tests/test_game_engine.py` unchanged except additional characterization cases if needed.

- [ ] **1. Write dock interaction tests:** blind and seen costs at base 10 are call 10/20, raise 20/40; compare 20 only when seen; fold needs confirm; compare excludes folded/out/self and can cancel; disconnected/pending cannot send; fake timers do not re-enable an unacknowledged action. Test forced showdown `hands_revealed` and rejected peek stays face down.
- [ ] **2. Run red tests:** `npm test -- src/components/Actions src/components/Player`; expect new pending/visibility tests to fail before wiring. Use `getActionCost` from section 4 instead of a second formula in ActionPanel. Remove the 500 ms unlock timer and local optimistic flip. Confirm pending clears only on the reconciliation rules in section 4.
- [ ] **3. Implement connected layout contract** with no fixture data:

```tsx
// frontend/src/components/Table/TableShell.tsx
import type { ReactNode } from 'react'
import '../../styles/table.css'

interface TableShellProps {
  header: ReactNode
  children: ReactNode
  dock: ReactNode
}

export default function TableShell({ header, children, dock }: TableShellProps) {
  return <div className="table-shell">
    <header className="table-header">{header}</header>
    <main className="table-stage" aria-label="炸金花牌桌">{children}</main>
    <footer className="table-dock" aria-label="牌桌操作">{dock}</footer>
  </div>
}
```

```css
/* frontend/src/styles/table.css — actual viewport/dock contract */
.table-shell { height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; background: #101715; color: #f2eee4; }
.table-header { min-height: 48px; padding-inline: 16px; }
.table-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.table-dock { position: relative; z-index: 30; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #17201d; }
.table-dock button { min-height: 44px; }
@media (max-width: 640px) { .table-header { padding-inline: 8px; } .table-dock { padding-inline: 8px; } }
@media (prefers-reduced-motion: reduce) { .table-shell *, .table-shell *::before, .table-shell *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
```

The grid footer remains fixed at the viewport bottom while reserving its own space. `ActionDock` renders start/next-hand, live ActionPanel, pending/error, or finished/results state from selectors. It must not set game status. `seatLayout.ts` exports `getSeatLayout(opponentCount, compact)` returning distinct anchors for 1–5 AI and one human; validate bounds and no overlapping minimum-size seat rectangles for the acceptance viewports. CSS table surface replaces baked table backgrounds; names/cards remain DOM content.

- [ ] **4. Preserve interactions:** portrait opens selected AI journal; compare mode seat selection dispatches the same `compare` target command as selector, with legal-target checks; own-card click invokes acknowledged peek. Implement Q/W/E/R/F via keyboard event handler that skips input/textarea/contenteditable, composing events, and open modal; execute only legal actions, F still opens confirmation. Disable automatic key repeat.
- [ ] **5. Run connected visual acceptance:** `npm test -- src/components/Actions src/components/Player src/components/Table`, `npm run build`, `npm run lint`; real `table-layout.spec.ts` at desktop and phone viewports from section 9, with six server players. Assert dock/card boxes do not intersect, every action is reachable, screenshots show real pot/seat state. Backend engine/rules/evaluator tests must stay green.
- [ ] **6. Commit:** explicit files above, `git commit -m "feat: center live gameplay around the table and action dock"`.

### P4a — Serialize lifecycle and reconnect safely

**Create:** `backend/app/services/game_runtime.py`, `backend/tests/test_game_runtime.py`.

**Modify:** `backend/app/api/websocket.py`, `backend/app/api/game.py`, `backend/app/api/game_store.py`, `backend/app/agents/agent_manager.py`, `frontend/src/hooks/useWebSocket.ts`, `frontend/src/hooks/useGame.ts`, `frontend/src/types/game.ts`, `frontend/src/pages/GamePage.tsx`.

**Extend tests:** `backend/tests/test_websocket.py`, `backend/tests/test_game_api.py`, `frontend/src/hooks/__tests__/useWebSocket.test.ts`, `frontend/src/hooks/__tests__/useGame.test.ts`, `frontend/e2e/connected-hand.spec.ts`.

- [ ] **1. Add failing stale-connection test** to `backend/tests/test_websocket.py`; it requires the proposed identity-aware disconnect signature:

```python
@pytest.mark.asyncio
async def test_old_socket_cannot_unregister_replacement() -> None:
    manager = WebSocketManager()
    old_socket = AsyncMock()
    new_socket = AsyncMock()
    await manager.connect("g1", "p1", old_socket)
    await manager.connect("g1", "p1", new_socket)
    manager.disconnect("g1", "p1", old_socket)
    assert manager.get_connections("g1")["p1"] is new_socket
```

- [ ] **2. Run red:** `uv run --frozen --extra dev pytest tests/test_websocket.py -k old_socket`. Expected TypeError/assertion before fix. Change disconnect implementation and the endpoint's finally call:

```python
def disconnect(self, game_id: str, player_id: str, websocket: WebSocket) -> None:
    """仅移除当前连接，旧连接清理不能覆盖重连。"""
    connections = self._connections.get(game_id)
    if connections is None or connections.get(player_id) is not websocket:
        return
    del connections[player_id]
    if not connections:
        del self._connections[game_id]
```

Update every caller/test to pass its socket. `remove_game` remains explicit whole-game cleanup.

- [ ] **3. Add barrier-based concurrency regressions** in `test_game_runtime.py`: suspend one AI `make_decision` with `asyncio.Event`; send chat and peek and assert acknowledgments before releasing it; connect replacement socket and ensure one AI decision; duplicate start/request ID charges ante once; finish then release stale AI and assert no new action/chip mutation. Do not test races with arbitrary sleeps. Existing `Decision`, `GameAction`, `GameStore`, and `WebSocketManager` construct the scenario; external LLM alone is mocked.
- [ ] **4. Implement section 5.1's runtime:** mutations run under per-game `asyncio.Lock`; AI call runs in tracked task outside lock; reenter lock to compare captured `(game_id, round_number, current_player_id, action_count, status)` before applying. If a concurrent peek changed the action count, re-evaluate current legal state and regenerate decision as necessary; never apply an old decision to a new actor/hand. Capture current task identity when clearing task registry, just as with sockets. Every task is cancelled/awaited on explicit game removal and app shutdown.
- [ ] **5. Add optional message metadata** without changing existing bodies/action names. Update TypeScript `ClientEvent`/`ServerEvent` optional `request_id`, `event_id`, `round_number` fields, event builders, old-client tests. UI sets pending before send, clears on echoed response/error or snapshot reconciliation. Out-of-turn/invalid/rejected peek must leave domain state unchanged and recover controls from a fresh snapshot/turn event.
- [ ] **6. Implement real end intent** in GamePage: during betting, request end-after-hand and show cancel; at settlement issue existing `endGame`, await success, then navigate; before first deal, end immediately. On failure retain table and offer retry. Natural `game_ended` navigates only on user results action. Until P4b, retain returned standings in matching store for immediate results; do not claim refresh durability yet.
- [ ] **7. Verify:** backend `uv run --frozen --extra dev pytest tests/test_game_runtime.py tests/test_websocket.py tests/test_game_api.py tests/test_agent_api_keys.py`; `uv run --frozen --extra dev ruff check app/services/game_runtime.py`; frontend `npm test -- src/hooks`, build/lint, connected browser disconnect/reconnect during real AI turn. Test `4001/4003/4004` do not retry endlessly. Existing REST action/start/end behavior stays compatible.
- [ ] **8. Commit:** explicit files above, `git commit -m "fix: serialize game commands and recover live connections"`.

### P4b — Persist browser-played hands and expose authoritative results

**Create:** `backend/app/api/history.py`, `backend/tests/test_history_api.py`, `frontend/src/types/history.ts`.

**Modify:** `backend/app/api/persistence.py`, `backend/app/api/websocket.py`, `backend/app/api/game.py`, `backend/app/main.py`, `frontend/src/services/api.ts`.

**Extend tests:** `backend/tests/test_persistence.py`, `backend/tests/test_websocket.py`, `backend/tests/test_game_api.py`, `frontend/src/services/__tests__/api.test.ts`.

- [ ] **1. Add red idempotent-persistence test** using existing conftest fixtures; imports shown here belong in the test file's normal import groups:

```python
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.game_store import get_game_store
from app.db.schemas import RoundDB
from app.engine.game_manager import apply_action, start_round
from app.models.game import GameAction

async def test_completed_round_is_persisted_once(
    async_client: AsyncClient, db_session: AsyncSession,
) -> None:
    from app.api.persistence import persist_completed_round

    response = await async_client.post("/api/game/create", json={
        "player_name": "玩家", "ai_opponents": [{"model_id": "copilot-gpt4o-mini"}],
        "initial_chips": 1000, "ante": 10, "max_bet": 200, "max_turns": 10,
    })
    assert response.status_code == 200
    game = get_game_store().get(response.json()["game_id"])
    assert game is not None
    start_round(game)
    actor = game.players[game.current_round.current_player_index]
    result = apply_action(game, actor.id, GameAction.FOLD)
    assert result.round_ended
    await persist_completed_round(db_session, game)
    await persist_completed_round(db_session, game)
    await db_session.commit()
    count = await db_session.scalar(select(func.count()).select_from(RoundDB).where(
        RoundDB.game_id == game.game_id,
    ))
    assert count == 1
    assert sum(player.chips for player in game.players) == 2000
```

- [ ] **2. Run red:** `uv run --frozen --extra dev pytest tests/test_persistence.py -k completed_round_is_persisted_once`. Expected missing helper. Implement helper with existing ORM tables and section 5.2's transaction rules. Refactor REST terminal persistence to the same helper, preserving current response shape. Wire WS `_handle_round_end` to it. Test human-terminal and AI-terminal hands separately, including natural game finish.
- [ ] **3. Add route tests:** created game's results, finished game after `/end`, memory store cleared/process-equivalent restart, unknown ID 404, sorted rounds, no unfiltered hands, no duplicate records, SQLite failure then retry without duplicate payout. The WS fixture must override `_get_db_session` as well as HTTP `get_db`, otherwise it can accidentally test a different DB.
- [ ] **4. Implement `/results`, `/rounds`, and filtered `/rounds/{n}/replay`** using the DTOs in section 5.2. Keep `test_end_game_removes_from_store` passing. Capture `compare_result` outcome in persisted actions and record accepted WS peek actions. Decode missing old fields explicitly; no guessed cards/turns. Add adapters `getGameResults(gameId)`, `getCompletedRounds(gameId)`, `getRoundReplay(gameId, roundNumber, playerId)` to `api.ts` with return types from `types/history.ts`.
- [ ] **5. Privacy regression:** unseen own cards remain hidden at cursor 0; own peek reveals only own cards; human compare reveals participant cards at its cursor; AI compare reveals no private cards; forced showdown reveals public hands at the end; another/unknown viewer cannot obtain human-specific reveal data. Existing live compare privacy tests remain unchanged in expected semantics.
- [ ] **6. Verify:** `uv run --frozen --extra dev pytest tests/test_persistence.py tests/test_history_api.py tests/test_game_api.py tests/test_websocket.py tests/test_database.py`; `uv run --frozen --extra dev ruff check app/api/history.py`; frontend API tests/build. Browser-play one hand through WS, end it, reload results API after memory removal and verify exact chip totals. Do not count the old REST-only flow as evidence of WS persistence.
- [ ] **7. Commit:** explicit files above, `git commit -m "feat: persist live hands and expose game history"`.

### P5 — Accessible chat and journal drawers backed by real records

**Create:** `frontend/src/components/Overlay/Drawer.tsx`, `frontend/src/components/Overlay/__tests__/Drawer.test.tsx`, `frontend/src/components/Table/ChatDrawer.tsx`, `frontend/src/hooks/useChatHistory.ts`, `frontend/src/hooks/__tests__/useChatHistory.test.ts`, `frontend/src/services/historyAdapters.ts`, `frontend/src/services/__tests__/historyAdapters.test.ts`, `frontend/src/components/Thought/__tests__/ThoughtTimeline.test.tsx`, `frontend/src/components/Table/__tests__/ChatInput.test.tsx`.

**Modify:** `frontend/src/pages/GamePage.tsx`, `frontend/src/components/Table/ChatInput.tsx`, `frontend/src/components/Table/ChatPanel.tsx`, `frontend/src/components/Table/GameLog.tsx`, `frontend/src/components/Player/ChatBubble.tsx`, `frontend/src/components/Thought/ThoughtDrawer.tsx`, `frontend/src/components/Thought/ThoughtTimeline.tsx`, `frontend/src/components/Thought/ThoughtCard.tsx`, `frontend/src/components/Thought/NarrativeView.tsx`, `frontend/src/stores/uiStore.ts`, `frontend/src/hooks/useGame.ts`, `frontend/src/services/api.ts`, `backend/app/api/websocket.py`, `backend/app/api/persistence.py`, `backend/app/api/chat.py`.

**Extend tests:** `backend/tests/test_chat_api.py`, `backend/tests/test_chat_engine.py`, `backend/tests/test_websocket.py`, `frontend/src/hooks/__tests__/useGame.test.ts`.

- [ ] **1. Write boundary tests:** live message before history fetch resolves appears once; persisted ID matches WS ID; delayed AI reply retains originating round; rapid AI/round switching cannot install stale thoughts; nullable confidence/patterns/rounds do not crash. Chat Enter sends, Shift+Enter does not submit, IME Enter does not submit, blank text ignored, failed send retains draft. Do not advertise multiline input unless converting the current single-line input to a textarea; this plan keeps single-line input.
- [ ] **2. Run red:** `npm test -- src/hooks/__tests__/useChatHistory.test.ts src/components/Table/__tests__/ChatInput.test.tsx src/components/Thought/__tests__/ThoughtTimeline.test.tsx`; expected missing history merge and null handling. Backend `uv run --frozen --extra dev pytest tests/test_chat_api.py tests/test_websocket.py` after adding explicit ID/round assertions.
- [ ] **3. Implement shared accessible drawer** using native dialog behavior; style the dialog as a desktop side sheet/phone full-height sheet. Native `showModal` supplies focus trapping; restore invoking focus on close. A complete minimal component is:

```tsx
import { useEffect, useRef, type ReactNode } from 'react'

interface DrawerProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export default function Drawer({ open, title, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || !open) return
    const previous = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])
  return <dialog ref={ref} aria-label={title} className="game-drawer"
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="game-drawer-body">
      <header><h2>{title}</h2><button onClick={onClose} aria-label={`关闭${title}`}>关闭</button></header>
      {children}
    </div>
  </dialog>
}
```

Mount only the active drawer's content so requests/timers stop on close; test real focus behavior in browser in addition to the jsdom dialog stub. Keep the table's visible turn/connection indicator; drawers do not pause backend play.

- [ ] **4. Implement chat persistence/merge** from section 5.3: persist/flush DB row before broadcasting its ID, keep original round number, normalize existing numeric IDs to strings, merge both fetched and live messages by ID sorted by timestamp plus ID tie-breaker. Server-originated sends are authoritative; do not insert a second optimistic copy. Preserve all message types and seat bubbles, cap visual bubble lifetime without deleting history.
- [ ] **5. Journal conversion:** AI/hand tabs wrap existing ThoughtTimeline; add action-log tab for live and selected completed hand. Keep narrative mode and strategy reviews, guard all nullable fields in `historyAdapters.ts`, distinguish narrative 404 from other errors through structured HTTP status. Provide explicit refresh while generation status is not yet available; P6b adds pending/retry/cancel. Render no sample thoughts when empty or turbo mode.
- [ ] **6. Verify:** frontend targeted suites plus full `npm test`, build/lint; backend chat/thought/persistence suites; real browser sends chat during AI work, opens/closes drawers, reads completed-hand thoughts, switches AI/hand, reloads and sees durable chat. Verify keyboard focus returns to the invoking button and phone composer remains usable with keyboard.
- [ ] **7. Commit:** explicit files above, `git commit -m "feat: connect chat and journal drawers to game history"`.

### P6a — Authoritative results, replay, and new game

**Create:** `frontend/src/components/Replay/RoundReplay.tsx`, `frontend/src/components/Replay/replayState.ts`, `frontend/src/components/Replay/__tests__/replayState.test.ts`, `frontend/src/components/Replay/__tests__/RoundReplay.test.tsx`, `frontend/src/pages/__tests__/ResultPage.test.tsx`, `frontend/e2e/game-results-replay.spec.ts`.

**Modify:** `frontend/src/pages/ResultPage.tsx`, `frontend/src/components/Settlement/Leaderboard.tsx`, `frontend/src/components/Settlement/AgentSummaryCard.tsx`, `frontend/src/components/Thought/ThoughtDrawer.tsx`, `frontend/src/stores/gameStore.ts`, `frontend/src/services/api.ts`, `frontend/src/types/history.ts`, `backend/app/api/history.py` only for demonstrated DTO defects.

**Extend tests:** `backend/tests/test_history_api.py`, `frontend/src/services/__tests__/api.test.ts`, `frontend/src/stores/__tests__/gameStore.test.ts`.

- [ ] **1. Add red results tests:** route g2 must not use g1's store players; fetch `/results` even if unrelated memory players exist; ended game reload shows final standings; 404/error has retry/home; new game preserves setup and mute, drops only live runtime/old pending state, and uses a new server ID.
- [ ] **2. Separate runtime reset from setup reset** in gameStore. Add `resetGame` (domain state only); retain `reset` for full reset/test compatibility. Use `resetGame` on “再开一场”, preserve `playerName`, `aiOpponents`, `gameConfig`, model catalog, provider keys and preferences. ResultPage always keys its request/cache by URL game ID and takes rankings from `getGameResults`.
- [ ] **3. Add replay tests from an explicit DTO** (not a simulated engine): starting stacks `{human:1000, ai:1000}`, antes `{human:10, ai:10}`, AI call amount 10, human peek amount 0, human compare amount 20 with human winner, terminal result pot 50 and changes `{human:20, ai:-20}`. Assert cursor 0 stacks 990/990/pot 20, cursor 1 stacks 990/980/pot 30, human peek reveal only at cursor 2, cursor 3 compare before payout stacks 970/980/pot 50, settlement stacks 1020/980, net total 2000. Back/forward/scrub yields identical state; unknown hand remains unknown.
- [ ] **4. Implement pure projection boundary:** `replayState.ts` exports `projectReplay(replay: RoundReplay, cursor: number, settled: boolean)` returning `{chips, pot, statuses, visibleCards, appliedActions}`. Clamp cursor 0..actions.length, subtract recorded amounts from actor, set fold/compare-lost statuses from recorded outcomes, apply reveal entries only when their cursor is reached and their optional `at_settlement` condition is met, and award terminal pot only when `settled` and at final cursor. No calls to live stores, socket hooks, create/start/action APIs, randomness, or `Date.now` in this function.
- [ ] **5. Implement replay UI** using records returned by P4b: completed-hand picker, previous/next, play/pause, reset to ante, range input labelled “回放进度”, read-only table/card/action view and settlement frame. Playback interval 800 ms per recorded action, cleared on pause/close/hand change/unmount. Replay audio stays silent. Reduce-motion mode still allows explicit stepping, with no card/chip travel. Old incomplete history shows a readable missing-detail message and available actions/result.
- [ ] **6. Verify:** `npm test -- src/pages/__tests__/ResultPage.test.tsx src/components/Replay`, full build/lint; backend `uv run --frozen --extra dev pytest tests/test_history_api.py tests/test_game_api.py`. Browser complete hand→end-after-hand→persisted results→replay→reload results→new create; separately reach natural elimination with backend test scenario. Assert no WS `player_action` is sent by replay controls.
- [ ] **7. Commit:** explicit files above, `git commit -m "feat: add recorded-hand replay and durable game results"`.

### P6b — Wire real experience review and complete report lifecycle

**Create:** `backend/app/services/journal_jobs.py`, `backend/tests/test_journal_jobs.py`, `frontend/src/hooks/useJournalStatus.ts`, `frontend/src/hooks/__tests__/useJournalStatus.test.ts`.

**Modify:** `backend/app/api/websocket.py`, `backend/app/api/thought.py`, `backend/app/agents/agent_manager.py`, `backend/app/agents/base_agent.py`, `backend/app/thought/reporter.py`, `frontend/src/services/api.ts`, `frontend/src/types/history.ts`, `frontend/src/components/Thought/ThoughtTimeline.tsx`, `frontend/src/components/Settlement/AgentSummaryCard.tsx`, `frontend/src/pages/ResultPage.tsx`.

**Extend tests:** `backend/tests/test_experience.py`, `backend/tests/test_thought.py`, `backend/tests/test_thought_api.py`, `backend/tests/test_agents.py`, `backend/tests/test_agent_api_keys.py`, `frontend/src/services/__tests__/api.test.ts`, `frontend/src/pages/__tests__/ResultPage.test.tsx`.

- [ ] **1. Add red live-wiring tests:** two completed losses trigger one review and inject its strategy context into the next decision; repeated settlement does not increment review counters; periodic fifth-hand trigger and chip-crisis priority use existing reviewer semantics; new hand cannot change previous narrative's cards/chat. Mock external LLM calls, not the reviewer or persistence in these tests.
- [ ] **2. Implement persistent per-game reviewer ownership:** `AgentManager` retains `ExperienceReviewer(agent, initial_chips)` for each agent. Completed-hand hook queues `check_trigger(game_snapshot, round_result)` once; before next decision call `perform_review(trigger, recent_narratives, recent_thoughts, opponent_stats)`, persist returned review, and call `agent.set_strategy_context(review.strategy_context)`. Use recorded actions for opponent statistics. Emit reviewing then thinking states; on failure preserve existing fallback behavior, clear reviewing, and continue legal play.
- [ ] **3. Add reporter-format regression:** provider responds with a specifically unsupported `response_format/json_object` error, second request omits that parameter, returns valid narrative/summary; retry uses the same request's key. Authentication/403 and ordinary malformed output do not take this transport retry path. Add optional `allow_format_fallback: bool = False` to `BaseAgent.call_llm`; only reporter/review callers that support text parsing set true. Build request kwargs conditionally rather than using `response_format or {type: json_object}`, which would reinsert the rejected format. Do not change gameplay prompt or action fallback rules.
- [ ] **4. Implement tracked jobs/status/retry:** use section 5.3's exact endpoints/DTO. Snapshot job inputs; deduplicate `(game, agent, hand)` and `(game, agent, summary)` jobs; bounded wait for prerequisite narratives, then summarize persisted actual records; one outcome ready/failed/cancelled, no infinite spinner. Retry endpoint schedules only explicit requests, reconstructs inputs from DB after restart, and preserves previously completed records. Cancel only ongoing summary tasks, not settled results or narrative history.
- [ ] **5. Frontend status behavior:** `useJournalStatus` polls only while an open view has pending records, every 2 seconds up to 60 seconds, then stops with explicit “仍在生成，刷新查看”; reopening/refetch checks again. Do not convert pending into failed solely due to UI polling timeout. Stop on unmount/game change. Load and display all existing summary fields from `getGameSummary`, keep strategy review cards, add retry/cancel controls tied to actual API responses.
- [ ] **6. Verify:** `uv run --frozen --extra dev pytest tests/test_journal_jobs.py tests/test_experience.py tests/test_thought.py tests/test_thought_api.py tests/test_agents.py tests/test_agent_api_keys.py`; frontend hook/ResultPage/API suites, build/lint. Real browser after a full game shows either generated report or a truthful retryable error, never filler. At least one configured real provider must produce a narrative and summary before final cutover. Separate provider availability from feature correctness in evidence.
- [ ] **7. Commit:** explicit files above, `git commit -m "feat: connect AI reviews and report generation lifecycle"`.

### P7 — Coherent characters, restrained motion and persistent mute

**Create:** `frontend/src/assets/portraits/ai-01.webp`, `frontend/src/assets/portraits/ai-02.webp`, `frontend/src/assets/portraits/ai-03.webp`, `frontend/src/assets/portraits/ai-04.webp`, `frontend/src/assets/portraits/ai-05.webp`, `frontend/src/assets/portraits/manifest.json`, `frontend/src/utils/characters.ts`, `frontend/src/stores/preferencesStore.ts`, `frontend/src/services/gameAudio.ts`, `frontend/src/hooks/useGameAudio.ts`, `frontend/src/services/__tests__/gameAudio.test.ts`, `frontend/src/stores/__tests__/preferencesStore.test.ts`, `frontend/src/utils/__tests__/characters.test.ts`.

**Modify:** `frontend/src/components/Player/PlayerSeat.tsx`, `frontend/src/components/Settlement/Leaderboard.tsx`, `frontend/src/components/Settlement/AgentSummaryCard.tsx`, `frontend/src/components/Lobby/GameConfigForm.tsx`, `frontend/src/components/Lobby/GameSettingsModal.tsx`, `frontend/src/pages/GamePage.tsx`, `frontend/src/hooks/useGame.ts`, `frontend/src/components/Table/DealingAnimation.tsx`, `frontend/src/components/Table/ChipFlyAnimation.tsx`, `frontend/src/utils/theme.ts`.

- [ ] **1. Commission/generate the exact five portraits** using section 8's shared brief and manifest requirements. Asset generation is a bounded separate activity if the image tool is unavailable to the implementer. During functional development use initials on the same portrait frame; never fall back to old mismatched character art. Final visual acceptance requires the delivered coherent set, not a claim that initials satisfy it.
- [ ] **2. Stable identity mapping:** `characters.ts` exports a five-entry manifest and `getCharacterForOpponent(opponentIndex: number)` returning `manifest[opponentIndex % manifest.length]`. Index derives from AI order in the server's player array, not current layout slot, current actor, or hash collisions. Same helper is used at setup/table/journal/results. Preserve custom names and model labels; no new backend character field or persona prompt.
- [ ] **3. Add mute persistence test**, then implement separate preferences store (session/game resets never reset it):

```ts
// frontend/src/stores/preferencesStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PreferencesState {
  muted: boolean
  setMuted: (muted: boolean) => void
}

export const usePreferencesStore = create<PreferencesState>()(persist(set => ({
  muted: false,
  setMuted: muted => set({ muted }),
}), { name: 'golden-flower-preferences-v1' }))
```

Test false→mute→rehydrate remains true, toggling changes accessible pressed label, creating another game leaves mute untouched. Run `npm test -- src/stores/__tests__/preferencesStore.test.ts` before/after implementation.

- [ ] **4. Implement event/audio boundary:** `gameAudio.ts` exports `unlockAudio(): Promise<void>`, `playGameSound(kind: 'deal' | 'chip' | 'win', eventId: string): void`, `stopGameAudio(): void`. Unlock/resume from a user gesture (enter/deal/unmute); catch unsupported/autoplay rejection without breaking play. Use gain-enveloped short synthesized sounds from section 8. Maintain a 256-ID recent-played set, consult persistent mute before scheduling, stop active sources immediately when muted, and ignore hidden-tab events. `useGameAudio` cleans up sources on route exit. Accepted `round_started`, money-bearing `player_acted`, and `round_ended` invoke sounds once; snapshots, reconnect, rejected clicks, chat, and replay do not.
- [ ] **5. Add audio tests** with a mocked AudioContext: locked context produces no source, unlock occurs only via callback, mute prevents/stops playback, duplicate event ID plays once, three fresh accepted IDs map to three cues, failed `resume()` doesn't reject gameplay, route cleanup stops sources. Test mechanics rather than asserting literal oscillator constants. Manually listen on desktop and phone with normal and muted state.
- [ ] **6. Bound motion:** adjust existing deal/chip/win components to durations in section 4.2; key animation instances by accepted event ID/hand and clean up effect timers. Effects never hide server cards permanently or clear domain state. Reduced motion sets final positions immediately. Portrait loading error keeps reserved frame and initials, not layout shift/broken image icon.
- [ ] **7. Verify:** audio/preferences/character and PlayerSeat suites, full build/lint; browser muted reload/new game, reduced-motion hand and unmuted deal/call/win. Inspect all five portraits at 64 px and 128 px rendered sizes. Confirm payload budgets and asset provenance.
- [ ] **8. Commit:** explicit files above, `git commit -m "feat: add coherent table characters and subtle game audio"`.

### P8 — Full browser acceptance, quality gates and cleanup/cutover

**Create:** `frontend/e2e/acceptance.spec.ts`, `frontend/e2e/recovery.spec.ts`, `frontend/e2e/support/acceptance.ts`, `frontend/playwright.live.config.ts`, `backend/tests/browser_server.py`, `backend/tests/test_browser_server.py`, `docs/plans/2026-10-01-playable-game-rebuild-acceptance.md`.

**Modify:** `frontend/playwright.config.ts`, `.github/workflows/ci.yml`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/utils/theme.ts`, `frontend/src/components/Lobby/GameSettingsModal.tsx`, `frontend/src/components/Player/ChatBubble.tsx`, `frontend/src/components/Table/ChipFlyAnimation.tsx`, `frontend/src/components/Table/DealingAnimation.tsx`, `frontend/src/components/Table/GameInfoPanel.tsx`, `frontend/src/components/Table/GameLog.tsx`, `frontend/src/hooks/useGame.ts`, `frontend/src/components/Actions/__tests__/ActionPanel.test.tsx`, `frontend/src/components/Lobby/__tests__/GameSetupModal.test.tsx`, `frontend/src/components/Player/__tests__/PlayerSeat.test.tsx`, `frontend/src/stores/__tests__/gameStore.test.ts`, `README.md`, `docs/DEPLOY.md`. Update `frontend/src/test/smoke.test.tsx` if removed demo exports were referenced.

**Delete after import checks:** `frontend/src/pages/CardDemoPage.tsx`, `frontend/src/pages/ResultPreview.tsx`, `frontend/src/pages/ThoughtDemoPage.tsx`, `frontend/src/pages/GameDemoPage.tsx`, `frontend/src/components/Lobby/GameSetupModal.tsx`, `frontend/src/components/Lobby/__tests__/GameSetupModal.test.tsx` after its behavioral cases migrate to home tests, `frontend/src/assets/characters/char-1.webp`, `frontend/src/assets/characters/char-2.webp`, `frontend/src/assets/characters/char-3.webp`, `frontend/src/assets/characters/char-4.webp`, `frontend/src/assets/characters/char-5.webp`, `frontend/src/assets/game-bg.jpg`, `frontend/src/assets/table-bg.png`, `frontend/src/assets/result-bg.png`, `frontend/src/assets/lobby-bg.jpeg`. Remove any now-unused styling tied solely to those assets; do not delete functioning card or provider logic. Confirm the P1 `frontend/src/pages/__tests__/WelcomePage.test.tsx` covers the modal behaviors before removing modal tests.

- [ ] **1. Repair documented baseline lint failures in touched code:** use derived values instead of duplicate settings/effect state; key transient bubble/animation instances by message/event; keep animation progress in state and timers in effects; stop reading refs during render in GameInfoPanel/GameLog/DealingAnimation; replace empty `extends` interfaces in useGame with type aliases; simplify test motion mocks so unused destructured values aren't emitted; remove obsolete eslint-disable. Do not globally disable hook rules, ignore test directories, lower TypeScript strictness, or delete behavioral assertions.
- [ ] **2. Build deterministic browser coverage against the real backend** for rules/recovery branches a live LLM may not choose. `backend/tests/browser_server.py` is an explicit test-only app entrypoint that creates the normal FastAPI app and replaces only external LLM responses and deck selection in its lifespan; production `app.main` must never import it. Use fixed server-side hands and legal scripted decisions passed through actual agent parsing/engine/REST/WS/SQLite. No browser intercepts, fake Zustand state, or production test-mode endpoints. `test_browser_server.py` verifies ordinary app routes/config have no fixture mode, the test app uses an isolated temporary SQLite file, and production provider paths remain untouched.
- [ ] **3. Define deterministic scenarios** in that test entrypoint: (a) 1 AI calls, human peek/call/raise/compare and two hands; (b) five AI, fold and spectator continuation; (c) compare tie loses initiator; (d) max-turn showdown; (e) AI unavailable→visible fallback; (f) natural finish at 100 initial chips/50 ante; (g) delayed AI for chat/peek/reconnect; (h) reports pending→ready and failure→explicit retry. Use pytest unit/integration cases for credential failures/race permutations that do not need a browser. Browser automation must assert backend IDs, actual WS acknowledgments and REST final state.
- [ ] **4. Separate deterministic and live-provider runners:** default Playwright starts `uv run --frozen --extra dev uvicorn tests.browser_server:app --host 127.0.0.1 --port 8000` in backend cwd plus Vite, `reuseExistingServer: false`, isolated test DB, one backend process. `playwright.live.config.ts` starts normal `app.main:app`, uses a separate temporary DB, runs only explicit live specs with `GF_LIVE_*` supplied, `trace: 'off'` and no screenshots while credentials are visible. Configuration supports an explicitly specified acceptance port; Vite proxy must match. Fail clearly on occupied ports, never kill another worktree's process.
- [ ] **5. Add browser assertions** from section 9 at all target viewports. Include backend-off create/reload (truthful errors, no fake table), hard reload mid-hand, disconnect during thinking, start-next-hand before old animation ends, phone keyboard/drawer, reduced motion, mute persistence and new game. Record visible UI plus sanitized backend state, not merely screenshots.
- [ ] **6. Run complete gates** from section 10; repair regressions, then stop rerunning unchanged passing suites. Add CI jobs for backend pytest/Ruff and deterministic Playwright, plus frontend lint alongside existing tests/build. Use Node 22 and Python 3.11 to match Docker; `uv sync --frozen --extra dev` because dev dependencies are an optional extra, not a dependency group. Keep `backend/tests/test_dockerignore.py` protections intact.
- [ ] **7. Delete obsolete files only after parity passes.** Run `rg -n 'useDevMock|DEV_MOCK_ENABLED|MOCK_PLAYERS|dev-mock-game|/demo/|CHARACTER_IMAGES|assets/characters|game-bg|lobby-bg|result-bg' frontend/src` and inspect every match. Expected production matches: zero. Any new promotional content/import is a failure. Demo-only test names may remain only if those tests prove absence of those routes. Build manifest must contain new portraits and no removed art.
- [ ] **8. Write acceptance record** at the exact new document path: commit SHA, date, Node/Python/browser versions, commands/results, viewports, provider/model without key, game IDs, non-fallback AI evidence, action/settlement sequence, final stacks, next-game ID, report/replay evidence, limitations. Correct README/DEPLOY key persistence, actual entry flow, single-process live-game limitation, and complete-hand acceptance instructions. A failure or unavailable real-provider run remains explicitly unaccepted, not a green checkbox.
- [ ] **9. Commit:** explicit files above, `git commit -m "test: verify playable rebuild and remove obsolete previews"`. Cutover is eligible only under section 11; this plan does not perform deployment.

## 8. Asset and audio production brief

### Portrait deliverables

Generate five fictional adult AI opponents in **one** coherent semi-realistic editorial/game-portrait style. Shared 4:5 bust framing, neutral dark transparent-or-matching background, consistent soft key light plus warm table bounce, eye-line and head scale, clean silhouettes, restrained contemporary clothing and subtle futuristic detail. Faces must read at small seat sizes; no text, watermarks, logos, baked cards/chips, exaggerated neon, full-body characters, or recognizable real people.

| Asset | Visual temperament and distinction | Shared constraints |
| --- | --- | --- |
| `ai-01.webp` | Woman, composed, direct gaze, dark tailored jacket | Same camera/light/crop |
| `ai-02.webp` | Man, expressive, slight confident smile, warm casual tailoring | Same camera/light/crop |
| `ai-03.webp` | Woman, playful and alert, contrasting short hair/silhouette | Same camera/light/crop |
| `ai-04.webp` | Man, mature/analytical, restrained expression, distinctive glasses if readable | Same camera/light/crop |
| `ai-05.webp` | Androgynous/nonbinary presentation, reserved, distinctive cool-toned wardrobe | Same camera/light/crop |

Descriptions guide appearance only. Users still assign names/models; the model's actual decisions and recorded emotion remain authoritative. Do not label a portrait “guaranteed aggressive” or attach performance claims.

- Generate master 768×960 or larger; normalize crop/export to 512×640 WebP, target ≤120 KB each and ≤600 KB total. Use an alternate 256×320 export only if measured phone payload warrants it; don't add formats/dependencies unnecessarily.
- `manifest.json` records ID, relative filename, dimensions, creation tool/source, prompt/brief version, rights/provenance and export size. Keep generated masters outside shipped frontend source if large; store links only to actual approved deliverables, no fabricated origin.
- Review contact sheet for shared lighting, equal head scale, variety and absence of old mismatched art. Inspect at native and rendered seat sizes, light/dark edges, all five opponents on phone, image-loading/error cases. Use reserved dimensions and a monogram fallback to prevent layout shift.
- Assets do not gate connected-game engineering. They gate final visual completion. If image tooling is unavailable, the controller can assign generation separately with this exact manifest/brief while this branch stays a real runnable game.
- Table/felt/card backs/chip stacks are lightweight CSS/SVG where appropriate. Reuse existing rank/suit card logic. No dependency on a raster background containing the whole table layout.

### Sound and motion deliverables

Use Web Audio synthesis initially, avoiding external licensed-file dependencies. One small service creates sources lazily after gesture and applies a shared low gain; no background music/voice autoplay.

| Cue | Trigger | Shape/budget |
| --- | --- | --- |
| Deal | One fresh accepted `round_started` | Soft filtered noise/card brush, 80–120 ms, one per hand; not 18 overlapping sounds |
| Chip | Accepted call/raise/compare with amount > 0 | Low-volume short wood/chip click, 50–90 ms, rate-limit bursts to one per 100 ms |
| Win | Fresh accepted `round_ended` | Two soft tonal notes with quick envelope, total ≤450 ms; no casino fanfare |

Mute button available in table header and settings, with `aria-pressed`, icon plus accessible “静音/开启音效” state. Muting stops active sources immediately, persists across reload/routes/new games, and does not alter backend settings. Context resume failure is silent except truthful button state if needed; game still functions. Background tab and replay stay silent; reconnect snapshots never replay old cues. Reduced motion is independent of mute. Validate by actual listening on phone and desktop, not by mocked tests alone.

## 9. Browser acceptance path through real hand and full game

### 9.1 Required real-provider run (P1 subset; full path at P8)

Prerequisites: backend running normally from this worktree; isolated SQLite DB; frontend proxies to it; one authorized usable provider credential or existing Copilot connection. Never invent a credential or call auto-fold fallback “real AI acceptance”. A controlled provider fixture is useful for CI but cannot satisfy this gate.

1. Open `/` in a clean browser tab at 1440×900. Verify title 大模型炸金花 and real player/opponent/stakes configuration. Open model panel, configure an available provider, verify, load/search/add an actual supported model. Check selected game model uses returned registry ID.
2. Set human name `验收玩家`, one AI with that model, standard stakes 1000/10/200/10. Set detailed mode for the journal run, timeout/retries appropriate to the provider through existing settings. Create. Observe exactly one successful `POST /api/game/create`, real UUID, returned human ID, and WS connection. Cards/chips must not appear from fabricated state before snapshot.
3. Click **开始第一局**. Observe `round_started`, snapshot, `cards_dealt`, AI thinking/action and human turn. Confirm ante pot and current stacks against REST viewer snapshot. Record at least one AI `player_acted` with `is_fallback: false` and successful LLM-backed decision; merely receiving a fallback fold does not pass.
4. On a human opportunity, click peek; wait for accepted `check_cards`/seen snapshot; verify three actual cards and unchanged turn/zero charge. Call on one turn and raise on a later eligible turn. Confirm displayed costs versus pre-action server wager/status and acknowledged amount. If AI naturally ends the hand early, record that hand and continue another real hand to cover remaining actions; do not script the live LLM or manipulate chips.
5. Compare with an eligible AI while seen; confirm target, amount, actual participant reveal and elimination/winner. Complete a separate fold/confirm/cancel branch in another hand. Never require every mutually exclusive ending in the same hand. If provider choices prevent one branch, deterministic backend scenario covers mechanics, but keep real-flow action coverage gaps visible.
6. Wait for `round_ended` and settled snapshot. Assert round number/winner/pot/deltas match UI; summed chips equal the initial total (2000 in this game); no second chip increase after the win animation. Record event ordering. Inspect completed-hand journal: correct AI/round/action/reasoning/confidence/emotion, narrative loaded or truthful pending then refresh.
7. Start **下一局**. Same game ID, round number +1, rotated dealer, retained stack totals, new actual cards, cleared old compare state. Do this promptly once after settlement to expose old-timer races. Hard reload once during a human turn; session identity, own seen status and server legal actions recover.
8. Open chat during an AI turn, send a short message with Enter; receive real echo with stable ID and AI reply or legitimate silent response. Close/reopen drawer, fetch history, reload: no duplicate/missing echo and correct round association.
9. Choose **结束游戏**, cancel once, then choose **完成本局后结束** during a live hand. Finish/fold the current hand through backend; await `/end` success. Go to `/result/{id}`, inspect standings/net chips, AI reviews/summary status, and completed-hand replay. Reload results after memory removal. Confirm replay previous/next/play/pause/reset/scrub never emits live commands and respects hidden-card rules.
10. Click **再开一场**. Home retains prior editable setup and mute, creates **new** game ID and initial stacks; provider configuration still works. No old action log/chat/round/pending state leaks into it.
11. Repeat at 390×844 with **five AI**, and inspect 360×640 plus 844×390. Test drawers with phone keyboard, view all seats/cards/chips, perform a real legal action from dock, toggle mute and reload. Run reduced-motion preference once.
12. In a separate deterministic real-backend scenario, reach natural game-over, human elimination/spectating, max-turn showdown and compare tie. Natural-finish branch cannot be claimed tested solely because manual `/end` worked.

**Acceptance evidence:** sanitized event **types/IDs/amounts** and state assertions, game/round IDs, screenshot of actual table/settlement/phone/result/replay, provider/model names, test command results. Do not store request headers, WS URL query, keys, raw LLM private output, or credential-panel screenshots in committed artifacts. Live Playwright traces/HAR are off because they can capture credentials. A short manual record can supply the live-provider evidence if unattended credential access is unavailable.

### 9.2 Concrete browser assertions

`frontend/e2e/support/acceptance.ts` exports helpers for observed WS events, snapshot assertions, and viewport geometry; it does not implement gameplay. The following assertions are representative complete checks after the browser reaches a real table:

```ts
import { expect, type Page } from '@playwright/test'

export async function assertUsableTable(page: Page): Promise<void> {
  const dock = page.getByRole('contentinfo', { name: '牌桌操作' })
  const table = page.getByRole('main', { name: '炸金花牌桌' })
  await expect(dock).toBeVisible()
  await expect(table).toBeVisible()
  const dockBox = await dock.boundingBox()
  const tableBox = await table.boundingBox()
  expect(dockBox).not.toBeNull()
  expect(tableBox).not.toBeNull()
  expect(tableBox!.y + tableBox!.height).toBeLessThanOrEqual(dockBox!.y + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const button of await dock.getByRole('button').all()) {
    if (await button.isVisible()) {
      const box = await button.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  }
}
```

Additionally assert all six seats have visible names/chips, own cards do not intersect dock, compare targets remain reachable, focus cycles only in open dialog, Escape closes and restores focus, no uncaught console/page errors, disconnected actions disabled, and no synthetic success when backend is unavailable. Screenshots are supplemental: backend state/frames are the gameplay proof.

## 10. Verification discipline and inspected baseline

### Current plan-only inspection results (2026-10-08)

| Check | Result |
| --- | --- |
| Branch/HEAD/status | Correct branch; clean starting tree; HEAD/local origin-main at `0881710` |
| Dependencies | `npm ci --no-audit --no-fund` succeeded; no manifest/lock changes |
| `npm test` | **10 files, 192 tests passed** |
| `npm run build` | **Passed** TypeScript + Vite; existing >500 KB JS chunk warning |
| `npm run lint` | **Failed: 32 errors, 1 warning**, pre-existing; files itemized in P8 |
| `uv sync --extra dev --frozen` | Failed across three attempts downloading locked PyPI wheels (`litellm` / `pydantic`), “Socket is not connected (os error 57)”; reduced download concurrency did not resolve it |
| `.venv/bin/python -m pytest` | Attempted; cannot start because pytest was not installed after dependency failure |
| `.venv/bin/python -m ruff check .` | Attempted; cannot start because Ruff was not installed after dependency failure |
| Existing Playwright coverage | Config exists; `frontend/e2e` does not exist at baseline. No real browser/LLM acceptance claimed in this plan-only task |

This is inspection evidence, not a successful implementation acceptance run. No product-code fixes or dependency version changes are part of this document commit. Do not convert an unavailable backend suite into a pass. Retry dependency installation in the implementation environment; match Python 3.11 from Docker (the automatic local `uv` attempt selected 3.14.6).

### Commands for implementation verification

From `backend/`:

```bash
uv sync --frozen --extra dev --python 3.11
uv run --frozen --extra dev pytest
uv run --frozen --extra dev ruff check .
```

Expected: complete non-live suite passes; integration-marked external LLM cases are skipped by default. Backend `conftest.py` enables live integration when `-m` contains `integration`; run `uv run --frozen --extra dev pytest -m integration tests/test_integration_llm.py` only with authorized `ZHIPU_API_KEY` available. That suite exercises real LLM paths, but it is **not** browser full-game proof. Never print its key.

From `frontend/`:

```bash
npm ci --no-audit --no-fund
npm test
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e -- --project=chromium
npx playwright test --config=playwright.live.config.ts
```

Expected after P8: unit/build/lint/deterministic browser gates pass; live run passes with supplied provider or is explicitly unaccepted when unavailable. Use Playwright's existing dependency; no new test library. Unit mocks characterize reducers/requests; browser CI runs real backend with only external LLM/deck controlled. Final live acceptance uses unmodified normal backend and real provider.

Required retained backend suites: `test_evaluator.py`, `test_rules.py`, `test_game_engine.py`, `test_agents.py`, `test_agent_api_keys.py`, `test_personalities_and_prompts.py`, `test_model_config.py`, `test_api_models_and_settings.py`, `test_game_api.py`, `test_websocket.py`, `test_chat_api.py`, `test_chat_engine.py`, `test_thought.py`, `test_thought_api.py`, `test_experience.py`, `test_database.py`, `test_persistence.py`, `test_dockerignore.py`. New runtime/history/journal/browser-server suites add integration coverage without replacing these.

Run focused red/green tests per step, full frontend/backend suites at package boundaries where those layers change, and final combined gates once all packages land. For unrelated existing lint debt, record exact baseline and ensure touched code introduces no new errors; do not delay the initial connected slice behind a standalone cosmetic/lint PR. P8 must resolve all remaining frontend errors and any backend baseline debt discovered once dependencies install. Never loosen checks to claim acceptance.

## 11. Rollback and cutover

### During integration

- Each package starts from the prior playable integration commit. Keep providers/settings/chat/journal accessible through reused working components until their replacement is connected and tested. No route flips to an incomplete visual page.
- P1–P3 require no backend protocol change. P4+ additions retain old REST URLs, action strings, bodies, optional event compatibility, and `/end` removal response. New routes and JSON metadata are additive. Existing database tables remain readable by baseline code; no destructive migration.
- Keep ordinary callers that omit request IDs working. Test the old frontend message shapes against the new backend, and the P1 frontend against baseline contracts. The final frontend's new history/report features require the corresponding backend package; do not deploy mismatched pairs.
- Revert a failed package commit using a new `git revert <package-commit>` in this integration branch, in reverse dependency order. Never reset shared history or change another worktree. An implementation agent should prepare/validate the revert; the controller owns any remote publishing decision.
- Keep `0881710` as immutable rollback reference. The rejected promotional shell is never a rollback target.

### Release gate and cutover sequence

1. All checklist rows have code/test/browser evidence. Live-provider full hand and whole game/results/new-game run pass. New portraits delivered and actual sound/mute verified. No production mocks/demo routes or copied promotional structure.
2. Controller reviews accumulated focused packages and the runnable integration tree. Until then, stable `origin/main` remains the release source. This plan does not authorize a push, PR, merge, or deployment.
3. Before a later authorized deployment, record candidate commit and previous image digest, finish/drain active games, and back up SQLite with the SQLite backup API or while service is stopped (do not copy a live WAL database incompletely). Active in-memory hands cannot survive a backend process restart; communicate the maintenance window in the actual deployment workflow.
4. Build from candidate SHA, run combined gates, serve through the existing nginx `/api` + `/ws` + SPA route fallback. Test deep links `/game/{id}` and `/result/{id}` and a full browser hand through the production proxy. Pin both frontend/backend to the same release. Do not declare success from `/health` or the home page alone.
5. If cutover fails, redeploy the previous pinned image pair. Additive records remain, active memory games are lost on restart as documented. Restore the DB backup only if data corruption requires it and only under the controller's explicit recovery decision; don't roll back the database unnecessarily and discard completed games.
6. After successful release acceptance, obsolete frontend files listed in P8 stay deleted. Do not keep a second static shell or permanent `/legacy` fork as a hidden source of truth.

## 12. Plan-document consistency checks and handoff

Before committing this plan:

- [x] Verify branch `feat/playable-game-rebuild`, base ancestry `0881710`, and only this Markdown file in the staged diff.
- [x] Check every existing source/test path against the current tree; proposed files are explicitly named under Create. Check all baseline route/event names against registered decorators/builders and distinguish proposed routes.
- [x] Cross-check each user requirement against section 6 and each parity row against a package and concrete test/browser evidence. P1 is a connected hand, and replay/report gaps have actual implementation packages.
- [x] Check types/identifiers across tasks: WS `target` vs REST `target_id`, round vs game, status/phase, `request_id`, `event_id`, `GameResults`, `RoundReplay`, `JournalStatus`, and named store/helper interfaces. Do not confuse client presentation state with engine phase.
- [x] Scan for unfinished plan markers, unclosed code fences, broken relative links, and whitespace errors. Run `git diff --check` and review the entire staged diff.
- [ ] Commit only `docs/plans/2026-10-01-playable-game-rebuild.md` with `docs: plan playable game rebuild`; report SHA and check limitations. Do not push/create a PR or start implementation in this first task.

Implementation remains pending after this plan commit. The controller can begin P1 using the package order and acceptance criteria above; no additional execution-choice question is needed for this document-only task.

Document validation: 173 file references (109 existing, 64 explicitly proposed), 53 parity rows, 39 existing API route decorators inspected, all existing event names accounted for, 20 balanced fenced blocks, Python/JSON examples parsed, 12 TypeScript/TSX examples syntax-checked, shell examples parsed with `bash -n`, and CSS braces checked. These are document checks, not claims that proposed code has been implemented or type-checked against future interfaces.
