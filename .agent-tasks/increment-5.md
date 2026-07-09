# TASK: Increment 5 — LeetCode fetch (link → statement)

Fetch a problem statement from a LeetCode URL/slug via their public GraphQL
endpoint, so ingest can start from a link instead of pasted text.

## Hard rules
- Work ONLY inside `engine/`. Do NOT run any git write command.
- Do NOT add any npm dependency. Use Node's GLOBAL `fetch` (Node 18+) and builtins only.
- `strict` stays on; `npm run typecheck` must pass with zero errors.

## File to create: `engine/src/leetcode.ts`

```ts
export interface LeetCodeProblem {
  title: string;
  slug: string;
  difficulty: string;
  contentHtml: string;   // raw HTML from LeetCode
  statement: string;     // plain-text, ready to feed to ingest()
}
```

Functions:

- `export function slugFromUrl(input: string): string`
  - If `input` looks like a URL, extract the slug: the path segment right after
    `/problems/` (e.g. `https://leetcode.com/problems/two-sum/description/` -> `two-sum`).
  - If `input` has no `/problems/` and no slashes, treat it as already a slug and
    return it trimmed/lowercased.
  - Throw a clear Error if no slug can be derived.

- `export function htmlToText(html: string): string`
  - Minimal HTML -> text: remove `<script>`/`<style>` blocks, convert `<br>`,
    `</p>`, `</div>`, `</li>` to newlines, strip all remaining tags, decode the
    common entities (`&lt; &gt; &amp; &quot; &#39; &nbsp;` and numeric `&#NN;`),
    collapse 3+ blank lines to 2, and trim. No external libraries.

- `export async function fetchProblem(input: string): Promise<LeetCodeProblem>`
  - `const slug = slugFromUrl(input)`.
  - POST to `https://leetcode.com/graphql` with JSON body:
    - query: `query q($titleSlug: String!){ question(titleSlug:$titleSlug){ title titleSlug difficulty content } }`
    - variables: `{ titleSlug: slug }`
  - Headers: `Content-Type: application/json`, `User-Agent: Mozilla/5.0`,
    `Referer: https://leetcode.com/problems/<slug>/`.
  - If the HTTP response is not ok, throw an Error with the status.
  - Parse JSON. If `data.question` is null, throw `Error('problem not found or premium-locked: <slug>')`.
  - Build `statement` as: `PROBLEM: <title> (<difficulty>)\n\n` + `htmlToText(content)`.
  - Return the full `LeetCodeProblem`.

## Verification (run and report exact outputs)
1. `npm run typecheck` — zero errors.
2. Throwaway probe `engine/_probe.ts` (delete after), run `npx tsx _probe.ts` from `engine/`:
   - OFFLINE unit checks (must pass regardless of network):
     - `slugFromUrl('https://leetcode.com/problems/two-sum/description/')` -> print (expect `two-sum`)
     - `slugFromUrl('two-sum')` -> print (expect `two-sum`)
     - `htmlToText('<p>Given an array <code>nums</code>&nbsp;&amp; a target.</p><p>Return indices.</p>')`
       -> print (expect two lines, entities decoded, no tags)
   - LIVE check (best-effort — network may be blocked here):
     - `try { const p = await fetchProblem('https://leetcode.com/problems/two-sum/'); console.log(p.title, '|', p.difficulty, '|', p.statement.slice(0,160)); } catch (e) { console.log('LIVE FETCH FAILED:', (e as Error).message); }`
   - Report BOTH the offline results and whatever the live check printed. A live
     failure due to network is acceptable; the offline unit checks must pass.
   Delete `engine/_probe.ts` after.
3. Update `engine/src/index.ts` to re-export `./leetcode.js`.

## Report back (concise)
1. Files created/changed.
2. typecheck result; offline probe results; live-fetch result (success or the error).
3. Residual risk (e.g. premium-locked problems need auth; LeetCode may rate-limit).
