# Package 2C — opt-in shell and accessible primitives

Implemented on `feat/web-game-2c-shell`, stacked on `6fba636` (package 2A). This package is local-only: no push or PR. It does not change the backend or claim gameplay parity.

## Run and inspect

From `frontend/`:

```sh
npm ci --no-audit --no-fund
npm run dev -- --port 5192 --strictPort                         # legacy default
VITE_WEB_GAME_REBUILD=1 npm run dev -- --port 5193 --strictPort # new shell
```

The flag is an exact build-time choice: only `1` selects the rebuild; unset, empty, `0` and `true` select legacy. Restart/rebuild to change it. `main.tsx` mounts one selected lazy application. Legacy retains its original `App.tsx`, routes, components, stores and stylesheet. The new entry imports none of them. Production builds eliminate the unselected app tree and its CSS/assets.

The opt-in HTML removes the old remote font links and sets `zh-CN`. Legacy HTML processing leaves those links and the original language unchanged. The rebuild uses local system font fallbacks and CSS/SVG materials, without new dependencies or image/font downloads. Its Tailwind `room:` utilities and material rules are scoped to `.gf-app`; the body margin reset applies only when the new root is present.

| Route | Contents |
| --- | --- |
| `/` | Card-room introduction and six scene links; scenario factories are not loaded yet |
| `/scenarios` | Redirects to `/scenarios/waiting` |
| `/scenarios/waiting` | `createStartReplay().waiting` |
| `/scenarios/blind` | `createHandReplay().humanTurn`; own blind cards absent from DOM |
| `/scenarios/seen` | `createHandReplay().seen`; supplied own visible hand |
| `/scenarios/settlement` | `createHandReplay().settled`; balances 1,060 / 960 / 980 displayed directly |
| `/scenarios/six-seats` | `createStartReplay(5).humanTurn`; stacks 5,890 + current pot 110 = initial total 6,000; ante 10 shown separately |
| `/scenarios/compare-private` | `createCompareReplay('human').after`; opponent cards remain hidden |
| `/game/:id`, `/result/:id` | Honest unavailable state; no fixture injection, session restoration or connection |
| Unknown URLs/scenarios | Missing-page state with a route home |

Scenario mounts receive fresh package-2A snapshots. They do not run a reducer, replay events, dispatch actions, persist data, or import live stores/transports. Tabs and a temporary scene note exercise the primitives; refreshing or switching scenes resets the note. Only same-origin static document/JS/CSS/favicon requests are needed in production. Vite's own development HMR is tooling, not a game connection.

Visual-QA correction: the six-seat fixture already supplied a pot of 110; the original page only displayed the ante of 10 and omitted the pot. Presentation now reads `current_round.pot` directly, with no changes to package-2A fixture values or game rules. Waiting shows a zero pot. Settlement labels its historical pot “本局底池（已派发）”, since its stacks already include the payout. Regression tests verify conservation across every six-seat start snapshot and the actual rendered six-seat balances/pot, including after note interactions.

“添加便签” remains functional for a temporary local note. Its visible and accessible help now explicitly says that refresh or a scene switch clears it; “只读” applies to the chip snapshot. Save and edit update the visible note, Cancel and Escape preserve the saved version, and none of these actions changes chips or uses storage/transport. Unit and production-browser checks cover these behaviors.

## Components and design

- `src/app/`: build flag boundary, lazy router/pages, shell, loading/error recovery, route heading focus and title, scene catalog and pure snapshot presentation.
- `src/ui/`: Button (safe default type, disabled/busy semantics), Field (label/help/error association), native Dialog (safe initial focus, modal inertness, Tab containment, Escape, return and cleanup), horizontal Tabs (roving focus, arrows/Home/End, disabled items, labelled panels), Status (polite information/success; assertive blocking errors), decorative three-petal mark.
- `src/styles/web-game.css`: petrol felt `#214E59`, oxblood `#693344`, brass `#E5BD72`, ivory `#F8F5EC`, ink `#162630`, mist `#B9CDD1`. Serif Chinese display, system sans UI, tabular mono numerals. The three-card fan and flower dealer seal are a static material study, not final table artwork or a working dealer control.
- `e2e-shell/`, `playwright.shell.config.ts`: independent production acceptance harness; original backend-linked Playwright configuration remains untouched.

Controls have at least 44px targets, visible focus indicators, reduced-motion overrides and forced-color rules. One dialog surface becomes a bottom sheet on narrow screens. Native modal behavior is checked in a real browser; the jsdom shim models only open/close. Passive dialog cleanup restores focus after React's selection restoration.

Measured token contrast on their rendered solid surfaces: ivory/felt 8.38:1, mist/felt 5.53:1, brass/felt 5.16:1, ink/brass 8.75:1, ivory/oxblood 8.93:1. The control boundary token was brightened to `#7A9FA5` to exceed 3:1 against felt. These checks and keyboard tests are scoped evidence, not a complete accessibility audit.

## Verification — 2026-09-26

| Check | Result |
| --- | --- |
| Install | `npm ci --no-audit --no-fund`; no dependency or lockfile changes |
| TDD | Flag/primitive tests written before implementation; first run failed on missing modules; then implementation and interaction fixes |
| Full Vitest | `npm test`: **17 files / 299 tests pass** (baseline 14 / 268); QA regressions first reproduced the omitted pot and absent note help, then passed after the presentation fix |
| Touched lint | `npx eslint src/main.tsx src/app src/ui src/test/dialog.ts src/domain/__tests__/replays.test.ts vite.config.ts playwright.shell.config.ts e2e-shell`: pass |
| Full lint | `npm run lint`: **32 existing errors, 1 existing warning**; output matches the pre-change baseline; no additional failures |
| Legacy build | Browser harness reran `npm run build -- --outDir .shell-preview/legacy` with an empty flag: pass |
| Opt-in build | Browser harness reran `npm run build -- --outDir .shell-preview/rebuild` with `VITE_WEB_GAME_REBUILD=1`: pass |
| Production browser acceptance | `SHELL_BROWSER_CHANNEL=chrome npm run test:shell`: **13 tests pass** in headless Chrome 154 on macOS; fresh isolated builds/previews on 4292/4293, no backend |
| Routing/isolation | Exclusive output assets; home defers scenario chunk; direct links, reload, back/forward, missing pages and live-route placeholders; no app HTTP/WS/XHR/EventSource/beacon activity or uncaught errors |
| Keyboard | Tab/Shift+Tab, arrows/Home/End, skip link, safe modal focus, actual native background inertness, Escape, focus return and note reset |
| Responsive | Home, six seats and open dialog at 320×568, 390×844, 768×1024, 1024×768, 1440×900, 1920×1080, 844×390; no horizontal page overflow; dialog within viewport |
| Diff | Working and staged `git diff --check`: pass |

The browser harness rebuilds both entries and refuses to reuse an existing server. Override its ports with `SHELL_LEGACY_PORT` / `SHELL_REBUILD_PORT`. Use `npx playwright install chromium` then `npm run test:shell` for bundled Chromium, or select an installed channel as above. Screenshots and failure traces go to ignored `.shell-test-results/`; temporary builds go to ignored `.shell-preview/`.

The opt-in production home requires approximately **80 kB gzip JS** across entry/router/home/shared chunks and **4.1 kB gzip CSS**. Scenario code is about **5.8 kB gzip**, loaded on demand. No new raster assets or fonts are shipped. These are bundle measurements, not LCP/INP benchmarks.

Selected screenshots from the final production-preview run (CSS/SVG art authored in this package):

- [Desktop home, 1440px](screenshots/web-game-2c/home-desktop.png)
- [Mobile home, 390px](screenshots/web-game-2c/home-mobile.png)
- [Six seats, desktop](screenshots/web-game-2c/six-seats-desktop.png)
- [Six-seat pot and saved note](screenshots/web-game-2c/six-seats-note-saved.png)
- [Focused mobile sheet, 390px](screenshots/web-game-2c/sheet-mobile.png)

## Boundaries and remaining risks

No live game state, HTTP client, socket, provider functionality, backend changes, action controls, final table geometry, session persistence or result behavior is implemented here. The legacy default remains available; switching the default is a later package. Native dialog and CSS `:has` require current browsers. Safari/iOS, Firefox, physical-device keyboards, assistive technology and the full acceptance matrix remain later audit work. System font rendering will vary across platforms. Existing repository lint debt is unchanged. Backend tests were not run because this package changes no backend code or contracts.
