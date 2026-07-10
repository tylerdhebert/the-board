# Increment: provider settings — choose which CLI/model powers each role

## Why / shape
The engine has per-role backend selection (`SessionModels` = teacher/gate/
unlock, each `{ backend, model }`; backends registry: `codex` | `claude` in
`engine/src/providers.ts`) but the server hardcodes `DEFAULT_MODELS`. The user
churns CLI subscriptions — they want to pick the provider in-app. Small chalk
settings panel + persisted settings in the existing SQLite DB.

## SUBAGENT GROUND RULES (non-negotiable)
- Test fixtures use ISOLATED paths — never the real `tutor.db` / `logs/`
  (use `TUTOR_DB_PATH` if the polish-pack increment added it; otherwise a
  copied scratch DB).
- Never kill processes by name — only PIDs you started.
- A desktop stack may be running on 8787/5173/9223 — don't touch it; scratch
  ports only.

## Server

### 1. `server/src/sessionStore.ts`
- Add `settings` table: `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`.
- `getSetting(key): Promise<string | null>`, `setSetting(key, value): Promise<void>`.

### 2. NEW `server/src/settings.ts`
```ts
export type RoleModels = { backend: string; model: string }
export type AppSettings = {
  models: { teacher: RoleModels; gate: RoleModels; unlock: RoleModels; ingest: RoleModels }
}
```
- `loadSettings(): Promise<AppSettings>` — JSON from settings key `'models'`
  deep-merged over the defaults (defaults = current `DEFAULT_MODELS` +
  ingest `{ backend: 'codex', model: 'gpt-5.5' }`); malformed → defaults.
- `saveSettings(s: AppSettings)`: validate every backend is `'codex' |
  'claude'` and every model is a non-empty trimmed string — throw with a
  readable message otherwise; persist as JSON.

### 3. `server/src/server.ts` + `server/src/engine.ts`
- `GET /api/settings` → `{ models, backends: ['codex', 'claude'] }` (backends
  list so the web select isn't hardcoded).
- `PUT /api/settings` → validate via saveSettings; 400 with the message on
  validation failure; 204 on success.
- Session construction (BOTH newEntry and getOrRestore): use
  `(await loadSettings()).models` (teacher/gate/unlock parts) instead of
  `DEFAULT_MODELS`. Rehydrated sessions get CURRENT settings — provider calls
  are stateless per turn, that's desired.
- Ingest: `getOrIngestCard` in engine.ts currently hardcodes
  `new CodexCliClient()` + a `model = 'gpt-5.5'` default. Thread the ingest
  setting through: give it optional `client`/`model` params (or a single
  `{ backend, model }`), resolved by the caller in server.ts via
  `createClient(settings.models.ingest.backend)` — re-export `createClient`
  from engine/src/index.js through server/src/engine.ts if needed.

## Web

### 4. `web/src/api.ts`
`getSettings(): Promise<{ models: AppSettings['models']; backends: string[] }>`,
`putSettings(models): Promise<void>` (surface the 400 message as the thrown
Error's message). Mirror the types.

### 5. `web/src/App.tsx` + `index.css`
- Strip: a mono text button `providers` (class `stripbtn`) between the loader
  and `<WindowControls />`. Chalk-dim, hover chalk, lowercase, no box.
  (It's inside `.strip`, so the existing `.in-desktop .strip button` no-drag
  rule covers it — do NOT remove that.)
- Clicking opens a modal: full-viewport backdrop (`.settings-backdrop`,
  rgba slate, click closes, Escape closes) + a centered `.settings-panel
  chalk lit` (max-width ~520px, slate-raise background, padding ~24px):
  - eyebrow heading `providers`
  - four rows (teacher / gate / unlock / ingest): role label (mono, chalk-dim,
    fixed width) + backend `<select>` (options from the fetched `backends`) +
    model text `<input>` (mono, underline style like `.loader input`).
  - a chalk-faint note line: `applies to new turns · the chosen cli must be on your PATH`
  - actions right-aligned: `cancel` (text button) + `save` (amber block button
    like `.loader button`).
- Load current values when the panel opens (fresh `getSettings()` each open);
  `save` → putSettings → close on success, show the error message inline
  (coral, small) on 400.
- No other UI changes.

## What NOT to do
- No new deps. No changes to engine/src/session.ts, prompts, LSP, run flow.
- Don't build per-session model overrides — settings are global, applied at
  session construction/rehydration.
- Don't validate that the CLI exists on PATH (the turn will fail loudly if
  not — that's fine).

## Verify before you report back (headless, scratch DB + port)
1. tsc engine/server/web clean.
2. Scratch server: GET /api/settings → defaults with backends list. PUT with
   gate backend 'claude' → 204; GET reflects it; row exists in the scratch
   DB's settings table. PUT with backend 'gpt' → 400 + readable message.
3. With gate switched to claude in settings, ONE real submit turn — confirm
   via the session's `logs/<id>.jsonl` trace (scratch logs dir if the path is
   configurable; otherwise assert on the trace file it produces) that the
   gate call's `backend` field says `claude`. (Requires `claude` CLI on PATH —
   it is. If the turn fails because of the claude CLI itself, report the
   failure output rather than faking success.)
4. git status shows only intended changes; kill your scratch server.

## Report back
Files changed, commands run + outputs (esp. the trace evidence from step 3),
and residual risk. Note anything in the spec that didn't match reality.
