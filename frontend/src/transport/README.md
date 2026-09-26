# Typed HTTP boundary (package 2B)

Create `createHttpClient({ fetch?, getProviderKeys? })`, then pass it to the focused
`createGameApi`, `createModelApi`, `createProviderApi`, `createSettingsApi`,
`createJournalApi`, and `createCopilotApi` factories. Nothing here is instantiated
or imported by the legacy runtime. The only shared additions are wire DTOs and
decoders for the remaining administration responses.

- Requests use same-origin `/api`, JSON bodies, and the backend's JSON
  `X-Provider-Keys` header. Unicode is JSON-escaped for browser header support.
  Credentials come from the injected getter on each request; this layer neither
  persists nor logs them. Redirects are rejected and writes are never retried.
- `getState(gameId, viewerId, options?)` requires a nonempty viewer. Path IDs are
  encoded once and registry IDs are never reconstructed. Dot-only IDs are rejected
  because URL parsers normalize them. Encoding cannot add backend route support:
  game/agent routes still use ordinary segments; model deletion has a path parameter.
- Successful responses pass package 2A decoders (plus administration extensions).
  Nulls, response envelopes, empty arrays, and nested summary statistics remain
  intact. Missing reports reject with HTTP 404 instead of becoming empty reports.
- `TransportError` exposes `kind`, `code`, `status`, `detail`, and `issues`.
  Pydantic issues retain their full `loc`, `type`, and `message`; raw input/context
  and network causes are omitted. Supplied keys are redacted from error strings.
  Non-JSON/unrecognized HTTP errors use `HTTP <status>`; malformed successes have
  kind `invalid-response`. Cancellation has kind `aborted` and is not a network error.
- Every endpoint accepts `{ signal }`. Cancellation covers fetch and body reading,
  including transports that ignore the signal. It cannot undo a server-side write.
  Settings write serialization and OAuth polling controllers belong to later packages.

For a resource whose selection can change, create one `createRequestScope()` and
call `begin()` for each load. Pass the returned lease's `signal` to the endpoint.
Apply results, errors, and loading cleanup through `lease.commit(() => { ... })`.
The callback must be synchronous: the guard is checked at application time, even
if a response resolved before selection changed. `begin()` aborts/invalidates the
previous lease; `cancel()` does the same on navigation or disposal. Separate scopes
keep independent resources from cancelling one another. This primitive contains
no UI, storage, cache, reducer, or resource ownership policy.

Verification uses synthetic package 2A fixtures and fetch mocks only. Tests cover
each method/path/body, provider URL aliases, opaque IDs, viewer queries, nullable
responses, invalid successes, error parsing, header encoding, aborts, and delayed
journal successes/failures after selection changes. No provider calls are made.
