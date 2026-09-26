# Package 2E: isolated backend/browser harness

This harness exercises the real FastAPI routes, WebSocket scheduler, engine and
SQLite persistence without loading product UI. It is test infrastructure only:
no deployment, provider credentials, production test flags, or game-rule changes.

## Setup and commands

Use Python 3.11+ and Node 22. Install only into this checkout:

```sh
cd backend
UV_CACHE_DIR="$PWD/.uv-cache" uv sync --locked --extra dev --python 3.11

# Explicit offline runner: clean environment, temporary SQLite, provider SDK blocked.
.venv/bin/python -m tests.harness.pytest_runner tests/test_browser_harness.py -q
.venv/bin/python -m tests.harness.pytest_runner -m 'not integration' -q
.venv/bin/python -m ruff check tests/harness tests/test_browser_harness.py

cd ../frontend
npm ci --no-audit --no-fund --cache .npm-cache
# Only needed if a matching Chromium is not already installed:
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npm run test:e2e
# Omit PLAYWRIGHT_BROWSERS_PATH when using an already-installed matching browser.
npm test
npm run lint
npm run build
```

On Windows, use `backend\.venv\Scripts\python.exe` and the shell's environment
assignment syntax. The launchers themselves use argument arrays and stdin EOF;
they do not depend on `source`, a POSIX shell, `lsof`, or process-group signals.
Windows/Firefox/WebKit execution is not claimed by the macOS/Chromium evidence.

The offline pytest runner accepts normal pytest selectors and paths relative to
`backend/`, changes into a fresh temporary directory before importing the app,
and always skips tests marked `integration`, even if explicitly selected. Its
LiteLLM stand-in **raises on every unmocked completion**. Existing agent unit
tests can still mock that boundary and verify SDK arguments. This runner does
not validate the real provider SDK or paid-provider integration. With a healthy
installation, ordinary `.venv/bin/python -m pytest -m 'not integration'` remains
available; the harness does not change the repository's default pytest setup.

## Ownership and deterministic inputs

- Each browser test and backend fixture owns one child server, a fresh SQLite
  file, process-local game/model/agent registries, and temporary logs. No shared
  database or live server is reused. API creation and WS thought/narrative writes
  use the same actual SQLAlchemy engine; no dependency override masks that path.
- The server explicitly binds `127.0.0.1` with port `0`, letting the OS allocate
  and reserve a free port. It passes the **same open socket** to uvicorn and
  publishes the actual URL only after application startup. There is no
  find-free-port/close/rebind race. `E2E_BACKEND_PORT` can pin a known free port;
  it forces one Playwright worker, and an occupied port fails without touching
  its owner. `E2E_PYTHON` can select another interpreter in this environment.
- Browser tests open the test-only `/__harness__/` empty document and use native
  `fetch` and `WebSocket`. There is no Vite server, HTTP/WS interception, product
  page, or UI transport wiring. Package 2A decoders validate actual responses.
- Before importing the app, the launcher drops inherited credentials and
  configuration, changes into its temporary directory (avoiding checkout
  `.env` files), sets an absolute temporary SQLite URL, and substitutes a
  rejecting provider SDK boundary. A Python socket audit hook rejects external
  TCP connections and DNS; loopback connections remain available to tests.
  `/__harness__/diagnostics` verifies no attempted provider/external calls.
- The one registered test model, `harness-call-then-fold`, calls on its first
  action in each hand and folds on subsequent actions. It writes deterministic
  thoughts; a fixed narrative substitutes only the model response, retaining
  the actual reporter and database write/read paths. Bystander generation is
  silent. The existing `Deck` is seeded with `20260926` for every hand. Game IDs
  and timestamps remain real; assertions compare game facts, not those values.
- `start_round`, action legality, costs, turn progression and settlement run
  unchanged. All injection lives under `backend/tests/harness`; the production
  `app.main:app` has no harness routes or switches.
- Fixtures close only their own child's stdin and wait for normal lifespan
  shutdown, database disposal and temporary-directory deletion. A bounded
  fallback kills only that child PID. Startup failures and test exceptions also
  clean up. Playwright attaches bounded backend logs, and retains traces only
  on failure. No launcher kills ports 8000/5173 or invokes `start.sh`.

## Covered sequences

Backend tests verify creation rows in SQLite, viewer-scoped reads, native socket
connect, explicit hand start, scripted AI call, zero-cost human peek, a legal
20-chip seen-player call, AI fold, and settlement. They assert the real
`game_state → round_ended → game_state` order, identical settled snapshots,
one history entry, a 50-chip pot and final balances `1020/980`. Reconnect restores
that settled state; explicit next-hand start advances the hand and dealer.
Thought and narrative reads succeed; the dormant full-game summary returns 404.

Browser tests repeat the live flow with two and six seats on desktop and mobile
Chromium. They assert available actions, hidden opponent hands, no AI fallback,
costs, chip conservation and the same settlement sequence. The backend delivers
the human's cards before peek; this harness does not claim server-side blind-card
secrecy. It checks the existing viewer-scoped opponent redaction.

Infrastructure tests run two servers concurrently to prove database/registry and
port isolation, confirm shutdown removes temporary state and listeners, reject
an occupied port without harming its owner, and check credential removal plus
provider/network rejection in a separate process.

## Existing backend blocker: B01

`test_b01_call_only_hand_reaches_turn_limit` is a strict expected failure. Two
players make eight legal calls with `max_turns=3` and ample chips. The hand is
still `betting`, `turn_count=0`, rather than settling by forced showdown.
`advance_turn()` compares `action_count % active_count >= active_count`, which
cannot be true for a positive active-player count.

Run the original failure explicitly:

```sh
cd backend
.venv/bin/python -m tests.harness.pytest_runner \
  tests/test_browser_harness.py::test_b01_call_only_hand_reaches_turn_limit \
  --runxfail -q
```

This command must fail until B01 is fixed separately. The normal suite reports
XFAIL, and strict XPASS will require removing the marker once the defect is
fixed. The passing integration scenario settles by folding; it does not alter
turn counts or force settlement. Natural turn-limit completion, reconnect while
AI processing is blocked (B03), server restart recovery (B05), and broader product
acceptance are not established by this package.

## Verification on 2026-09-26

Evidence was collected on macOS with Python 3.11.15 and Node 22.23.0. Dependency
and check results are recorded below; all restored files/caches remain local to
this worktree, and lockfiles are unchanged.

Locked `uv sync` could not download wheels from `files.pythonhosted.org`
(`Socket is not connected`). Dependency files were copied into this worktree's
virtual environment from an existing Python 3.11 environment, excluding `.pth`
files; installed versions matched `uv.lock`. The copied LiteLLM package was
incomplete. A replacement 1.82.1 wheel downloaded from the Tsinghua PyPI mirror
matched the lock's SHA-256
`a9ec3fe42eccb1611883caaf8b1bf33c9f4e12163f94c7d1004095b14c379eb2`, but macOS denied
access to installed module files. No OS security settings were changed.
The first ordinary full pytest run reported 753 passed, 1 expected failure,
15 deselected, 33 errors and 1 failure; all errors/failure involved the missing
LiteLLM completion boundary. The explicit offline runner avoids importing that
SDK and is the reproducible no-provider test command above.

| Command (from the corresponding directory) | Result |
| --- | --- |
| `python -m tests.harness.pytest_runner tests/test_browser_harness.py -q` | **4 passed, 1 XFAIL**; live lifecycle, parallel isolation, port ownership and safety guards |
| `python -m tests.harness.pytest_runner -m 'not integration' -q` | **788 passed, 354 subtests passed, 15 deselected, 1 XFAIL** in 43.69s |
| B01 selector with `--runxfail -q` (above) | Expected exit 1: `After 8 legal calls: phase=betting, turn_count=0` |
| `python -m ruff check tests/harness tests/test_browser_harness.py` | Passed |
| `npm run test:e2e` | **4 passed**; 2/6 seats × desktop/mobile Chromium, 2 parallel workers |
| `npm test` | **14 files, 268 tests passed** |
| `npx eslint e2e playwright.config.ts` | Passed |
| `npm run build` | Passed, including TypeScript checking of the new E2E files; existing >500 kB bundle warning |
| `npm run lint` | **32 existing errors, 1 warning**, all in untouched legacy frontend files |
| `git diff --check` | Passed |

Use `.venv/bin/python` (or the Windows equivalent) for `python` in this table.
The full backend suite also reports an existing SQLAlchemy connection-cleanup
warning from `test_websocket.py`; the new process-ownership tests pass. Browser
traces/logs are under ignored `frontend/test-results`/`playwright-report`, and
local command logs are in ignored worktree dependency-cache directories. No
provider call, real credential, product UI change, deployment, push or PR was
used for this verification.
