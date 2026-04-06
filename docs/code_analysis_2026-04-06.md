# Yaeger codebase analysis (April 6, 2026)

This is a high-level technical review of the firmware + web clients, with prioritized, up-to-date improvement proposals.

## Scope reviewed

- Firmware entrypoint and runtime loop (`src/main.cpp`)
- WebSocket command/control path (`src/CommandLoop.cpp`)
- REST API and Wi‑Fi credential flow (`src/api.cpp`, `src/wifi_setup.cpp`)
- Frontend app state, transport, and build setup (`miniweb`, `webserver`)
- Dependency freshness and security posture from package manager checks

## Current strengths

- Clear separation between firmware concerns: sensors, fan/heater control, API, and Wi‑Fi modules.
- Safety fallback exists when WebSocket clients disconnect (`updateConnectionSafety`) with cooldown fan behavior.
- OTA update path is already integrated with ElegantOTA and static content serving from LittleFS.
- A newer `miniweb` app exists (TypeScript + Vite) in parallel to legacy Svelte/Rollup webserver.

## Key findings and prioritized improvements

## 1) **Critical security hardening (do first)**

### Implementation status (April 6, 2026 update)

- ~~Move `/api/wifi` to **POST + JSON body**; never pass passwords in URL query strings.~~ ✅ Implemented (`/api/wifi` now requires `POST` JSON).
- ~~Add request authentication for mutable endpoints (`/api/wifi`, control commands, OTA), at minimum:~~ 🔄 Partially implemented.
  - ~~per-device admin password or token stored in NVS,~~ ✅ Implemented for `/api/wifi` and OTA Basic Auth.
  - ~~CSRF-resistant flow for browser UI.~~ ✅ Implemented (`X-Yaeger-CSRF` header validated for mutable REST writes).
- ~~Protect OTA route with credentials and rate-limiting/backoff.~~ ✅ Credentials and exponential backoff implemented (OTA upload tooling retries transient failures).
- ~~Add secure defaults in AP mode:~~ 🔄 Partially implemented.
  - ~~WPA2/WPA3 AP passphrase (not open AP),~~ ✅ Implemented (password-protected AP).
  - ~~setup-mode timeout window.~~ ✅ Implemented (AP setup timeout + restart).

### Updated TODO list

- [x] Replace `/api/wifi` GET query credential flow with authenticated `POST` + JSON body.
- [x] Protect OTA with admin credentials.
- [x] Enable AP passphrase and setup timeout window.
- [x] Add auth gate for WebSocket mutable control commands.
- [x] Add CSRF-resistant browser flow for authenticated actions.
- [x] Add rate limiting / exponential backoff for OTA endpoint.

### Findings

- ~~Wi‑Fi credentials are accepted over **HTTP GET query params** at `/api/wifi` (`ssid` / `pass`).~~
- ~~API endpoints and OTA endpoint appear unauthenticated by default.~~
- Device exposes AP fallback mode and local admin surface; risk is reduced with auth, CSRF controls, and OTA retry/backoff protections.

### Recommendations (2026 best-practice)

1. ~~Move `/api/wifi` to **POST + JSON body**; never pass passwords in URL query strings.~~
2. ~~Add request authentication for mutable endpoints (`/api/wifi`, control commands, OTA), at minimum:~~
   - ~~per-device admin password or token stored in NVS,~~
   - ~~CSRF-resistant flow for browser UI.~~
3. ~~Protect OTA route with credentials and add rate-limiting/backoff.~~
4. Add secure defaults in AP mode:
   - ~~WPA2/WPA3 AP passphrase (not open AP),~~
   - ~~setup-mode timeout window.~~

## 2) **WebSocket robustness and heap stability (high priority)**

### Implementation status (April 6, 2026 update)

- ~~Validate parse result (`DeserializationError`) and reject malformed frames.~~ ✅ Implemented (malformed JSON and unsupported fragmented/non-text frames are rejected).
- ~~Enforce command schema validation (required fields, ranges).~~ ✅ Implemented (numeric schema checks for mutating commands and preference payloads).
- ~~Replace fixed-size `char[200]` with `measureJson` + dynamic/streamed response.~~ ✅ Implemented (`measureJson` + dynamically-sized `String` response buffer).
- ~~Add clamp logic for actuator values (e.g., fan/heater range validation) server-side regardless of client behavior.~~ ✅ Implemented (server-side clamping + logging for burner/fan/cooldown values).

### Updated TODO list

- [x] Reject malformed JSON payloads and unsupported WebSocket frame shapes.
- [x] Validate command schema for mutating and preference commands.
- [x] Remove fixed-size WebSocket response buffer usage.
- [x] Clamp actuator and cooldown values server-side to safe ranges.

### Findings

- `deserializeJson` return value is not checked before consuming fields.
- Incoming frame handling concatenates payload into `String` and uses small fixed JSON capacity assumptions.
- Outgoing buffer is fixed `char buffer[200]`, risking truncation if payload grows.

### Recommendations

1. ~~Validate parse result (`DeserializationError`) and reject malformed frames.~~
2. ~~Enforce command schema validation (required fields, ranges).~~
3. ~~Replace fixed-size `char[200]` with `measureJson` + dynamic/streamed response.~~
4. ~~Add clamp logic for actuator values (e.g., fan/heater range validation) server-side regardless of client behavior.~~

## 3) **Network resiliency and boot behavior (high priority)**

### Findings

- Wi‑Fi connect routine blocks in a loop up to ~10s with `delay(1000)` retries.
- Main loop includes regular delays and mixed timing responsibilities.

### Recommendations

1. Convert Wi‑Fi connect to non-blocking state machine (or bounded async retry steps).
2. Keep loop tick deterministic by moving periodic tasks to elapsed-time scheduling.
3. Add watchdog-friendly design: avoid long blocking sections in startup/connect paths.

## 4) **Frontend modernization path (high priority, medium effort)**

### Findings

- Repository contains **two web UIs** (`webserver` legacy Svelte 3 + Rollup, and `miniweb` TypeScript + Vite).
- Legacy webserver dependency tree is significantly behind and has known advisory exposure via old Svelte line.

### Recommendations

1. Make `miniweb` the single primary frontend and define deprecation timeline for `webserver`.
2. If legacy UI must remain, plan migration to modern Svelte/Vite stack.
3. Standardize package manager/lockfile strategy (npm vs yarn) to reduce CI drift.

## 5) **Dependency and supply-chain updates (high priority)**

### Findings from `npm outdated`

- `miniweb` has major updates pending (e.g., Vite 8.x, TypeScript 6.x, vite-plugin-pwa 1.x).
- `webserver` is heavily behind (Rollup 4.x, Svelte 5.x, SMUI 8.x available).
- root dependency `chartjs-plugin-trendline` also behind.

### Findings from `npm audit`

- `webserver` reports moderate vulnerabilities tied to old `svelte` line; major upgrade path available.

### Recommendations

1. Upgrade actively maintained UI (`miniweb`) first, one major at a time with CI snapshots.
2. Treat legacy `webserver` as frozen/deprecated or perform full migration sprint.
3. Add automated dependency checks (scheduled CI + Dependabot/Renovate).

## 6) **API design and transport hygiene (medium priority)**

### Findings

- Control and data are mixed in loosely-typed WebSocket payloads.
- REST info endpoint is useful but minimal; no health/version compatibility contract.

### Recommendations

1. Version the protocol (`apiVersion`) across REST + WebSocket.
2. Introduce structured command envelopes and explicit error responses.
3. Add heartbeat/ping and reconnect backoff in frontend WebSocket client.

## 7) **Build/test quality gates (medium priority)**

### Findings

- Frontend builds succeed, but there is no obvious unified CI matrix in repo root.
- Firmware static checks are configured in PlatformIO config but not validated in this environment (`pio` unavailable).

### Recommendations

1. Add CI pipeline matrix:
   - firmware static analysis/build,
   - miniweb build/lint/typecheck,
   - optional legacy webserver build until sunset.
2. Add pre-merge checks for formatting + basic unit tests for pure logic modules.
3. Add release artifact version stamping for firmware + frontend and compatibility check.

## Proposed implementation roadmap

### Phase 1 (1-2 weeks): security + reliability

- Migrate `/api/wifi` to authenticated POST.
- Add OTA auth + AP hardening defaults.
- Add WebSocket parse/validation/clamp guards.

### Phase 2 (1-2 weeks): frontend consolidation

- Define `miniweb` as primary.
- Freeze or retire `webserver`; remove dual-maintenance overhead.
- Upgrade `miniweb` core tooling with compatibility tests.

### Phase 3 (ongoing): CI and observability

- Introduce CI matrix and scheduled dependency scanning.
- Add structured logs + fault counters exposed via `/api/info` (or `/api/health`).
- Add smoke tests for profile run and actuator safety constraints.

## Commands run for this analysis

- `npm outdated --json` (repo root, `miniweb`, `webserver`)
- `npm run build` (`miniweb`, `webserver`)
- `npm audit --omit=dev --json` (`webserver`)
- `pio --version` (tool unavailable in environment)
