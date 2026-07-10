# Round B: tutor sees the board by pulling the editor file

Implement Round B from `HANDOFF.md`: the teacher gets lightweight board context and may read the student's current editor file from its working directory. The editor buffer must not be embedded in the teacher prompt or transcript.

## Subagent ground rules

- Do not run the `tyler-review` skill or launch any auxiliary reviewer.
- Preserve all existing dirty work, including the completed uncommitted Round A and Python LSP increments.
- Test fixtures use isolated paths and scratch ports. Never touch the real `tutor.db`, `logs/`, cards, or live stack on 8787/5173/9223.
- Never kill processes by name. Kill only PIDs you started.
- Do not commit.

## Product behavior

On every student turn:

1. The web client flushes the current editor buffer and language through the existing `/api/session/:id/editor` endpoint before opening the submit stream. The submit request itself remains message/display only.
2. The server writes that persisted editor buffer into a per-session scratch directory as `editor.<ext>`.
3. The teacher receives two compact context lines in its prompt:
   - `BOARD: attempt N · x/y passing · language · last failing case: ...`
   - `The student's editor is at ./editor.<ext> — read it if you need it.`
4. Only the teacher CLI runs with that per-session scratch directory as its `cwd`, including a redraft after gate rejection. Unlock and gate clients keep their existing working directory and inputs.
5. Pseudocode, scaffold code, identifiers, and language-specific idioms in tutor replies follow the student's selected language.

The CLI's own file-reading agency is the pull mechanism. Do not read the editor file back into the prompt.

## Server scratch ownership

- Add a default scratch root under `server/.teacher-scratch/` and gitignore it.
- Support `TUTOR_TEACHER_SCRATCH_DIR` so checks can use an isolated temp directory.
- Use one child directory per session id. Session ids are server-generated UUIDs or validated restored ids; still keep path construction plainly safe.
- Map languages to extensions: python `.py`, typescript `.ts`, javascript `.js`, csharp `.cs`; unknown/empty uses `.txt`.
- Before each turn, ensure the session directory exists, remove any stale sibling `editor.*` from a prior language, and write the current buffer to the one current `editor.<ext>` file as UTF-8.
- The scratch directory is runtime state and persists like the existing LSP scratch directories; no new database schema is needed.

## Compact board status

Derive the line from persisted session/take state without adding schema:

- `attempt N`: use the latest take sequence when present, otherwise `0`.
- Passing count: use the latest run only when it belongs to the current persisted code and language. Prefer the newest take whose code/lang match the current editor and whose results are non-null. Render `x/y passing`; if no matching run exists, render `not run`.
- Last failing case: use the first failing case from that matching result and keep it compact (`display`, plus error or got/expected when useful). If none, render `none`. If the run itself errored without cases, use that short error.
- Language: use the selected language literally, falling back to `unknown`.
- Keep the entire BOARD line reasonably short; cap or truncate case/error detail rather than pouring a result payload into the prompt.

## Engine / CLI plumbing

- Extend `LLMRequest` with optional `cwd`.
- Extend the internal CLI runner spawn options to honor `cwd` for both Codex and Claude clients.
- Preserve tracing. `TracingLLMClient` must pass the request through unchanged; no trace schema change is required.
- Give `TutorSession.submit` a small optional turn-context object carrying the teacher cwd and the already-rendered board context. Thread it only into `teacherTurn`, including redrafts.
- Add a teacher-template slot near `Conversation so far` for the two board-context lines. Empty context must remain valid for engine-only callers/tests.
- Add an affirmative teacher instruction that pseudocode, scaffold code, and language idioms use the student's current language.
- Do not change gate or unlock prompts, MODE parsing, leak-term behavior, or response streaming.

## Web behavior

- Make the normal turn path await `saveEditor(sessionId, code, lang)` before `submitTurn` so an immediate send cannot expose a stale file.
- Keep the two-second background editor sync. If `saveEditor` currently swallows errors, make its contract explicit enough that the awaited turn flush can surface failure while the background path deliberately ignores it.
- Replace `reviewPrompt(code, run, notes)` with a message that requests review of the current board and optionally appends non-empty composer text under exactly `My notes:`. It must not include code or the test-result dump; the server-generated BOARD line supplies run context.
- Keep the visible transcript label `review my work` and the Round A composer reset behavior.

## Scope constraints

- No API-client backends, schema migration, new dependency, or broad abstraction layer.
- No changes to run execution, take checkout, provider settings, or UI layout/styling.
- Do not expose the answer key to the client.

## Verification

- Run engine and server TypeScript checks and `bun run build` in `web/`.
- Add or run a focused isolated check using a fake teacher client to prove:
  - the current editor file exists in the provided teacher cwd with exact code;
  - the teacher request receives that cwd;
  - the prompt contains the compact BOARD line and relative editor path;
  - the prompt does not contain the editor source;
  - a redraft receives the same cwd/context;
  - gate/unlock requests do not receive the teacher cwd.
- Check review-my-work no longer embeds source or the verbose test-result dump.
- `git status` must show only intended files plus the pre-existing Round A/Python LSP work.

## Report back

Return files changed, commands and concise outputs, verification evidence, and residual risk.
