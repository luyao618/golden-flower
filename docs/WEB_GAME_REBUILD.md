# Golden Flower web game rebuild

Phase 1 — repository audit, product brief, and implementation plan. Inspected on 2026-09-26 at commit `0881710`, branch `feat/web-game-reimagined`, in `/Users/yao/.herdr/worktrees/golden-flower/feat-web-game-reimagined`.

**The overall rebuild is authorized. Phase 1 is the first, document-only PR; implementation follows in separate, small branches/PRs.** This worktree currently contains only the brief, with no redesign or backend business-logic changes. The current delivery instruction is to verify and commit this document locally, without pushing or opening its PR. Later work packages must each be opened as a PR immediately after completion; future work below is planned, not completed.

## 1. Rebuild brief and boundaries

Build a polished, Simplified Chinese browser game in which one human plays 炸金花 against independently selected LLM opponents, talks at the table, and reads the opponents’ recorded decisions after a hand. The table, the cost of the next action, and the consequences of that action are the primary experience. Model administration supports that experience; it is not the home screen’s visual organizing principle.

The rebuild replaces frontend presentation, component boundaries, routing composition, client state, transport handling, and tests. Retain the current HTTP/WebSocket protocol, Python engine, model integrations, SQLite storage, and deployment shape. Correct frontend defects rather than copying them. Identify backend defects separately; only narrowly necessary, regression-tested compatibility fixes may enter a later implementation phase.

Decisions:

- Keep React 19, strict TypeScript, Vite 7, React Router 7, Zustand 5, Tailwind 4, Framer Motion 12, and Lucide. Rebuild the application structure rather than change frameworks without a product benefit.
- Use one authoritative server snapshot, typed events, explicit client lifecycle states, and presentation effects that cannot mutate game facts.
- Support the backend’s full 2–6 seats: one human and 1–5 AI opponents. The current four-opponent UI limit is not a rule.
- Keep fixed doubling raises, manual first/next-hand starts, blind/seen costs, comparison privacy, and continued play after an individual player is eliminated.
- Adopt **金花牌室 / Golden Flower Card Room** as the working visual direction: petrol-blue felt, oxblood lacquer, brass details, crisp cards, restrained character portraits, and an illuminated dealer marker. Chinese product naming remains 大模型炸金花; this is an art direction, not a required rename.
- Make connection recovery, action acknowledgement, empty journals, unavailable reports, and result restoration designed states with clear exits.
- Preserve all currently usable gameplay and configuration features. Keep readers for supported but dormant report/review data. Do not fabricate learning activity or revive disabled backend subsystems as a frontend task.
- Deliver each independently reviewable, runnable work package on its own branch and PR. Stack on an unmerged prerequisite or rebase onto `main` as predecessors merge; never accumulate the rebuild into one integration PR.

Out of scope: human multiplayer, accounts, real-money play, new poker variants, arbitrary raise amounts, all-in/side-pot rules, new LLM orchestration, backend restart recovery, a historical-game service, replay engine, SSR, a WebGL engine, and deployment. Historical design documents describe earlier work; their neon-only styling and “visual changes only” restrictions do not constrain this explicitly authorized ground-up frontend rebuild.

## 2. Audit evidence and current baseline

### 2.1 Repository map

Paths in this document are relative to the repository root unless linked otherwise.

| Area | Inspected sources | What governs the rebuild |
| --- | --- | --- |
| Entry and routes | `frontend/src/main.tsx`, `App.tsx`, all eight page modules | BrowserRouter SPA; welcome, table, result, four demos, legacy lobby redirect |
| Setup/configuration | All `components/Lobby/*`, `stores/settingsStore.ts`, setup tests | Model/provider flows, nickname and seat setup, chip presets, global AI settings |
| Live client | `services/api.ts`, `types/game.ts`, `hooks/useGame.ts`, `hooks/useWebSocket.ts`, both runtime stores and their tests | REST wrappers, event handling, duplicate state, reconnect policy, action availability |
| Table and interaction | All Actions, Cards, Player, Table components; error components; component tests | Costs, compare selection, card visibility, seat coordinates, logs, chat, animations |
| Journal/results | Thought and Settlement components, `ResultPage.tsx`, demos | Completed-hand journal, narrative/review handling, standings, dormant summary renderer |
| Backend surface | `app/main.py`, every `app/api/*` module, `models/*` | Actual registered endpoints and wire shapes take precedence over old prose/types |
| Engine | `engine/deck.py`, `evaluator.py`, `rules.py`, `game_manager.py` | Authoritative dealing, hand ranking, costs, legality, progression, settlement |
| AI/config | `config.py`, `agents/*`, `services/*`, `thought/*` | Provider routing, fallback, chat/review/report generation, runtime settings |
| Persistence | `db/database.py`, `db/schemas.py`, `api/persistence.py`, `api/game_store.py` | Eight SQL tables; active games/agents/model registry remain process memory |
| Verification | All test-file inventories, core rule/lifecycle/transport assertions, frontend test suite, CI | Strong unit coverage; missing real browser acceptance and important sequence gaps |
| Product/history | README, PRD, TECH_DESIGN, TASKS, redesign-plan, frontend-redesign-tasks, design-system, character-upgrade-plan, game-table-3d-upgrade, DEPLOY | Product intent, historic proposals, and drift catalogued below |
| Assets/build/ops | All image assets, card CSS, global CSS, HTML, package/lock/config files, Dockerfile, Compose, nginx, start/deploy scripts, ignore files | Preserve same-origin `/api` and `/ws`, static Vite output, SPA fallback |

The portable context index was available and read. It contains no additional game-specific memory applicable to this task.

### 2.2 Verification performed in this worktree

| Check | Result |
| --- | --- |
| Initial worktree | Clean; correct isolated branch; no pre-existing changes |
| Frontend install | `npm ci --no-audit --no-fund` succeeded; Node 22.23.0, npm 10.9.8 |
| Unit/component tests | `npm test`: **10 files, 192 tests passed** |
| Typecheck/production build | `npm run build` passed; Vite warns about a chunk over 500 kB |
| Frontend lint | `npm run lint`: **32 existing errors, 1 warning**; unused test-mock bindings, React effect/ref rules, two empty interfaces |
| Build size baseline | JS 551.02 kB / 164.72 kB gzip; CSS 115.30 kB / 16.41 kB gzip; result background 1,527.25 kB; routes/demos eagerly imported |
| Backend setup/tests | Locked `uv sync --extra dev` attempts with Python 3.14 and 3.11 failed downloading wheels from `files.pythonhosted.org` (`Socket is not connected`); offline cache also insufficient. `.venv/bin/python -m pytest` then failed with `No module named pytest`. Backend tests have no passing baseline in this environment |
| Browser inspection | Production preview on isolated port 4178, Chrome via installed Playwright, desktop 1440×900 and mobile 390×844; welcome/setup/error/journal-demo inspection plus table/session-refresh inspection using intercepted REST/WS fixtures |
| Browser findings | Mobile seats/names/chips overlap; fixed chat/action areas compete; header wraps awkwardly. Setup exposes no semantic dialog. Production reload of `/game/:id` displays “正在加载游戏...” because identity is lost. Missing backend produces the existing generic model-loading error modal |
| Inspection limits | Browser fixtures verify current frontend rendering/recovery, not actual LLM/backend integration. No real keys, OAuth authorization, provider calls, or live paid game were used. Safari/Firefox, screen readers, full gameplay E2E, and performance tracing remain future acceptance work |

`playwright.config.ts` exists, but its `frontend/e2e` test directory is absent. It currently defines Chromium only and a backend launcher using `source .venv/bin/activate`, which is not portable to every shell. CI currently runs frontend tests/build only, not lint, backend tests, or browser tests.

Do not run `start.sh` during isolated auditing: it kills processes occupying ports 8000/5173, potentially including another worktree’s services. `deploy.sh` targets a different checkout and deploys; it is outside this task. Later local integration should use known free ports and explicitly configured proxies without touching another checkout.

### 2.3 Differences between documentation and implementation

| Claim or apparent feature | Actual implementation | Rebuild treatment |
| --- | --- | --- |
| 1–5 AI opponents | Backend accepts 1–5; `GameConfigForm` and `gameStore.addAIOpponent` stop at 4 | Support all five |
| Adjustable raise multiple in PRD | Wire action has no amount; engine doubles the base | One fixed raise, explicit payment; no slider |
| “Single-round betting cap” | `max_bet` limits the raised **base**, not total contributions or pot | Label 注额基数上限 and explain seen-player multiplier |
| Automatic next hand / first random dealer | UI starts each hand manually; engine first dealer is first eligible player, then rotates | Preserve actual behavior |
| Game ends when any player reaches zero | Engine finishes only when at most one player has chips after settlement | Allow eliminated human to watch/start subsequent hands while AI continue |
| Keys memory-only / backend-only | Browser persists keys; REST sends a header, WS sends a query parameter; agents retain copies; server environment fallback exists | Describe actual storage and lifecycle; preserve compatibility |
| Preset AI personalities | Current prompts let strategy emerge; no personality field in creation contract | No personality editor or invented style claims |
| Experience learning advertised | Reviewer implementation/tests exist; `_maybe_experience_review` in live WS is a no-op | Keep review reader/event support; honest empty state |
| Full-game summaries advertised | Generator call is commented out; `ResultPage` always passes `summary={null}` | Read existing summary if present; no endless “generating” state |
| SQLite means recoverable active games | `GameStore` is memory-only, no restore/list API; WS path does not persist full round/game snapshots | Same-browser reload can improve; server restart recovery cannot be promised |
| “End game” button | Disconnects/navigates, never calls `/end`; backend game can continue | Separate leave, interim results, and actual end semantics |
| Action hotkeys Q/W/E/R/F | Labels exist; no key handlers | Implement guarded optional shortcuts or omit hints until working |
| Compare targets on character | Seat click only sets `compareTargetId`; selector-list click sends action | One shared target-selection/confirmation path |
| Shift+Enter multiline chat | Current input is single-line despite comment | Preserve Enter send; use textarea if multiline hint is retained |
| Other hands never reach browser | Viewer-filtered state hides opponent hands, but unscoped REST GET returns all; comparisons and forced showdown disclose certain hands | Use viewer-scoped reads; preserve authorized reveals; flag backend exposure separately |

## 3. Feature-parity checklist

Unchecked boxes are **future verification obligations**, not a claim the features are missing today. Labels: **P** = preserve working capability; **F** = correct frontend defect/complete existing intent; **C** = supported contract with dormant/limited backend behavior; **N** = deliberate UX improvement requiring no rule change. Phase references are in §10.

### 3.1 Entry, setup, and preferences

- [ ] **S01 P** Home offers new game, model configuration, and AI settings; retain Simplified Chinese UI and recognizable Golden Flower identity.
- [ ] **S02 P/F** `/lobby` remains a compatible entry/redirect; valid, missing, stale, and unknown routes have intentional destinations.
- [ ] **S03 P** Human nickname; blank defaults to `人类一败涂地`; preserve current 12-character UI limit unless explicitly revised. Do not claim a backend name constraint that does not exist.
- [ ] **S04 P/F** Add/remove 1–5 AI opponents, default three; never allow zero or more than five.
- [ ] **S05 P** Per-seat model selection across providers, same model on multiple seats, optional custom name, 32-character UI limit, short unique automatic names.
- [ ] **S06 F** Preserve explicit custom names when changing a model; automatically update only names still marked automatic. Show unavailable selections rather than silently changing strategy/model.
- [ ] **S07 P** Presets: 休闲局 `500/5/100/8`, 标准局 `1000/10/200/10`, 豪赌局 `5000/50/1000/15` in chips/ante/base-cap/turn-limit order.
- [ ] **S08 P** Advanced integer inputs: chips 100–100000; ante 1–1000; max_bet 10–10000; max_turns 3–50. Preserve API-accepted edge combinations; explain consequences instead of inventing new game constraints.
- [ ] **S09 F** Validate integer/range errors on blur/submit without coercing partially typed values; preset selection compares all four fields.
- [ ] **S10 P/F** Models loading/empty/failure/retry, setup loading/validation/server failure; configuration detour returns to the preserved setup draft.
- [ ] **S11 P/F** One create request per submission; obtain `game_id` and human ID; enter connected waiting room; first hand begins only on explicit start.
- [ ] **S12 N** Rule reference with card rankings, examples, blind/seen costs, compare tie rule, and cap meaning, available before and during play.
- [ ] **S13 N** Versioned non-secret setup/preferences persistence and same-tab session restoration; corrupt/unavailable storage falls back to usable memory state.

### 3.2 Providers, models, and AI settings

- [ ] **M01 P** OpenRouter, Azure OpenAI, SiliconFlow, GitHub Copilot flows work end to end.
- [ ] **M02 C/F** Include Zhipu/智谱 in the generic provider UI: backend routes and key-store support already exist, but current panel/wrappers omit it. Reconcile duplicate provider union definitions.
- [ ] **M03 P** Password key entry, whitespace trimming, masked saved preview, save/update, verify unsaved or saved key, remove, and visible error/success state.
- [ ] **M04 P/F** Preserve `golden-flower-provider-keys` migration. Explain “保存在此浏览器”; never display or log full credentials. Distinguish saved from verified.
- [ ] **M05 P** Azure endpoint + API version (default `2024-10-21`); SiliconFlow custom host; Zhipu host through its existing extra-config contract.
- [ ] **M06 P** Provider model catalog loading/refresh/search by ID/name, context length, empty/error states, added markers, add/remove, and updated setup choices. Current first-50 search behavior must not make further models undiscoverable.
- [ ] **M07 P/F** Use internal returned model ID for seating/deletion and original model/deployment ID for catalog identity; tolerate slashes and long names. Registered does not imply credentials are ready.
- [ ] **M08 P** Copilot disconnected/loading/device-code/copy/external verification/pending/slow_down/connected/expired/denied/error/retry/disconnect states; refresh available models after changes.
- [ ] **M09 F** Stop OAuth polls on close/unmount/expiry; show copy feedback/fallback and distinguish connected from `has_valid_token`. Treat provider access failures as reported, not a definitive diagnosis of subscription type.
- [ ] **M10 P** Global `detailed`, `fast`, `turbo` thinking modes; explain speed/detail tradeoff without guaranteeing latency or richer records retroactively.
- [ ] **M11 P/C** Token choices 2048/4096/8192/16384/40960/null; preserve wire values but explain current defaults/decision-mode overrides accurately (§4.5).
- [ ] **M12 P/C** Timeout 5–120s, retry setting 0–10, temperature 0–2; pending/success/failure states; global process scope and restart behavior clear. Flag retry-zero defect rather than conceal it.
- [ ] **M13 F** Serialize/coalesce setting updates and accept server-returned values; prevent stale saves from overwriting newer intent.
- [ ] **M14 F** Do not delete a model used by an active game from a live management surface; backend resolves registry entries again during calls. Key removal and Copilot disconnect explain their effect on active games.

### 3.3 Table and game actions

- [ ] **G01 P/F** Legible 2–6-seat layouts with stable seat identity/order, model/name, chips, round contribution, dealer, active actor, and all five player statuses.
- [ ] **G02 P** Pot, hand number, server turn count/limit, base stake, active-player count; no fabricated timer or turn countdown.
- [ ] **G03 P** Start first/next hand manually; charge antes/deal from server; subsequent dealer rotation; omit out players from dealing effects.
- [ ] **G04 P/F** Three facedown cards before peek; peek from hand/action area; no card ranks in hidden DOM/accessibility labels; reconcile seen state from snapshot on reconnect.
- [ ] **G05 P** Free peek changes future cost and does not spend the turn. Preserve WS off-turn peek capability with betting/active/connected guards and honest pending feedback.
- [ ] **G06 P** Blind call B; seen call 2B; blind raise 2B; seen raise 4B; raise updates base to 2B; labels display actual payment.
- [ ] **G07 P** Server-provided allowed actions govern spending; unavailable cost/action reasons; no all-in or invented partial calls.
- [ ] **G08 P** Fold confirmation/cancel, no chips charged, remain able to watch/chat/review completed hands.
- [ ] **G09 P/F** Seen-only compare costs call amount; choose active non-self target; cancel selection; same interaction from seat and list; initiator loses ties.
- [ ] **G10 P** Compare eliminates one player, not necessarily the hand; remaining players continue.
- [ ] **G11 P/F** Show compare cards only if delivered to this viewer; spectators see outcome without cards; forced-showdown `hands_revealed` is a distinct reveal source.
- [ ] **G12 P/F** One pending command; disable illegal/repeated actions until authoritative resolution; disconnected actions are never queued or silently discarded.
- [ ] **G13 P** AI thinking, optional reviewing event, fallback marker and action descriptions; backend decides AI moves and bystander speech.
- [ ] **G14 P/F** Action history with amounts, comparison outcome, fallback indicator and timestamps; derive ordinary history from snapshot actions after reconnect; mark unavailable metadata honestly.
- [ ] **G15 P/F** Dealing, flip, contribution, comparison, and winner feedback; no animation/timer may change chips, erase the server round, or delay eligibility for an action.
- [ ] **G16 P/F** Settlement remains visible with winner, pot, net deltas, actual win-method text, allowed reveals, journal link, and next-hand/end choices.
- [ ] **G17 P** Natural game over when at most one eligible player remains; human bust does not prematurely finish the match.
- [ ] **G18 F** Guard confirm/compare states on turn/round/game change and offline transitions; stale selections cannot dispatch.

### 3.4 Table talk, journals, and results

- [ ] **J01 P** Chat input trims empty messages, preserves 200-character UI limit, sends Enter safely with Chinese IME, and indicates offline/pending/error state.
- [ ] **J02 P** Distinguish action talk, bystander reaction, human message, and system message; sender/time/content readable; character bubbles are supplementary.
- [ ] **J03 F** Keep draft on failed send; do not claim delivered until echo; no automatic resends without a message ID/ack contract.
- [ ] **J04 P/F** Collapsible chat/action history, scrolling, and latest-message bubbles; keep reading position when new messages arrive and show unread count.
- [ ] **J05 P/C** Read whole-game or per-hand chat from REST; handle archive/live ID differences and late messages (§4.4), without surfacing `inner_thought` in public chat.
- [ ] **J06 P** Open journal from AI portrait or table control; select AI and completed hand; current-hand private reasoning is not offered.
- [ ] **J07 P** Expand structured decisions: hand evaluation, opponent/risk/chat analysis, reasoning, decision/target, confidence, emotion, table talk.
- [ ] **J08 P/F** Timeline and first-person narrative modes; loading/error/retry/empty/not-yet-available states; stale responses cannot replace another AI/hand selection.
- [ ] **J09 P/C** Render available strategy reviews: trigger, reviewed rounds, self analysis, opponent patterns, adjustment, confidence shift/context; no fabricated review activity.
- [ ] **J10 P/C** Render existing summary statistics and narrative sections when supplied; absent summaries are explicitly unavailable, not perpetually loading.
- [ ] **J11 P/F** Results rank by final server chips and display change from configured starting chips, human/AI identity, model labels, and accessible standings.
- [ ] **J12 F** Result data keyed by game ID; preserve non-secret final standings/config/history before `/end` removes memory; avoid using another game’s store state.
- [ ] **J13 P/F** Return home and play again; restore a setup draft for review, never silently launch/charge a new game. Journal stays reachable from results.
- [ ] **J14 C** Preserve cancel-summaries wrapper/cleanup compatibility if generation is ever active; current endpoint does not cancel all AI/chat/narrative tasks.
- [ ] **J15 P/F** Keep card, table, result, and thought demo coverage as explicit isolated fixtures; never inject demo state into a real game route.

### 3.5 Resilience, accessibility, and responsive delivery

- [ ] **R01 F** Connected transport is distinct from synchronized/playable state; freeze actions until a valid viewer snapshot and applicable turn information arrive.
- [ ] **R02 P/F** Exponential reconnect, bounded retries, manual retry, offline banner, terminal invalid-session state, intentional-close cleanup, stale-socket guards.
- [ ] **R03 F** Reload restores local player identity and fetches viewer-scoped state without auto-starting/replaying commands; missing identity/session is actionable, never an endless spinner.
- [ ] **R04 F/C** Reconnect restores facts, not missed animation history; explain server-restart loss and unavailable compare/review/archive data.
- [ ] **R05 P/F** Inline validation/HTTP errors, operation errors, general failure surface, and Copilot recovery with retry/dismiss/change-account exits; repeated failures coalesced.
- [ ] **R06 F** Malformed/unrecognized WS events, non-JSON HTTP errors, Pydantic 422 arrays, slow responses, aborted requests, and storage exceptions handled deliberately.
- [ ] **R07 N** Keyboard-only setup/play/review, dialog focus management, visible focus, announced turn/result/error, and semantic labels (§8).
- [ ] **R08 F/N** Touch/portrait/landscape/tablet/desktop layouts; readable six-seat table, virtual keyboard and safe areas, no action occlusion (§7).
- [ ] **R09 N** Reduced motion and optional sound; mute/default-off audio never carries unique information.
- [ ] **R10 F** Route-scoped loading, bounded histories/effects, measured bundle/render budgets, no raw secrets or private-card logging.

## 4. Current API, event, and state contracts

### 4.1 Transport and ownership

Frontend REST base is `/api`; socket URL is same origin `/ws/{game_id}?player_id={id}` with `ws:` or `wss:` chosen from page protocol. API keys currently travel as JSON in `X-Provider-Keys`; the socket adds URL-encoded JSON `provider_keys`. This is compatibility behavior, not an authenticated user-session protocol. Do not log the socket URL or capture real credentials in traces/screenshots.

Development Vite proxies `/api` and `/ws` to port 8000. Production nginx serves `frontend/dist`, proxies those paths, and falls back to `index.html` for client routes. `/health` is a backend endpoint; Vite does not proxy it. FastAPI also supplies `/docs`, `/redoc`, `/openapi.json`.

The backend is single-user-oriented: no login, ownership token, message sequence, action request ID, replay cursor, heartbeat command, explicit sync command, or end-game socket command exists. A WebSocket is keyed by `(game_id, player_id)`, one registry entry per player. Frontend must not imply safe multi-tab/multiplayer semantics.

### 4.2 REST endpoint inventory

`G` = game ID, `P` = player ID, `A` = AI agent/player ID, `R` = hand number. All paths below include their actual prefix. Successful responses use JSON and normally status 200. HTTP failures generally return `{detail: string}`; Pydantic validation can instead return `{detail: [...]}`. Network failures and non-JSON proxy responses require their own parsing branch.

| Method/path | Request | Response and behavior |
| --- | --- | --- |
| `GET /health` | None | `{status:"ok", app}` |
| `GET /api/models` | None | Array of `{id, model, display_name, provider, ...original-ID metadata}`. Dynamic models included regardless of current request’s keys; Copilot models only when server auth is connected |
| `POST /api/game/create` | `{player_name, ai_opponents:[{model_id,name?}], initial_chips,ante,max_bet,max_turns}` | `{game_id,message,players:[{id,name,player_type,chips,model_id,avatar}]}`; creates waiting game, agents, DB game/players. Invalid registered model 400; numeric/count validation 422 |
| `GET /api/game/G?player_id=P` | Viewer query | Full `GameState` with other players’ `hand=null`; 404 if not in memory. **Without viewer query it returns unfiltered hands**; new client never uses unscoped reads |
| `POST /api/game/G/start` | None | `{message,round_number,dealer_index,pot,current_player_index,game_state}`; begins a hand, persists current chips/status. 400 finished/already betting/insufficient players; 404 unknown game |
| `POST /api/game/G/action` | `{player_id,action,target_id?}` | `ActionResponse` below; 400 lifecycle/unknown action, 422 illegal move, 404 missing game. This route does not drive the WS AI loop/broadcast orchestration |
| `POST /api/game/G/end` | None | `{message,game_id,final_standings:[{id,name,chips}]}`; marks finished, updates DB chips, **removes game from memory**. 400 already finished; 404 missing. Does not settle an open pot or coordinate/cancel the active AI loop |
| `GET /api/game/G/thoughts/A` | None | `{game_id,agent_id,round_number:null,thoughts:[ThoughtRecordDTO],count}` ordered by round/turn; empty collection permitted |
| `GET /api/game/G/thoughts/A/round/R` | None | Same envelope with specified round, turn-sorted |
| `GET /api/game/G/narrative/A/round/R` | None | `{id,agent_id,game_id,round_number,narrative,outcome?,created_at?}`; 404 absent/not yet generated (no status endpoint) |
| `GET /api/game/G/summary/A` | None | `{id,agent_id,game_id,stats?,key_moments?,opponent_impressions?,self_reflection?,chat_strategy_summary?,learning_journey?,narrative_summary?,created_at?}`; 404 absent |
| `GET /api/game/G/reviews/A` | None | `{game_id,agent_id,reviews:[ExperienceReviewDTO],count}` ordered by trigger round |
| `POST /api/game/G/cancel-summaries` | None | `{game_id,cancelled:number}`; cancels registered full-game summary tasks only |
| `GET /api/game/G/chat` | None | `{game_id,round_number:null,messages:[ChatMessageDTO],count}` ordered by DB creation time |
| `GET /api/game/G/chat/round/R` | None | Same envelope filtered by round |
| `GET /api/providers` | Keys header | Array `{provider,name,configured,key_preview,extra_config?}` for OpenRouter/SiliconFlow/Azure/Zhipu; configured means supplied key is nonempty, not verified |
| `POST /api/providers/{provider}/verify` | `{key:string\|null}`; falls back to header | `{valid:boolean,message}`; unknown provider 404. Provider failures commonly remain HTTP 200 with `valid:false` |
| `POST /api/providers/{provider}/config` | Partial `{api_host?,api_version?}` | `{message,provider,extra_config}`; unknown 404, empty update 400; server-global memory, Azure values also update process environment |
| `GET /api/settings` | None | Settings object in §4.5 |
| `POST /api/settings` | Partial settings; explicit null supported for `llm_max_tokens` | Full updated settings. Global memory; 422 invalid mode/range; other nullable fields need careful client handling |
| `POST /api/copilot/connect` | None | `{user_code,verification_uri,expires_in}`; starts server-held device flow; upstream failure 500 |
| `GET /api/copilot/poll` | None | `{status:"pending"}` optionally `slow_down,interval` or `{status:"connected",models}`; absent/expired/denied flow 400 |
| `GET /api/copilot/status` | None | `{connected,has_valid_token,models}` |
| `POST /api/copilot/disconnect` | None | `{message}`; clears server-held auth |

Model-management families have identical verbs, with provider-specific original-ID fields:

| Prefix | Provider ID / added-model original ID | Catalog specifics |
| --- | --- | --- |
| `/api/openrouter` | `openrouter` / `openrouter_id` | Text-output models, context length, prompt/completion pricing strings |
| `/api/siliconflow` | `siliconflow` / `siliconflow_id` | Chat/text filtering, custom host, pricing/context when available |
| `/api/azure-openai` | `azure_openai` / `azure_id` | Calls `{endpoint}/openai/models?api-version=...`; verify deployment-ID suitability in integration, do not promise account deployment discovery beyond returned data |
| `/api/zhipu` | `zhipu` / `zhipu_id` | OpenAI-compatible catalog through configured/default host |

For **each** prefix:

- `GET /models`: requires matching key header; returns `{models:[{id,name,context_length:number|null,pricing:{prompt,completion}}],total}`. Missing key/config 400, upstream status failure 502, unexpected failures may become 500. Current server catalog caches last 300s and are not scoped by key/host; refresh may return cache.
- `GET /models/added`: `{models:[{id,model,display_name,provider,<original_id_field>}]}`.
- `POST /models`: `{model_id:<original ID>,display_name}` → `{message,model_id:<internal ID>,<original_id_field>,display_name}`; whitespace/empty validation 400. Registration is independent of key verification; repeated internal ID returns existing entry.
- `DELETE /models/{model_id:path}`: **internal ID**, returns `{message,model_id}`; absent model 404.

Current internal IDs: `openrouter-`, `siliconflow-`, `azure-`, `zhipu-` plus original ID with `/` replaced by `-`. Treat returned IDs as opaque rather than reproduce that normalization in UI. Copilot’s three configured IDs are `copilot-gpt4o`, `copilot-gpt4o-mini`, `copilot-claude-sonnet`; the server supplies their names/model mappings, not the client.

There are no key-save/delete REST endpoints, chat-send REST endpoint, game-list/recovery/result endpoint, arbitrary-amount action, or report-generation request endpoint. Do not implement clients against historical documentation that suggests otherwise.

### 4.3 Data/state inventory

| Shape | Fields / values |
| --- | --- |
| `Card` | `suit: hearts\|diamonds\|clubs\|spades`, integer `rank:2..14` (J=11,Q=12,K=13,A=14) |
| `HandResult` | `hand_type:1..6`, ordered `ranks`, `description`; engine type, not included as a dedicated hand-evaluation field in ordinary state |
| `Player` | `id,name,avatar,player_type:human\|ai,chips,status,hand:Card[]\|null,total_bet_this_round,model_id:string\|null` |
| Player status | `active_blind`, `active_seen`, `folded`, `compare_lost`, `out`; active is either first two |
| `GameState` | `game_id,players,current_round:RoundState\|null,round_history:RoundResult[],config,status:waiting\|playing\|finished` |
| `GameConfig` | `initial_chips,ante,max_bet,max_turns`; numeric defaults 1000,10,200,10 (server defaults configurable) |
| `RoundState` | `round_number,pot,current_bet,dealer_index,current_player_index,actions,phase,turn_count,max_turns`; indices refer to original server players order |
| Round phase enum | `waiting,dealing,betting,comparing,settlement,game_over`. Engine moves through dealing synchronously; betting/settlement/game_over are principal observable snapshot phases. Do not wait for a separate comparing snapshot |
| `ActionRecord` | `player_id,player_name,action,amount:number\|null,target_id:string\|null,timestamp` in seconds |
| `RoundResult` | `round_number,winner_id,winner_name,pot,win_method:string,hands_revealed:Record<P,Card[]>\|null,player_chip_changes:Record<P,number>` |
| `ActionResponse` | `success,action,player_id,amount,message,compare_result\|null,round_ended,round_result\|null,game_state\|null` |
| Compare result | `winner_id,winner_name,loser_id,loser_name,winner_hand,loser_hand,winner_cards,loser_cards`; last four nullable/redacted for uninvolved WS viewers |
| Public chat categories | `action_talk,bystander_react,player_message,system_message` |
| `ThoughtRecordDTO` | DB `id,game_id,agent_id,round_number,turn_number,decision`; nullable `hand_evaluation,opponent_analysis,risk_assessment,chat_analysis,reasoning,confidence,emotion,decision_target,table_talk,raw_response,created_at` |
| `ExperienceReviewDTO` | `id,game_id,agent_id,trigger,triggered_at_round`; nullable `rounds_reviewed,self_analysis,opponent_patterns,strategy_adjustment,confidence_shift,strategy_context,created_at` |
| Review trigger | `chip_crisis,consecutive_losses,big_loss,opponent_shift,periodic`; model confidence_shift −1..1 |
| Summary `stats` | `rounds_played,rounds_won,total_chips_won,total_chips_lost,biggest_win,biggest_loss,fold_rate`; REST nests these, existing client flattens them |
| `ChatMessageDTO` | REST `id` is DB integer converted to string; `game_id,round_number,player_id,player_name,message_type,content,timestamp,related_action?,trigger_event?,inner_thought?,created_at?` |

DTOs must reflect nullability instead of casting `unknown` to optimistic frontend models. Normalize missing values at the presentation boundary; missing confidence is “未记录”, not 0% certainty. Keep raw LLM output in the transport contract but out of normal gameplay; never render it as HTML. Preserve server `win_method` text instead of assuming demo values such as `all_folded` are real enums.

`player_chip_changes` is **net change since the beginning of the hand**, not a delta to apply to the latest snapshot. After settlement, `players[].chips` already includes payout. `round_history` is authoritative and keyed by round number; do not append duplicate results received in both snapshot and event.

### 4.4 WebSocket protocol and sequencing

Client messages:

| Type | Data |
| --- | --- |
| `start_round` | No data required |
| `player_action` | `{action:"fold"\|"call"\|"raise"\|"check_cards"\|"compare", target?:P}`; **`target`**, not REST’s `target_id` |
| `chat_message` | `{content:string}`; server trims and ignores empty content |

Server envelope is `{type,data}`:

| Type | Data | Client responsibility |
| --- | --- | --- |
| `game_state` | Viewer-filtered `GameState` | Replace authoritative facts; derive phase/seat/cost/seen state; reconcile pending command |
| `game_started` | Viewer-filtered `GameState` | Builder/type exists, but normal WS start handler does not emit it; support defensively |
| `round_started` | `round_number,dealer:<name>,dealer_index,pot,current_bet,max_turns` | Clear previous-hand transient presentation, create scoped deal effect; wait for snapshot |
| `cards_dealt` | `{your_cards:Card[]\|null}` | Hold own cards in memory; do not expose them until seen |
| `turn_changed` | `{current_player:<name>,current_player_id,available_actions:string[]}` | Accept actions only for local actor in betting phase; clear stale confirmations |
| `player_acted` | `{player_id,player_name,action,amount,compare_result:null\|object,is_fallback}` | Acknowledge own matching command, supplementary activity/effects/reveals; no chip arithmetic |
| `chat_message` | `{id:<runtime UUID>,player_id,player_name,message_type,content,timestamp}` | Deduplicate same-source IDs; display public content; no round number/game ID in this event |
| `round_ended` | `RoundResult` | Upsert settlement presentation; snapshot remains monetary authority |
| `game_ended` | `{final_standings:[{id,name,chips}]}` | Finish local session and preserve result receipt |
| `ai_thinking` | `{player_id,player_name}` | Show waiting state; no promised completion time |
| `ai_reviewing` | `{player_id,player_name,trigger}` | Contract supported; live scheduler currently never emits it |
| `error` | `{message}` | Surface actionable operation error; no request correlation supplied |
| `copilot_error` | `{message,error_code}` (currently `copilot_subscription_error`) | Dismiss/reconfigure path; AI fallback may continue the game |

Observed handler sequences:

1. **Connect:** validate game/player → accept → set provided keys on agents → `game_state`; if the connected player currently owns a betting turn, also `turn_changed`. No chat replay, current thinking event replay, or AI-loop restart is initiated by connect.
2. **Start hand:** `round_started` → `game_state` (antes deducted, phase already betting) → private `cards_dealt` → AI loop. The loop emits `ai_thinking` for AI turns and `turn_changed` when a human action is needed. Do not require every AI turn to have a `turn_changed`.
3. **Action:** engine mutates state → `player_acted` → `game_state`; optional AI table talk follows. If not ended, AI processing continues; bystander reactions run in background and can interleave.
4. **End of hand:** final action’s `player_acted` → already-settled `game_state` → `round_ended` → another `game_state` → optional `game_ended`. Narratives start in background with no ready event. This sequence explains the current frontend’s double-delta/duplicate-history bug.
5. **Human peek:** WS special case sets `active_seen`, broadcasts action/snapshot, and sends updated `turn_changed` if it is the human’s turn. It bypasses ordinary engine action recording and accepts off-turn peeks; the REST engine action is turn-restricted. WS processing awaits AI loops, so an off-turn message may be delayed until the receive loop resumes.

Pre-accept close codes in source: **4001** missing player ID, **4003** player not in game, **4004** missing game. Browsers/proxies may expose a generic failed handshake/1006 instead; use viewer-scoped HTTP diagnosis rather than depend solely on seeing custom codes.

Current retry behavior: 1s exponential backoff capped at 30s, maximum 10 attempts; intentional closure suppresses retries. The new transport adds jitter, online/offline awareness, generation guards for every socket callback, explicit terminal-error handling, and manual retry without inventing protocol events.

Protocol limitations to preserve honestly:

- Events lack sequence/revision/request IDs. Never retry spending commands automatically. On uncertain delivery, freeze controls and resynchronize; determine facts from snapshot/actions/status before allowing another choice.
- Reconnect cannot reconstruct lost private compare-card events from the ordinary snapshot. Do not use unfiltered REST to recover them; show the known outcome and leave unavailable cards hidden.
- Live chat UUIDs are not persisted as DB IDs; REST timestamps are generated by DB time, not the original event time. A simple ID or text deduper cannot guarantee correct archive/live merging, especially repeated text. Keep restored archive and current live segment source-tagged; do not silently collapse valid repeated messages. Exact cross-source continuity would require a narrow future server ID change.
- Late background chat events have no round number; do not assign a supposedly authoritative hand number from the current UI. Use REST for definitive per-hand archives.
- Connection registry replacement/disconnect races and AI-loop ownership are server concerns. Client prevents duplicate connections and warns on another same-game tab; that is not a complete server concurrency fix.

### 4.5 Configuration, AI behavior, and persistence

Settings response: `{llm_max_tokens:number|null, ai_thinking_mode:"detailed"|"fast"|"turbo", llm_timeout:number, llm_max_retries:number, llm_temperature:number}`. Defaults are null/fast/30/3/0.7 absent environment overrides for the last three.

Behavior matters more than current labels:

- `make_decision` passes mode-specific token overrides: detailed 4096, fast 2048, turbo 1024. These override the global token setting for decisions. For calls without an override, null falls back to 40960 for LiteLLM or 4096 for Copilot. “无限输出” is not an accurate promise.
- Retry loops use `range(1, llm_max_retries + 1)`: the configured number is currently total attempts; zero means no attempt. Flag for a narrowly scoped future fix; until resolved use accurate help text and a safe nonzero default without mutating the API definition.
- Copilot calls have their own 60s HTTP timeout, so the global timeout does not uniformly govern all providers. LLM latency is not a frontend SLA.
- Ordinary LLM failures generally return a fallback decision (call if legal, otherwise fold); missing agents, propagated errors, or failed application can lead to auto-fold. Do not describe every timeout as a fold. Show actual `is_fallback` when provided.
- Blind AI prompt input does not include its actual cards. Bystander reactions are generated for active eligible AI in parallel, with a must-respond fallback for human chat when eligible AI exist; there is no current two-response probability cap.
- Structured thoughts and chat are written in the live path; hand narratives are asynchronous and may fall back to generated plain text. Review/report modules exist but live review scheduling is a no-op and game-summary generation is disabled.

| Lifetime | Data |
| --- | --- |
| Browser localStorage today | Zustand `golden-flower-provider-keys` only; no game identity or active snapshot persistence |
| Browser memory today | Setup, game facts, local human ID, transient UI, settings cache |
| Server process memory | Active games, agents and their keys/thought memory, dynamic model registry, provider extra config, settings, Copilot auth, WS/chat contexts and task handles |
| Server environment fallback | Provider-specific key if agent has no supplied key; Azure config writes API base/version environment values |
| SQLite | `games`, `players`, `rounds`, `thought_records`, `chat_messages`, `experience_reviews`, `round_narratives`, `game_summaries` |

SQL tables do not imply full live recovery: create and REST lifecycle endpoints persist some facts; the WS round lifecycle does not persist `RoundDB`/complete current chips in the same way. There is no game-state rehydration from SQL on startup. Removing a key in this browser does not erase a copy already held by an existing agent; removing all keys and reconnecting does not clear agent keys because the WS handler only updates them when its parsed key map is nonempty.

## 5. Rules that the frontend must not redefine

1. Standard 52-card deck, no jokers, three cards per eligible player. Order: 豹子 > 同花顺 > 同花 > 顺子 > 对子 > 散牌. A-2-3 is the lowest straight; Q-K-A the highest; no K-A-2 wrap. Same category compares ranked values; pair value before kicker. Suits do not break equal hand ranks.
2. First dealer is the first eligible player; later dealer moves to next active seat after reset. Play begins after dealer. Preserve the server array order even when the visual table rotates around the human.
3. Ante is `min(config.ante, player.chips)` for each eligible player. There is no general all-in/side-pot system; a short ante does not authorize invented partial calls.
4. Let base stake be B. Blind call B/raise 2B; seen call 2B/raise 4B; raise makes the new base 2B. Raising requires enough chips and `2B <= max_bet`. Compare requires seen status, active non-self target, and enough chips for seen call cost. Fold/peek cost zero.
5. Looking does not consume a turn. Compare loser leaves the current hand; if ranks tie, initiator loses. The hand continues if multiple active players remain. Ordinary compare information is private to participants on WS.
6. One remaining active player wins the pot. Forced showdown compares surviving hands; exact showdown ties currently retain the first best player in server list order, with no split pot. Win-method wording currently says “其他玩家全部弃牌” even when comparison caused the last elimination; display facts without deriving additional rules from this label.
7. Net deltas are measured against contributions for the entire hand. Zero-chip players are marked out at settlement. Natural game completion requires at most one player with chips, not the first bust. Match hand count is not preconfigured.
8. **Confirmed source-level turn-limit defect:** `_count_actions_in_current_turn` returns `len(betting_actions) % active_count`; `advance_turn` increments only if that value is `>= active_count`, which cannot happen for positive counts. Consequently normal progression does not advance `turn_count` to the configured limit. Existing max-turn test manually sets the counter. Preserve server authority, add a natural-progression regression in a later narrowly scoped engine fix, and never “fix” this by ending hands on a frontend timer.

## 6. UX information architecture and screen/state map

### 6.1 Routes and primary tasks

Keep public table/result URLs compatible. Proposed new setup/configuration URLs are client-side routes and require no new backend routes.

| Surface | Proposed route / presentation | Primary task |
| --- | --- | --- |
| Home | `/` | Start a table or resume the known local session; show one clear primary action |
| Setup | `/new`; `/lobby` redirects here after migration | Human name, 1–5 opponents, stakes, review configuration, create |
| Model room | `/settings/models` | Connect provider, verify/manage key, add models; preserve return-to-setup context |
| AI settings | `/settings/ai` | Adjust thinking mode and advanced call settings |
| Rules | `/rules` or accessible contextual sheet | Learn costs, ranks, comparison, and hand completion |
| Table | `/game/:id` | Play/watch the current hand; inspect table talk and completed-hand journal |
| Results | `/result/:id` | Final standings or clearly labelled current standings, then journal or play again |
| Journal | Table/result panel, optional `?panel=journal&agent=...&round=...` | Select completed hand and AI; read decisions/narrative/reviews without losing table context |
| Component scenarios | Explicit development/test fixture routes replacing existing `/demo/*` coverage | Exercise visual states in an isolated store, never substitute for live game data |
| Fallback | Unknown route / expired game | Return home, recover known session, retry supported read; no blank page |

Large screens may present setup/settings as contained pages with table-room continuity. Phones use full-height pages/sheets, not nested desktop modals. Model configuration and setup share a return path and draft, not overlapping modal stacks.

### 6.2 State map

```text
Home
 ├─ Models → provider selected → key/config or Copilot device flow
 │                              → ready / empty catalog / retryable error
 ├─ AI settings → loading → editing → saving → saved / recoverable error
 ├─ Rules
 ├─ Resume → identity check → connecting → synchronizing → Table / expired
 └─ New game → draft → validation → creating → Table waiting

Table waiting ──explicit start──> starting/deal presentation
                                     │ authoritative snapshot
                                     v
                             betting / watching
                  ┌──────────────────┼───────────────────┐
               AI acting        human blind          human seen
             (may be slow)       │ peek pending        │
                  │              └───────────────> seen
                  │           call / raise / fold-confirm / compare-target
                  └──────────────────┼───────────────────┘
                                command pending
                          accepted / rejected / uncertain
                                     │
                 another actor <─────┴─────> settled hand
                                                ├─ Journal (completed hands)
                                                ├─ explicit next hand
                                                ├─ end between hands → results
                                                └─ natural finished → results

Any live state → offline/reconnecting → synchronizing → restored server phase
Any live state → missing/invalid session → recoverable explanation + home
Results → loading receipt/server data → standings + journal / unavailable
Results → play again → populated setup draft (explicit create required)
```

Connection, pending command, game phase, and visible panel are orthogonal state domains. “AI thinking”, “journal open”, or “animation running” is not a new authoritative game phase.

### 6.3 Interaction decisions

- **Action dock:** always shows own chips, blind/seen status, actual call/raise/compare payments, and turn explanation. Keep button positions stable across disabled/pending states. Use a distinct fold action with confirmation and a compare step that names target and fee before dispatch.
- **Peek:** before dispatch, explain that future bets cost twice the blind amount. Reveal after server acknowledgement/status, not immediately on a local click. Off-turn peek may stay pending while the backend processes AI; do not send a second request.
- **Settlement:** leave the final server round in place. A “本局结束” tray shows result, net chips, visible cards, journal and next-hand action. Closing an effect never erases the round.
- **Journal:** auto-select latest completed hand on first opening, retain deliberate selections, and distinguish AI confidence from measured win probability. Empty sparse/turbo records are normal. Poll a missing narrative conservatively only while that hand is open (e.g. 2/5/10s, then stop after 30s and offer refresh); 404 cannot distinguish unfinished from failed generation.
- **Results and leaving:** “离开牌桌” navigates away without promising to stop backend work; “查看当前战况” is read-only and labelled non-final. “结束对局” calls existing `/end` at a settled/waiting boundary, stores the receipt first, then leaves. During betting offer “本局后结束”; this records intent but does not auto-fold, and the player must finish any human actions. Do not introduce immediate pot forfeiture/payout rules to disguise the current end-button bug. Reliable immediate cancellation would require a separately scoped backend lifecycle fix.
- **Recovery:** show last-known table under an offline banner, disable spending/peek/start, preserve drafts, reconnect then replace facts. Missing local identity offers home/new game and an explanation; do not recover by requesting unfiltered hands or guessing another player ID.
- **Provider readiness:** show registered models and credential status separately. Server-environment credentials are a valid existing path but not exposed by `/providers`; use “使用服务器配置”/unknown readiness with an explicit user choice, not a hard block that breaks it.
- **AI errors:** distinguish an invalid player action, offline connection, and a provider fallback. Fallback is a visible event, not a modal for every AI move. Copilot reauthorization is a recoverable provider flow; no unverified billing/subscription claims.

## 7. Design direction and responsive layout

### 7.1 Art direction

The scene should feel like a compact card room built around three-card hands. The characteristic object is the table itself: a softly bevelled petrol felt surface, small brass dealer marker, ivory cards, and physical seat plaques. The memorable detail is a **three-petal Golden Flower dealer marker** that moves between seats at hand boundaries and opens the contextual rules/hand information. Its three lobes echo the three-card hand; it is not an ornamental chart.

Avoid a sidebar of KPI cards, giant statistic tiles, neon gradient borders on every control, full-screen generated backdrop text, and large character art that competes with names/cards. Existing opponents remain recognizable through cropped portraits; material, type, spacing, and clear game state establish identity.

Compact token proposal (verify contrast during implementation):

| Token | Color | Role |
| --- | --- | --- |
| Ink | `#162630` | Page surround, dark text on light controls |
| Petrol felt | `#214E59` | Table surface with subtle static texture |
| Oxblood lacquer | `#693344` | Rail, card-back motif, restrained secondary surfaces |
| Aged brass | `#E5BD72` | Primary action, dealer marker, payout emphasis; use ink text |
| Card ivory | `#F8F5EC` | Cards and primary text, not a full cream page background |
| Mist | `#B9CDD1` | Secondary text and structure; validate final surface pairings |

Semantic success/danger/focus tokens will be measured separately; pair them with text/icon/shape, not color alone. Shadows imply material depth, not glow. Use a 4px spacing base, 8–12px control radii, and more generous table-rail curvature. Main controls are 44–48px minimum high.

Typography: restrained **Noto Serif SC 600/700** for the Chinese sign and result headings; **Noto Sans SC / PingFang SC / Microsoft YaHei** for readable UI; **IBM Plex Mono** tabular digits for stakes/chips, with a system monospace fallback. Self-host licensed subsets/weights if acquired; do not make Google Fonts a critical dependency. Card indices use a legible card-oriented serif and familiar suit symbols. Body 15–16px, secondary text 13–14px, smallest meaningful label 12px; display text scales with `clamp`, not fixed `text-7xl`.

Two layouts considered: a cinematic first-person wall of full-body characters, or a table-centered spatial layout with compact portraits and a stable action rail. Choose the second: it communicates betting order, scales to six seats, and keeps player controls near their cards. Retain cinematic character detail only where room permits. This choice is specific to the existing three-card game rather than an AI configuration dashboard.

### 7.2 Layout sketches

Desktop, ≥1100px: table plus one quiet optional side panel. Card room consumes the available width when panels are closed.

```text
┌ Home / hand 4        connection        Rules   Models   Leave ┐
│                  seat B      seat C                         │
│        seat A       felt / pot         seat D   ┌─────────┐  │
│                 contribution markers           │ Talk    │  │
│                     seat E                     │ Actions │  │
│                  YOUR THREE CARDS              │ Journal │  │
├ Your chips · blind/seen · turn/cost explanation ┴─────────┴──┤
│ Peek     Call 20     Raise 40     Compare…          Fold…    │
└─────────────────────────────────────────────────────────────┘
```

Mobile, <768px: compact opponents wrap around a small table in defined 1–5-opponent arrangements. Lower-priority panels move to a sheet; no fixed-width floating windows over controls.

```text
┌ Hand 4           Connected            Menu ┐
│     seat A      seat B      seat C         │
│   seat D       POT 120        seat E       │
│             latest public action          │
│            YOUR THREE CARDS               │
│ Your chips 980 · blind · Your turn         │
├────────── Call 20 ───── Raise 40 ───────────┤
│ Peek / Compare…                  Fold…    │
├ Talk (2)      Actions       Journal        ┤
└────────────── safe-area inset ─────────────┘
```

768–1099px: compact arc/oval table, dock beneath, collapsible side sheet. For heights below 600px, reduce decorative table height, use compact horizontal information, and allow deliberate page scrolling rather than clip actions. CSS grid/container queries define geometry; absolute positioning is reserved for bounded table seats and temporary effects with measured anchors.

Use `100dvh` with fallback, safe-area padding, and a scrollable content region. On virtual-keyboard open, chat input and recent messages remain visible; a clear return-to-table action restores the dock. At 200% zoom switch to the compact layout. At 320px wide, allow vertical reflow without horizontal page scrolling; all six seat identities and balances remain available. Long CJK/model names can wrap or truncate with an accessible full label; never reduce critical figures to 8px.

### 7.3 Existing asset inventory and migration

| Asset | Current dimensions / approximate size | Decision |
| --- | --- | --- |
| `lobby-bg.jpeg` | 1024×1024, 181 kB | Preserve in legacy until cutover; new home uses purposeful table composition, not baked-in generated signage |
| `game-bg.jpg` | 1376×768, 239 kB | Legacy scene reference; replace gameplay geometry with responsive CSS/SVG table |
| `table-bg.png` | 1024×1024, ~1.2 MB | Older table asset; not in current production build asset list; remove only after import audit |
| `result-bg.png` | 1024×1024, 1.53 MB | Replace background-dependent result page with readable standings/hand history |
| `characters/char-1..5.webp` | Five 800×800 images, ~153–229 kB each, ~946 kB combined | Reuse initial portrait crops/variants if visually coherent; stable mapping per AI; load only seated portraits |
| `Cards/*`, `styles/cards.css` | CSS/SVG pips, court faces, GF patterned backs, flip/fan effects | Retain recognizable suits and deck semantics; rebuild accessible face/back rendering and sizing |
| `public/favicon.svg` | Golden Flower SVG | Keep or adapt to three-petal mark; remove unused Vite icon at final cleanup |
| `docs/images/Pic1..5.jpg` | Historical screenshots | Baseline reference, not current acceptance evidence |
| `docs/design-refs/*` | Referenced by older docs, absent in this checkout | Do not depend on unavailable assets |
| Audio / local font files | None found | Optional audio and self-hosted type are later asset tasks with explicit licensing/source records |

No image generation or asset replacement is needed in Phase 1. Before producing new artwork, validate its readable small-screen crop and provenance. Do not create a large decorative asset dependency before the table works.

## 8. Accessibility, motion, audio, and performance

### 8.1 Accessibility

Target WCAG 2.2 AA for the interaction surfaces. Use semantic landmarks/headings/forms, labels tied to inputs, native buttons/selects, and one shared dialog/sheet primitive. Native `<dialog>` plus tested focus return/inert behavior is preferred before adding another component library. Tabs use proper selected state and keyboard behavior; expandable journal sections expose `aria-expanded`.

- Full keyboard path: configure provider → setup → create/start → peek/call/raise/fold/compare → settlement → journal → next hand/end. Focus remains visible and is not stolen by logs, AI events, or animations.
- Modal/sheet focus trap, Escape, initial focus, background inertness, and focus restoration; confirmation defaults do not accidentally choose a spending/destructive action. Avoid stacked dialogs.
- Hidden cards are represented as “三张未看牌” without rank/suit nodes in the accessibility tree or visually hidden face content. Visible cards have spoken suit/rank labels; suits are distinct shapes as well as red/black.
- One polite live region for turn and settlement changes, assertive only for actionable blocking errors. Chat announcements opt-in/limited; do not announce every animation frame or AI message during a decision.
- Minimum 4.5:1 ordinary text, 3:1 large text/UI boundaries; focus indicator distinguishable on each surface. Verify actual rendered colors, not just tokens.
- 44×44px preferred interactive targets with separation; visible disabled reasons; portrait/info controls are buttons, not clickable divs.
- Optional Q/W/E/R/F shortcuts only when enabled, table focused, correct action legal, no input/contenteditable/IME composition/dialog active, and no modifier/repeat key event. Visible shortcut hints appear only when handlers work. Fold remains a confirmation.
- Set document language to `zh-CN`; format numbers consistently, announce signed deltas, support text resizing, forced colors, reduced motion, and screen-reader result tables.

### 8.2 Motion

Framer Motion handles bounded layout/presence transitions; CSS handles hover/focus and card-face transforms. Suggested timings: button feedback 100–150ms; panel 160–220ms; flip 200–280ms; chip contribution 250–400ms; compact deal sequence ≤700ms; payout emphasis ≤600ms. Animate transform/opacity rather than blur/filter/large shadows.

Effect entries carry game ID, round number, and local connection generation. Cancel on navigation/new snapshot generation; cap and coalesce the effect queue during bursts. A reconnect renders the latest facts immediately without replaying a whole hand. `prefers-reduced-motion` uses instant placements and short opacity transitions; it must still resolve every logical state. No infinite neon flicker, screen shake, or mandatory confetti. Animation completion callbacks never decide whether a player can act.

### 8.3 Audio

Current game has no audio; sound is optional polish, not parity-critical. Default off, opt-in after a user gesture, persistent mute preference, a few quiet deal/chip/turn/payout cues, no automatic background music. Lazy-load small licensed sounds only after opt-in, cap concurrent playback, do not replay sounds on reconnect, pause in hidden tabs, and handle browser autoplay rejection silently. Every cue has an equivalent visible/announced state. If assets are not ready, ship complete silent play.

### 8.4 Performance budgets and measurement

Budgets are proposed acceptance targets, not measured current guarantees:

- Initial home route JS ≤180 kB gzip; CSS ≤25 kB gzip. Gameplay/journal/results loaded on demand; no accidental eager demo imports. Total initially needed table assets ≤1 MB at mobile resolution; no single backdrop over 250 kB.
- Home LCP ≤2.5s, CLS ≤0.1 using Chromium at 390×844 with a cold cache, 4× CPU slowdown, 1.6 Mbps download / 750 kbps upload, and 150ms latency; take the median of five runs. Input feedback within 100ms and INP target ≤200ms during a scripted hand. Record browser/hardware/profile with measurements and confirm usability on a physical phone. Exclude remote LLM processing from client response metrics.
- Ordinary table transitions target 60fps on the reference desktop and no sustained jank on the reference phone. No avoidable >50ms task during an action after assets load.
- Zustand selectors isolate seats/dock/log; no whole-store subscription for every component. Cache immutable journal responses by `(game,agent,round)`; cancel stale requests. Bound rendered log/chat rows (initially 200; load/expand older entries deliberately) and effect count; preserve access to history.
- Compare heap/listener/socket counts before and after 20 route transitions and a long fixture session. No growing timers, repeated WS connections, accumulated animation DOM, or unbounded raw payload logging.
- Never prefetch provider catalogs, summaries, or expensive external operations to animate a landing page. Decode/reserve portrait dimensions; use system-font fallback immediately and subset display fonts.

## 9. Frontend architecture and migration strategy

### 9.1 Chosen stack

| Choice | Reason |
| --- | --- |
| React 19 + strict TypeScript | Already installed, tested, and deployable; declarative accessible DOM fits a turn-based card game |
| Vite 7 SPA + React Router 7 | No SEO/SSR need; preserve same-origin API and nginx routing; lazy routes and route errors improve current bundle/loading |
| Zustand 5 | Repository convention; scoped stores/selectors suit snapshots and local controls; avoid a second global state system |
| Tailwind 4 + CSS custom properties/CSS modules where geometry warrants | Shared tokens/utilities with bounded table/card styling; no global selector collisions during migration |
| Framer Motion 12 + CSS/SVG | Existing dependency supports deliberate effects; DOM suits accessible cards better than canvas/WebGL |
| Lucide | Existing utility icon set; bespoke flower/dealer and card artwork kept small |
| Native fetch/WebSocket + typed adapters | Protocol is small; explicit error/ack/reconnect ownership is more important than adding a transport framework |
| Vitest + Testing Library + Playwright | Already present; extend from isolated tests to realistic event sequences and browser behavior |

No new runtime library is required initially. Use small explicit discriminated unions/reducer transitions instead of introducing XState/Redux/query-cache infrastructure. A new schema/form/headless-component library needs a concrete gap and package review first. A later `@axe-core/playwright` dev dependency is reasonable if no equivalent is present, solely for automated accessibility audits; manual keyboard/screen-reader checks still apply.

### 9.2 Proposed module structure

```text
frontend/src/
  app/                 router, shell, route errors, application providers
  domain/              wire DTOs, decoded events, pure selectors, cost formatting
  transport/           HTTP client, endpoint adapters, WebSocket session controller
  features/
    setup/             setup draft, seat editor, presets
    providers/         provider catalog, credentials, model registration, Copilot flow
    preferences/       runtime AI settings and local presentation preferences
    game/              authoritative session store, event reducer, command lifecycle
    table/             table geometry, seats, cards, action dock, settlement tray
    conversation/      public chat, action history, archive/live segments
    journal/           keyed resources, decision timeline, narrative/review reader
    results/           standings, final receipt, replay-to-setup intent
  ui/                  button, field, dialog/sheet, tabs, status, empty/error states
  styles/              tokens, reset/base, bounded material/card/table styles
  assets/              optimized portraits, marks, optional audio/fonts
  test/fixtures/       explicit scenario data, isolated stores, recorded event sequences
```

Existing code need not be moved in one large operation. New modules begin alongside legacy, and old paths are removed only after their replacements are connected and tested.

### 9.3 State and transport invariants

1. **One snapshot.** Store one normalized viewer `GameState`; derive current actor, eligible targets, costs, and completion. Do not maintain mutable parallel `gameState.players`/`players` and `current_round`/`currentRound` copies.
2. **Separate ephemeral state.** Selected journal/target, drafts, pending command, connection state, and visual effects are separate. Card-face visibility derives from confirmed status plus allowed reveal data, not a global “animation finished” boolean.
3. **Socket outside component rendering.** One controller per active game/player; React subscribes and owns acquire/release. StrictMode setup/cleanup must not create two active command loops. Every callback checks controller generation.
4. **Explicit command lifecycle.** `idle → sending → awaiting server → acknowledged|rejected|uncertain`. Ordinary actions correlate conservatively with player/action and snapshot progress; peek acknowledges status change because its WS path omits ActionRecord. Lock locally before send; never assume 500ms means completion.
5. **Snapshots win.** Events describe effects, errors, action availability, private reveals, and chat. Snapshots replace monetary/game facts. Upsert history by round. No delayed callback sets `current_round=null`.
6. **Synchronization barrier.** On reconnect/new identity, clear pending eligibility/effects and reconcile snapshot. Human actions require fresh turn eligibility; off-turn peek is a special guarded command. Unknown delivery is not automatically repeated.
7. **Typed boundary.** Separate nullable wire DTOs from view models; validate minimal envelope/card/status/array shapes, ignore unknown event kinds safely, surface malformed critical snapshots as sync errors. HTTP errors retain status/code/detail and actionable field mapping.
8. **Storage boundaries.** Preserve existing keys via a versioned compatibility reader. Persist non-secret setup/preferences and same-tab `(gameId,playerId)` session identity; store a redacted final receipt by game ID. Do not persist live private cards, raw thoughts, credentials in session receipts, or treat cached chips as live truth. Clearing storage is supported.
9. **Request lifetimes.** Abort or generation-ignore stale REST responses. Results/journal/provider loads are keyed; switching route or AI cannot flash another resource’s contents. One provider’s failed catalog does not erase other configured providers.
10. **No second game engine.** Pure frontend cost selectors aid labels/tests; only backend allowed actions and snapshots authorize actual play. Never infer hand wins or force max-turn settlement client-side.

### 9.4 Incremental cutover

Use a build-time development opt-in (`VITE_WEB_GAME_REBUILD=1`) to select the **entire** new app shell/router while the current default stays runnable. Do not mount both apps or connect both stores to the same socket. Prefix new styles under the new root until the old app is removed. Retain identical `/game/:id` and `/result/:id` paths so game IDs and deep links remain compatible.

Build toward a functional minimal vertical slice through separate PRs: contracts/fixtures → shell and state → connection → setup/start → actions → settlement. Complete configuration and journal next, then harden and polish. Each PR keeps the legacy default runnable and supplies a working fixture or live path for its own scope; unfinished controls are not advertised as working. Switch the default only when all parity gates pass. Remove the temporary flag, legacy components/assets/demos, obsolete tests, and stale docs through separate cleanup PRs in the final phase; never leave two permanent application architectures.

## 10. PR-sized implementation plan and runnable checkpoints

### 10.1 Delivery policy and branch lifecycle

The entire rebuild is authorized; phases are milestones, **not PR boundaries**. Each numbered package below is one separately reviewable branch/PR with an explicit scope, prerequisite, and verification gate. If a package grows into multiple independent changes, split it further before implementation and give each new package its own scope and checks. Do not defer completed work to the end of a phase or combine it into a large rebuild PR.

1. **First PR:** `feat/web-game-reimagined` contains only `docs/WEB_GAME_REBUILD.md`. The present instruction ends after document QA and a local conventional commit. Do not push or create this first PR; its publication is left to the user. Do not append implementation to this branch or commit.
2. **Next branch:** use a focused name such as `feat/web-game-2a-contracts`. Branch from current `main` when prerequisites have merged; otherwise branch from the required predecessor and target that predecessor branch in the PR. For several unmerged prerequisites, keep a dependency-ordered stack whose parent already contains them, or wait for those prerequisites to merge; do not create an unpublished integration branch. Include the dependency/package IDs and exact review base in the description. Separate branches may be used sequentially in this isolated worktree; do not modify another checkout.
3. **Completion means publication:** for later packages, once the scope works and verification is recorded, commit, push that package branch, and open its PR immediately, before starting the next package. Do not wait for the whole phase or rebuild. No repeated authorization is needed for this already requested workflow. A publication failure must be reported and resolved, not used to accumulate unrelated work on the branch. The first document PR is the explicit local-only exception.
4. **Keep diffs focused:** a child PR is reviewed against its immediate dependency, so its diff contains only its own work. After a predecessor merges, rebase descendants onto the updated dependency or `main` and retarget their PRs; exclude already-merged commits, especially after squash merges. Re-run affected checks after rebasing. Update an existing PR for review fixes; start a new branch for a new package. Do not merge PRs or deploy without separate instruction.
5. **Runnable at every boundary:** until cutover, the legacy default continues to build and run, while the opt-in app exposes only implemented behavior. Infrastructure packages have executable fixtures/tests; UI packages have a reachable fixture or live route and usable empty/error states. Do not leave dangling imports, knowingly broken intermediate commits, or a requirement to apply an unreviewed next PR to run the current one.
6. **Evidence travels with each PR:** concise problem/result, scope exclusions, dependencies, parity/acceptance IDs, commands and results, and screenshots for visible changes. Update checklist status only when its whole obligation is verified. Preserve the audit baseline; later evidence belongs to its package, not a rewrite claiming earlier checks passed.

### 10.2 Verification shared by all packages

- **Documentation-only:** validate Markdown tables/fences, unique checklist/package IDs, dependency references and scope wording; inspect the full staged diff and run `git diff --cached --check`. Stage only intended documentation. Existing application baseline in §2 remains evidence; no runtime change is implied.
- **Frontend:** run `npm test`, `npm run lint`, and `npm run build`, plus the package-specific tests below. Keep both entry paths buildable once the opt-in shell exists. Until pre-existing lint debt is removed, report the baseline separately, require touched/new code to pass, and allow no additional failures. Clear unrelated lint debt in its own small PRs, not inside feature changes.
- **Backend/harness:** establish working dependencies first, then run relevant pytest cases, the non-provider regression suite, and Ruff for changed Python. Backend-linked browser checks use scripted agents, an isolated DB, and dedicated ports. A missing dependency is a blocked check, never a pass.
- **Browser scope:** run the relevant §11 scenarios on every package that changes their behavior. Full matrix/browser/performance sign-off is required before cutover, not before a small contracts-only PR. Do not rerun paid provider calls as routine verification.

### 10.3 Package queue

Dependencies below are package IDs, not instructions to bundle their changes. The sequence is a default; independent work may branch from the smallest sufficient base. Every row inherits §10.2 and must open as its own PR on completion, except local-only **1A** in this delivery.

| Package / scope | Prerequisite | Runnable result and additional verification |
| --- | --- | --- |
| **1A — audit and rebuild brief**: this document only; no source, config, lockfile, or asset changes | None | Markdown/scope/diff QA; one local conventional commit; no push or PR creation in this delivery |
| **2A — wire contracts and replay fixtures**: nullable DTOs, decoders, real event-order fixtures; no new UI | 1A | Executable contract tests cover null/unknown/malformed data, hidden cards, settlement order and opaque model IDs; legacy remains unchanged |
| **2B — HTTP boundary**: typed endpoint adapters, field/server/network errors, cancellation, credential encoding; no provider screens | 2A | Request/response fixtures verify URLs, viewer query, headers, 422/non-JSON parsing and stale-request aborts without real credentials |
| **2C — opt-in shell and primitives**: whole-app flag, router, tokens, buttons/fields/dialog, isolated scenario route; no game behavior or final artwork | 2A | Legacy and opt-in builds/previews load separately; keyboard/dialog/focus tests; no live socket from fixture routes; direct route refresh works |
| **2D — authoritative state reducer**: snapshot ownership, command/effect domains, selectors and history upserts; no live transport wiring | 2A | Replay tests prove no double payout/history, no timer-driven round erasure, stale-generation isolation and confirmed card visibility |
| **2E — isolated backend browser harness**: scripted agents, temporary DB, explicit ports and portable launcher; no business-logic fixes | 2A | Real create/connect/start smoke passes without provider calls; clean startup/teardown; pytest baseline and dependency limitations recorded. [Harness commands, coverage and B01 reproduction](WEB_GAME_HARNESS.md) |
| **3A — WebSocket session controller**: connection ownership, synchronized state, bounded reconnect and pending commands, connected to the opt-in scenario shell | 2B, 2C, 2D | StrictMode/stale callback/intentional close/uncertain-send tests; fixture shows connect, sync, offline and terminal error; no automatic spending resend |
| **3B — create and start a table**: minimal name/seat/model setup using registered models, default stakes, 2–6-seat read-only table and explicit start | 3A, 2E | Real create/start smoke plus 1–5-opponent fixtures; exactly one create/start per intent; waiting/dealt states and unavailable-model path work |
| **3C — ordinary betting actions**: peek, call, fixed raise, fold confirmation, stable dock and action costs; compare deferred explicitly | 3B | A05/A06 and fold part of A07; blind/seen costs, off-turn peek pending, legal-action guards and server rejection; reachable live actions |
| **3D — compare interaction and privacy**: seat/list target selection, fee confirmation, participant-only reveals | 3C | Remaining A07/A08; equal-hand initiator loss, spectator redaction, invalidated targets and continuing play after comparison |
| **3E — settlement and next hand**: persistent result tray, net deltas, manual next hand, bust/watch and natural finish; no full results page | 3D, 2E | A09/A10 with actual event sequence and scripted backend; one payout/history record, dealer rotation and next-hand start. Turn-limit completion also requires B01 fix |
| **3F — reload and recovery UX**: session identity, viewer-scoped restore, uncertain commands, missing-session and same-game-tab notice | 3E | A14/A15 across waiting/betting/settlement; no replayed wagers or demo injection; blocked AI-loop cases tracked separately as B03 |
| **4A — complete setup and rules**: presets, integer validation, custom-name preservation, draft return path and rules reference | 3B | S01–S13 applicable setup assertions and A04; all preset/range/seat boundaries, changed models and configuration detours |
| **4B — provider credentials/configuration**: key-store compatibility, save/verify/remove and host/version fields for all four key providers; no catalog CRUD | 2B, 2C, 4A | A02 credential subset; saved/verified distinction, storage failure, environment fallback and active-game removal wording; masked values only |
| **4C — generic model catalog management**: search/refresh/add/remove for OpenRouter, SiliconFlow, Azure and Zhipu | 4B | A01/A02 catalog subset; provider-parameterized fixtures, opaque IDs, empty/error/cache behavior, setup refresh and active-model deletion guard |
| **4D — Copilot device flow**: connect/poll/copy/expiry/retry/disconnect, model refresh | 4C | A03; pending/slow_down/denied/token states and unmount cancellation; no real OAuth required in CI |
| **4E — AI settings**: modes/token/timeout/retry/temperature UI, truthful help text, serialized saves | 2B, 2C | M10–M13; server-returned settings, out-of-order writes, null/token overrides and retry-zero explanation; no changed backend semantics |
| **5A — live conversation and activity**: chat send/echo/draft, public categories, action history, unread/scroll behavior | 3E | A12 live subset; IME, 200-character limit, offline draft, delayed echo and no auto-resend; no private thought content |
| **5B — restored conversation archives**: whole/per-hand REST readers and source-tagged archive/live segments | 5A, 2B | A12 recovery subset; differing IDs/times, repeated text, late events, hand selection and stale requests; no false exact-dedup claim |
| **5C — decision journal**: completed-hand/AI selection, structured decision timeline, sparse/null/error states | 3E, 2B, 2C | A13 decision subset; selection races, current-hand exclusion, missing confidence and keyboard expansion |
| **5D — narrative reader**: timeline/narrative switching and bounded not-yet-available refresh | 5C | A13 narrative subset; 404/empty/failure, bounded polling and cancellation when closing/switching hands |
| **5E — standings and result receipts**: final vs interim route, local redacted receipt, reload, play-again draft and journal access | 3F, 4A, 5C | A10/A15 results subset; game-ID isolation, correct starting-chip deltas, missing receipt and no silent new-game creation |
| **5F — leave and explicit end**: leave/current-results distinctions, end-at-boundary and end-after-hand intent | 5E | A11; `/end` exactly once, receipt retained before memory removal, uncertain response diagnosis, no auto-fold/open-pot invention; any required B02 fix is separate |
| **5G — optional review/summary readers**: render supplied historical reports and honest unavailable states; no generator activation | 5D, 5E | J09/J10/J14 and A13 report subset; nested stats/nulls/404, no fake generation/review activity, scoped cleanup |
| **6A — responsive table and panels**: complete seat layouts, compact dock/sheets, safe areas and keyboard/zoom behavior | 3F, 5A, 5C | A18 for all seat counts and specified viewports; six readable identities, accessible controls and no obscured actions |
| **6B — table materials and typography**: felt/rail/marker, portrait crops, cards and licensed fonts; no surrounding-screen redesign | 6A | Desktop/mobile table screenshots; contrast and asset-failure checks; image/font budgets |
| **6C — surrounding-screen visual design**: apply the established type/material system to home, setup/settings, journal and results; no behavior changes | 6B, Phase 4 packages, 5E, 5G | Screen/state screenshots at desktop/mobile widths, long text/empty/error states, contrast and overflow checks; split further by screen family if needed |
| **6D — bounded motion**: deal/flip/chip/compare/payout effects and reduced-motion behavior | 6B | A19 motion subset; burst/reconnect/route cancellation, no logical state changes from callbacks, recorded frame behavior |
| **6E — optional audio**: licensed small cues, default-off preference and playback lifecycle | 6D | A19 audio subset; mute/autoplay denial/hidden tab/reconnect/concurrency checks. May be omitted with an explicit silent-release decision |
| **7A — integration and lifecycle regressions**: extend real-transport coverage to faults, long sessions and all implemented flows | 2E, 3F, Phase 4/5 packages | A01–A16/A20 integration evidence, one socket and bounded listeners; report provider/server limitations. Each discovered product fix gets a separate focused PR |
| **7B — accessibility corrections and audit**: complete keyboard/screen-reader/forced-colors checks and focused corrections | 6C, 6D, 5F, 5G | A17/A18, hidden-card accessibility assertions, contrast and focus evidence; split unrelated component fixes rather than batch a broad refactor |
| **7C — performance tuning**: measured loading/render/asset bottlenecks only; no visual redesign | 6C, 6D, 7A | §8.4 budgets and A20 with recorded profiles, lazy routes and bounded histories; split independently fixable bottlenecks into their own PRs |
| **7D — automated quality gates**: wire existing verified frontend/backend/browser checks into CI with deterministic isolation | 7A–7C, lint debt resolved separately | CI runs lint/tests/build and backend/scripted-browser checks with no secrets; clean-checkout reproduction; no feature fixes hidden in workflow changes |
| **8A — default cutover**: select the new app by default, retain temporary rollback entry; no bulk deletion | Phase 7 complete; §3 obligations and A01–A20 verified; optional audio decision recorded | Fresh install/dev/build/production preview, SPA deep links and complete game; evidence references preceding PRs; default switch remains small and reversible |
| **8B — legacy code removal**: remove old entry/components/stores, obsolete tests and flag only after cutover is verified | 8A | Import/typecheck audit and regression/build checks; explicit fixture routes remain; split removals by independently removable module if needed |
| **8C — unused asset removal**: delete only assets confirmed unused after legacy removal | 8B | Reference audit plus production build and route screenshots confirm no missing images/fonts; preserve historical documentation images |
| **8D — final operating documentation**: reconcile README/API/setup/deploy guidance and parity evidence with the completed app | 8C | Document/diff QA, verify paths/commands and describe known limitations; no deployment |

### 10.4 Separate fixes and milestone gates

Backend defects are **separate PRs**, never extra scope inside a frontend package. For B01, reproduce natural turn progression, fix only the counter semantics, and verify changing active-player counts, raises/peeks, forced showdown, and the existing engine/API suite plus Ruff. B01 must be resolved before claiming turn-limit parity at the Phase 3 integration gate. For B02/B03, first reproduce the failing end/reconnect scenario in the harness, then make one lifecycle/connection-ownership fix per PR with that regression and existing transport tests. B06–B09 enter the queue only if they block the promised behavior and satisfy §12; no opportunistic backend rewrite.

If baseline lint, test infrastructure, or dependency configuration needs repository changes, open focused prerequisite PRs with their own verification; do not use the first document PR to repair the environment. Local dependency installation alone is not a source-change PR. A package with a required blocked check remains incomplete; finish independent verified packages on separate branches without misreporting the blocked one.

Milestone gates remain cumulative: Phase 2 establishes fixtures and both runnable entries; Phase 3 proves a full hand/recovery with compatible rules; Phase 4 closes setup/provider obligations; Phase 5 closes conversation/journal/results; Phase 6 verifies responsive presentation; Phase 7 records the full acceptance matrix; Phase 8 switches and removes legacy. They do not delay opening any completed package PR. No umbrella PR containing the entire stack is required.

All commands/services stay in this isolated worktree, on the appropriate package branch, with dedicated ports and a temporary test DB. Build accessible controls and mobile structure before final art. At a failed checkpoint retain the working default, report the failure and repair only that package; never delete the old app to force progress.

## 11. Automated tests and browser acceptance

### 11.1 Test layers

| Layer | Required coverage |
| --- | --- |
| Existing regression suite | Preserve meaningful API/cost/setup/store/action tests; rewrite assertions that codify known bugs rather than copying them (notably settlement deltas). Keep backend rule/evaluator/AI/chat/model/persistence tests |
| Pure domain/reducer tests | Full start/action/settlement sequences; snapshot before and after round event; duplicate snapshot/result; next-hand timer race; own seen/blind restore; stale event generation; null fields; unknown events; 1–5 opponents; opaque IDs; final receipt keyed by game |
| Transport tests | HTTP detail string/array/non-JSON/network/abort; correct header/query encoding; WS close/handshake failure, backoff/jitter cap, intentional-close, stale socket callbacks, StrictMode double mount, connection drop during pending command, no auto-resend |
| Component tests | Accessible setup validation/draft preservation, model search/add/remove/readiness, OAuth slow_down/expiry/cancel, setting save order, action costs/availability/pending, compare target and fold confirmation, journal race/404/empty/null rendering, result final/interim distinction |
| Deterministic browser tests | Playwright REST interception and `routeWebSocket` scenarios with the actual wire format, 2–6 seats, complete hand, forced-showdown payload, bust, reconnect, delayed/malformed/error events, provider variants, journal/results |
| Backend-linked browser tests | Dedicated test server and isolated SQLite with scripted/mock AI decisions; real create/WS/start/action/settlement/read paths; no paid provider calls. Catch protocol drift that interception cannot detect |
| Optional provider smoke | Explicit opt-in real provider game, using test credentials and bounded calls, separate from CI; never store keys in traces or screenshots |
| Accessibility/performance | Automated axe if added, keyboard checks, accessibility-tree hidden-card assertions, visual screenshots, bundle reports, CPU/network profile, long-session memory/listener checks |

Do not measure coverage by an arbitrary test count. Every critical state transition, action rule boundary, and recovery path needs meaningful assertions. Existing tests largely exercise isolated events; they do not cover the real `game_state → round_ended → game_state` sequence or refresh restoration.

Run from the corresponding directory:

```sh
# frontend/
npm ci
npm test
npm run lint
npm run build
npm run test:e2e

# backend/ (once dependencies are available)
uv sync --locked --extra dev --python 3.11
uv run pytest -m 'not integration'
uv run ruff check .
```

Configure Playwright ports/commands per isolated test run; do not rely on the current `source` launcher or an unrelated already-running server. Add Chromium/Firefox/WebKit projects and a mobile touch profile. Headless WebKit supplements, but does not replace, a manual Safari/iOS sanity check.

### 11.2 Browser acceptance matrix

| ID | Scenario | Observable pass criteria |
| --- | --- | --- |
| A01 | Fresh user, no models | Clear path from new game to configuration; empty catalog explained; return retains nickname/seats/stakes; no stacked error dialogs |
| A02 | All provider configurations | Save/verify/remove key, configure endpoint/version, search/add/remove model; each state reports its own outcome; saved vs verified distinguishable; no full key in DOM/log/trace |
| A03 | Copilot lifecycle | Code/copy/link, pending, slow_down, success, denied/expired/retry, disconnect; polling stops when closed; setup model options update |
| A04 | Setup boundaries | 1 and 5 AI plus every intermediate count; repeated same model and long names; all presets and min/max values; duplicate create click produces one game |
| A05 | Blind → seen | Cards remain hidden until confirmed peek; peek costs zero and retains turn; off-turn peek displays pending appropriately; seen cost doubles; reload preserves confirmed status |
| A06 | Calls/raises/insufficient chips/cap | Payment labels match engine B/2B/4B; raise has no amount picker; illegal spending is unavailable; rejection restores usable state |
| A07 | Fold/compare | Fold requires confirmation; compare targets exclude self/inactive; target and cost clear; seat and list agree; losing initiator on tie represented correctly |
| A08 | Privacy | AI-vs-AI compare spectator sees no private cards; participating human sees delivered cards; forced showdown only reveals supplied hands; hidden ranks absent from accessibility tree and normal DOM |
| A09 | Settlement sequencing | Replayed actual sequence changes balances exactly to server values once, one history entry, no flicker/double payout; result remains visible; next hand possible after reload at settlement |
| A10 | Elimination/game end | Human out can watch; AI continue; natural finish shows correct final ranking/deltas; partial/current standings never labelled final |
| A11 | End/leave/results | Leave explains continued backend play; end-at-boundary uses `/end` once and preserves receipt; interrupted request offers diagnosis; result reload succeeds locally or reports unavailable data honestly |
| A12 | Chat | CJK IME Enter does not send unfinished composition; empty/200-char boundary, delayed echo/offline draft, bystander speech, unread/scroll retention; archive/live sources handled without naive repeated-text deletion |
| A13 | Journal | AI/hand switch while old request delayed cannot show wrong content; detailed/fast/sparse data, 404 narrative, retry, null confidence, review records, absent summary all render correctly |
| A14 | Reconnect | Drop during AI/human/pending command/settlement; latest state restored, no repeated wager or start, no old animation; terminal missing game/player gives home/retry guidance |
| A15 | Browser refresh/back/URL | Waiting/betting/settlement/result reload and browser back/forward; wrong ID and no identity; no demo injection, cross-game state reuse, or endless loading |
| A16 | Error recovery | Non-JSON 502, 422 field array, malformed WS, invalid action, provider timeout fallback, Copilot error, storage unavailable; clear next step, no repeated modal storm |
| A17 | Keyboard/screen reader | Complete setup/hand/compare/journal path without mouse; dialog trap/Escape/return; turn and outcome announced once; no leaking hidden cards; hotkeys suppressed in typing/IME |
| A18 | Responsive | 320×568, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080, 844×390; six seats and open panels tested; safe areas/keyboard/200% zoom do not hide actions or induce page horizontal scroll |
| A19 | Reduced motion/audio/assets | Whole hand completes with reduced motion, sound off, autoplay denied, image/font failures; no effect completion dependency; reconnect does not play stale cues |
| A20 | Stability/performance | Long fixture session and 20 navigation cycles show one intended socket, bounded lists/effects/listeners; budgets in §8.4 measured; no uncaught console errors |

Evidence per implementation checkpoint: test command/result, named fixtures, viewport/browser screenshots, accessibility notes, and unresolved defect IDs. A single attractive desktop screenshot is not a parity sign-off.

## 12. Risk register and backend-fix boundary

| ID / priority | Evidence and impact | Treatment / owner / gate |
| --- | --- | --- |
| B01 critical | Impossible turn-count increment in `game_manager.advance_turn`; hand limit never reached naturally | Engine owner, separate minimal fix and natural-progression tests; Phase 3 integration blocker for turn-limit parity. No Phase 1 edit |
| F01 high | `useGame` applies net deltas after settled snapshot, appends duplicate history, later clears current round with a timer | Frontend reducer replacement; replay exact sequence; Phases 2–3 |
| F02 high | Identity only in memory; fresh table URL hangs, dev route injects fake game; reconnect does not reconstruct visibility | Persist identity, viewer-scoped recovery, explicit invalid state, isolated fixture route; Phase 3 |
| B02 high | `/end` removes memory without settling/cancelling AI; current button never calls it | Accurate leave/interim/end-at-boundary UX now planned; separately evaluate lifecycle cancellation if immediate end becomes necessary; Phase 5 |
| B03 high | WS receive loop awaits AI processing; reconnect only sends snapshot; duplicate player registry/disconnect race; no action IDs | One client controller/no auto-retry; reproducible backend-linked tests; narrow loop/connection-identity fix only if required for promised recovery; Phases 3/7 |
| B04 high | Unscoped game GET and REST action compare response expose broader hands; journal/chat APIs have no viewer/round privacy enforcement | New client uses viewer-scoped reads and completed-hand journal; separate server privacy hardening before any multi-user exposure. Do not claim client gating is security |
| B05 medium | WS lifecycle is not a fully persisted recoverable game; restart loses registry/agents/config | Honest expired-session UX; local final receipt; backend restoration explicitly out of scope |
| C01 medium | Summaries disabled and experience scheduling stubbed, despite README claims | Optional-data rendering/empty states; update claims at cutover; no backend feature resurrection |
| B06 medium | Live/archive chat IDs/times differ, events omit round, async narratives/chat can cross hand boundaries | Source-aware histories, no exact replay claim; consider minimal stable-ID/round metadata addition only if required; Phase 5 |
| B07 medium | Retry zero makes no calls; token null/default and mode overrides differ from UI; Copilot timeout fixed independently | Accurate settings labels now planned; isolate any future settings semantic fix with contract tests; Phase 4 |
| B08 medium | Model registry/config globally mutable and reset on restart; catalog cache not key/host-scoped; removing a model can break active agents | Prevent dangerous UI edits during active table, explain readiness/restart, test cache/config changes; narrow cache fix if reproduced; Phases 4/7 |
| B09 medium | Removing stored keys does not revoke copied agent keys; WS key query may appear in infrastructure logs | Accurate removal wording; redact own diagnostics, no real keys in tests; server key-clearing/transport changes separate from visual migration |
| F03 high | Fixed seat coordinates and 288px/256px floating panels overlap on mobile; view-height clipping | Responsive grid and stable dock before final art; six-seat acceptance; Phase 6 |
| F04 high | Clickable div cards/portraits, missing dialog roles/focus behavior, tiny labels, no reduced-motion treatment | Shared accessible primitives and semantic card visibility from Phase 2; audited in 6/7 |
| F05 medium | Whole-store subscriptions, eager route/demo imports, ~1.53MB result art, infinite effects | Selectors, lazy routes, asset budgets, bounded effects; Phases 2/6/8 |
| T01 high | Tests pass isolated buggy assumptions; no E2E specs; backend baseline blocked by dependency downloads | Restore dependency availability, meaningful sequence tests + real transport fixtures, backend baseline recorded before fixes; Phases 2/7 |
| T02 medium | Lint already failing; CI omits lint/backend/browser; launcher/deploy can target other processes/checkouts | Record baseline, fix touched code then eliminate debt before cutover; isolated ports/DB; Phases 2/8 |

Backend-fix discipline for a later phase: provide a reproducible failure, state the promised existing behavior it blocks, add a regression, make the smallest compatible change, run engine/API/WS tests and Ruff, and record any unavoidable protocol change explicitly. Rule redesign, broad persistence work, provider rewrites, and re-enabling disabled learning/report generation do not qualify as incidental frontend fixes.

## 13. Phase 1 completion and next checkpoint

This brief captures the implemented feature surface, wire contracts, known discrepancies, chosen architecture and art direction, accessibility/performance strategy, acceptance matrix, and runnable migration sequence. Current production frontend build and 192 tests pass; existing lint debt and unavailable backend test baseline are recorded rather than hidden.

The overall rebuild is authorized. This delivery completes **1A** only: QA and a local conventional commit of this document, with no push or PR creation. The next implementation package is **2A — wire contracts and replay fixtures**, on its own branch/PR; it must not be added to the document branch. Open each later package PR immediately after its verification passes, stacking or rebasing as described in §10. Implementation and final artwork are not part of this first PR.
