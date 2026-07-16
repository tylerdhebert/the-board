# Tutor artifacts: "let me walk you through it" HTML explainers

Give the tutor a way to author a standalone, beautiful HTML walkthrough when
a concept genuinely deserves more than margin prose — an analog it wants to
illustrate, a cost comparison, a step-through of the student's own idea. The
tutor says "here — let me walk you through it" in its normal reply, requests
an artifact via a control line, a second LLM call authors the document, the
server stores it under the app's data dir, and the margin note shows a small
document chip (title + filename) that opens in the default program.

## Subagent ground rules

- Never use real `tutor.db`, logs, cards, or live ports as fixtures. Use
  temp files/dirs (`TUTOR_DB_PATH`, `TUTOR_DATA_DIR`) and isolated processes.
- Never kill processes by name. Kill only PIDs you start.
- Do not commit.
- Read `docs/gestures.md` before touching the control-line parser — the
  MODE/gesture protocol contract lives there; extend it, don't rework it.

## Protocol (teacher output)

- New optional control line, same position class as gestures — immediately
  after the MODE line:
  `ARTIFACT: <one-line concept — becomes the doc title>`
- After MODE there may now be up to TWO control lines in any order: at most
  one gesture (POINT/SHOW/TAP) and at most one ARTIFACT. Parser
  (`parseTeacherReply`): scan up to two consecutive control-looking lines;
  strip them whether or not they validate (half-formed control lines never
  reach the student); malformed ARTIFACT (empty title) is dropped.
- The teacher must still write its normal short reply — the artifact
  supplements prose, never replaces it.
- Teacher template guidance (add to `teacher_tmpl.md` AND
  `teacher_direct_tmpl.md`, keeping each terse): use ARTIFACT sparingly,
  when a structured visual walkthrough genuinely beats margin prose —
  typically in analog/scaffold/direct, occasionally socratic. It is not a
  reflex; most turns need none. Socratic-mode artifacts obey the same leak
  budget as prose.

## Authoring call (engine)

- New prompt `prompts/artifact_tmpl.md` with slots: `title` (problem),
  `statement`, `constraints`, `cases`, `mode`, `leak_terms`, `concept` (the
  ARTIFACT line's text), `board_context`, `transcript` (same rendering as
  the teacher call), `language`.
- The prompt demands ONE complete standalone HTML document:
  - `<!doctype html>`, single file, no external assets except exactly
    `<script src="https://cdn.tailwindcss.com"></script>`; inline SVG
    diagrams welcome; no other `<script>` (no CDN JS, no fetch).
  - Semantic HTML that still reads correctly if Tailwind fails to load
    (offline default-browser case): headings, lists, `<pre><code>`.
  - The Board's chalk aesthetic via Tailwind arbitrary values: deep
    green-slate `#16241d` background, warm chalk `#ece6d6` text, amber
    `#f0c34a` accents, coral `#ef8a6a` highlights, mono for code. No
    rounded-corner card soup; generous whitespace; it should look like a
    beautiful lecture handout, not a SaaS landing page.
  - Structure: title header, then a stepwise walkthrough (numbered
    sections, small worked examples, one or two SVG diagrams where they
    earn their place), code in the student's `language`.
  - Mode policy restated in the prompt: socratic → must not state or
    all-but-state any locked term or the destination; analog → the analog
    world only, no bridge to the real problem; scaffold → structure with
    meaningful blanks; direct → anything goes.
- Engine: `artifactTurn(client, card, ...) => { title, html }` using the
  teacher's client/model. Strip a wrapping ``` fence if present; require the
  result to start with `<!doctype` or `<html` (case-insensitive) and be
  ≤ 200 KB, else discard the artifact (never fail the turn).

## Turn flow (engine `session.submit`)

- After the teacher draft is parsed and gated as today: if the (final,
  post-redraft) reply requested an artifact, emit new stage `'artifact'`,
  run the authoring call, then:
  - gated modes: run `gateCheck` with the declared mode against a
    text-extraction of the HTML (tags stripped, title prepended). REVISE →
    drop the artifact, keep the reply (no redraft loop for artifacts);
    record the drop in the trace.
  - direct mode: no gate.
- `TurnResult` gains `artifact?: { title: string; html: string }`. Trace
  `endTurn` records artifact title + its gate verdict (or `dropped`).
- One artifact per turn max.

## Storage + serving (server)

- `appPaths`: `artifactsDir` = `dataDir/artifacts` (repo layout:
  `<repo>/artifacts`, gitignore it).
- On a turn whose result carries an artifact: write
  `<artifactsDir>/<sessionId>/<seq>-<slug(title)>.html` (seq = note index;
  slug lowercase-kebab, ≤ 40 chars), then persist on the tutor note
  `artifact: { title, file }` (file = basename only) and include
  `artifact: { title, file, url }` in the SSE result event. A write failure
  must not eat the reply (same rule as persistEntry).
- Notes storage: guarded migration — `PRAGMA table_info(notes)`; add
  `artifact TEXT` (JSON) if missing. Update rowMapping + both PersistedNote
  types (server + web).
- Serve `GET /api/artifacts/:sessionId/:file` from `artifactsDir` with the
  same traversal guard as the static handler; `Content-Type: text/html`.
  Session id and file must be validated (no separators, file must match the
  stored basename pattern).

## UI (web) + desktop open

- Tutor notes with `artifact` render a compact chalk document chip under the
  prose (after reveal, like gesture cards): `📄 <title>` with the filename
  as a faint mono subline. Click:
  - desktop (`window.tutorDesktop`): new bridge `openArtifact(sessionId,
    file)` → main resolves the absolute path under its own artifactsDir and
    `shell.openPath` (default program, per design). Main must validate the
    ids the same way the server route does — never openPath an
    unvalidated path.
  - browser mode: `window.open('/api/artifacts/<sessionId>/<file>')`.
- Stage copy for `'artifact'`: `chalking up a walkthrough…`.
- CLI (`engine/src/cli.ts`): write the html under `<repo>/logs/artifacts/`
  and print the path.

## Scope constraints

- No artifact editing, versioning, gallery, or deletion UI.
- No iframe/inline rendering in the margin — chip + external open only.
- No new npm dependency; no schema.json change; gestures unchanged.
- Do not add an artifact button for the student — the TUTOR decides, same
  as gestures.

## Verification

- Parser unit checks: MODE alone; MODE+gesture; MODE+ARTIFACT;
  MODE+gesture+ARTIFACT (both orders); malformed ARTIFACT stripped and
  dropped; body never contains control lines.
- Fake-LLM engine check: teacher requests artifact → author returns valid
  HTML → gate PASS → TurnResult carries it; gate REVISE → artifact dropped,
  reply intact, trace records the drop; oversized/fence-wrapped/non-HTML
  outputs handled per spec.
- Isolated server check: turn with artifact writes the file under a temp
  `TUTOR_DATA_DIR`, note persists metadata, GET serves it, traversal
  attempts (`..%2f`, absolute, separators in ids) 404.
- Engine/server `tsc`, `bun run build` in `web/`.
- Remove temporary check scripts after running them.

## Report back

Files changed, commands + concise outputs, verification evidence (including
one rendered artifact opened locally), residual risk.
