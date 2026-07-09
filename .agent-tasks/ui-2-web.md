# TASK: UI-2 — React web app (problem picker + chat tutor)

A Vite + React + TypeScript app that talks to the UI-1 server so you can pick a
problem and chat with the tutor in a browser. No editor yet (that's UI-3) — just
a working, good-looking chat loop.

## Hard rules
- Create a new top-level `web/` directory. Work only there.
- Do NOT run any git write command.
- It must `npm run build` cleanly (tsc + vite build, zero errors).
- The client only ever sees student-safe data from the server — do not try to
  fetch or display any answer-key fields (the server doesn't send them).

## Scaffold
From the repo root run: `npm create vite@latest web -- --template react-ts`
then `cd web && npm install`. If the create command tries to prompt, instead
scaffold the equivalent react-ts Vite project manually. Keep the default
`react` + `react-dom` + `typescript` + `@vitejs/plugin-react` deps; add nothing else.

## Implement

### `web/vite.config.ts`
Add a dev proxy so the app calls same-origin `/api`:
`server: { proxy: { '/api': 'http://localhost:8787' } }` (keep the react plugin).

### `web/src/api.ts` — typed client
```ts
export interface Problem { title: string; statement: string; constraints: string }
export interface CardRef { name: string; title: string }
export interface TurnResult { reply: string; mode: 'socratic'|'analog'|'scaffold'; unlockedThisTurn: string[]; redrafted: boolean }
export async function getCards(): Promise<CardRef[]>
export async function createSession(cardName: string): Promise<{ sessionId: string; problem: Problem }>
export async function submitTurn(sessionId: string, message: string): Promise<TurnResult>
```
Use `fetch('/api/...')` with JSON. Throw on non-ok responses (include the status).

### `web/src/App.tsx` — the app
State: `cards`, `sessionId`, `problem`, `messages` (`{role:'student'|'tutor', text, mode?, unlocked?, redrafted?}[]`), `input`, `busy`.
Behavior:
- On mount, `getCards()` and render a problem picker (a `<select>` or a small list).
- Picking a problem calls `createSession(name)`, stores `sessionId`+`problem`, resets messages.
- Layout: a MAIN area (left/center) showing the selected problem's `title`,
  `statement`, and `constraints` (this area will later hold the code editor), and a
  CHAT RAIL (right, ~380px) with the message list + an input box + Send button.
- Sending: push the student message, set `busy`, call `submitTurn`, push the tutor
  reply. While `busy`, disable input and show a "tutor is thinking…" indicator
  (turns take ~15s — make the waiting state clear and calm, not a frozen UI).
- For each tutor message, show a small `mode` badge (socratic/analog/scaffold). If
  `unlockedThisTurn` is non-empty, show a subtle line like `✓ unlocked: <terms>`.
  If `redrafted`, a subtle marker is fine. Do NOT surface raw gate internals.
- Enter key sends (Shift+Enter = newline). Empty messages are ignored.

### Styling — `web/src/index.css` (or App.css)
Make it look INTENTIONAL, not default-Vite. A calm dark theme: near-black
background, comfortable serif or clean sans for the problem text, monospace only
where code-ish. Chat bubbles distinguishable by role. Readable line length in the
problem panel. Remove the default Vite boilerplate/logo styles. This is a first
pass — it should look deliberate but doesn't need to be fancy; a real design pass
comes later.

## Verification
1. `npm run build` in `web/` — must succeed (tsc + vite build), zero errors. Report the tail.
2. `npm run dev` starts and prints a local URL — report that it boots (you do NOT
   need the API server running to prove the build; the end-to-end run is done separately).
3. Confirm no default Vite boilerplate remains in `App.tsx` (no counter/logos).

## Report back
1. Files created/changed of note. 2. `npm run build` result. 3. That `npm run dev`
boots and on what URL. 4. Residual risk / anything you stubbed.
