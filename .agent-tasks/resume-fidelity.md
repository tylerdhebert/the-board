# Resume fidelity: gestures, scaffold fills, and sent-back state survive reload

Resuming a session (or reloading the app) currently loses everything the
notes carry beyond text: SHOW notecards dealt into the chat vanish, POINT
badges vanish, the student's typed scaffold blank fills vanish, and a
sent-back scaffold's "send it back" button comes back. Root cause: the
persisted note shape is `role/text/mode/unlocked/redrafted/artifact`;
`gesture`, `blanks`, and `sentBack` are client-ephemeral (`web/src/appTypes.ts`
marks them so). Persist them, following the `artifact` column precedent
exactly (added 2026-07-16 — see notes table migration in
`server/src/sessionStore/db.ts`).

Read `docs/gestures.md` first — it is the protocol contract. One deliberate
boundary this spec KEEPS: the POINT editor decoration (chalk arrow in
Monaco) stays ephemeral. What must persist is the note-level rendering in
the chat: the `↳ line N` badge and the SHOW index card. TAP's vocab shimmer
is transient by nature — persist the gesture (for the badge/trace) but do
NOT re-fire the shimmer on resume.

## Subagent ground rules

- Never use real `tutor.db`, logs, cards, or live ports as fixtures. Use
  temp files/dirs (`TUTOR_DB_PATH`, `TUTOR_DATA_DIR`) and isolated processes.
- Never kill processes by name. Kill only PIDs you start.
- Do not commit.

## Persistence (server)

- `PersistedNote` (server + web copies) gains:
  `gesture?: TeacherGesture`, `blanks?: string[]`, `sentBack?: boolean`.
- notes table: guarded migrations in the same PRAGMA-check style as
  `artifact` — add `gesture TEXT` (JSON), `blanks TEXT` (JSON array),
  `sent_back INTEGER`. Update rowMapping + queries + the legacy JSON-file
  import path if it maps note fields explicitly.
- `routes/submit.ts`: persist `result.gesture` on the tutor note it already
  pushes (the ACCEPTED gesture from the engine — the one included in the SSE
  result — not the raw parse).

## Note-state writeback (new endpoint)

- `PATCH /api/session/:id/note/:seq` (or PUT — match the codebase's habit)
  with body `{ blanks?: string[], sentBack?: boolean }`.
- Validates: session exists (getOrRestore), seq in range, target note is a
  tutor note; blanks is an array of strings (cap 32 entries, each ≤ 500
  chars); 400 otherwise. Merges the fields onto the note and persists via
  the existing persistEntry path. 204 on success.
- This endpoint stores display state only — it must not touch the engine
  transcript, locked terms, or turns.

## Web

- `api.ts`: `patchNoteState(sessionId, seq, state)` helper + PersistedNote
  type update.
- `loadSession` mapping (App.tsx ~line 510): carry `gesture`, `blanks`,
  `sentBack` onto the local Note objects.
- Typing in a scaffold blank (`setBlankValue`): debounce ~600ms per note,
  then `patchNoteState` with the current blanks. Flush pending state on
  `sendScaffoldBack` (which also patches `sentBack: true` + final blanks).
  Failures are non-fatal: console.warn, never block the UI.
- Resume rendering must work from persisted state alone: SHOW card and
  POINT badge render from `n.gesture` (the existing `!n.revealing` paths),
  scaffold inputs prefill from `n.blanks`, a `sentBack` note renders
  disabled with no send-back button — same as the live states today.
- Do NOT re-activate the Monaco POINT decoration or the TAP shimmer on
  resume.
- Note seq: the server note array index is the seq (same indexing the
  artifact filename uses). Make the client use the note's index within the
  full notes array, and be careful it patches the TUTOR note's index, not
  the student's.

## Scope constraints

- No editing/deleting of historical notes beyond these two fields.
- No engine changes; no schema.json change; no new npm dependency.
- Do not restructure the reveal/typewriter flow.

## Verification

- Isolated server on a temp `TUTOR_DB_PATH`: create a session, push a fake
  tutor note with gesture + scaffold text (direct store writes are fine),
  PATCH blanks + sentBack, then simulate a cold resume (fresh getOrRestore
  or a second server instance) and assert GET /api/session/:id returns the
  gesture, blanks, and sentBack intact.
- Migration check: build a temp db with the PRE-migration notes shape (no
  new columns), boot the store, assert columns added and old rows read back
  with the new fields undefined.
- PATCH validation: out-of-range seq, student-note seq, non-array blanks →
  400 and nothing persisted.
- Engine/server `tsc`, `bun run build` (or `npm run build`) in `web/`.
- Remove temporary check scripts after running them.

## Report back

Files changed, commands + concise outputs, verification evidence, residual
risk.
