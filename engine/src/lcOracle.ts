export type LeetCodeAuth = { session: string; csrf: string };

const INTERPRET_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 60_000;
const CASE_SPACING_MS = 3_000;

export type OracleFetch = typeof fetch;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeLoginRedirect(response: Response): boolean {
  return /\/accounts\/login(?:\/|$)/i.test(response.url);
}

function authHeaders(auth: LeetCodeAuth, slug: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Cookie: `LEETCODE_SESSION=${auth.session}; csrftoken=${auth.csrf}`,
    Referer: `https://leetcode.com/problems/${slug}/`,
    'User-Agent': 'Mozilla/5.0',
    'x-csrftoken': auth.csrf,
  };
}

function assertAuthenticated(response: Response): void {
  if (response.status === 401 || response.status === 403 || looksLikeLoginRedirect(response)) {
    throw new Error('LeetCode session expired — sign in again in settings');
  }
}

function pythonLiteral(value: unknown): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('LeetCode returned a non-finite number');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${pythonLiteral(key)}: ${pythonLiteral(item)}`)
      .join(', ')}}`;
  }
  throw new Error(`LeetCode returned an unsupported answer: ${String(value)}`);
}

/** Convert LeetCode's JSON-ish expected answer into a Python literal. */
export function jsonAnswerToPythonLiteral(raw: string): string {
  const trimmed = raw.trim();
  try {
    return pythonLiteral(JSON.parse(trimmed) as unknown);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`LeetCode returned an invalid expected answer: ${trimmed.slice(0, 120)}`);
    }
    throw err;
  }
}

async function postInterpret(
  fetchImpl: OracleFetch,
  auth: LeetCodeAuth,
  slug: string,
  questionId: string,
  typedCode: string,
  dataInput: string,
): Promise<string> {
  const response = await fetchImpl(
    `https://leetcode.com/problems/${slug}/interpret_solution/`,
    {
      method: 'POST',
      headers: authHeaders(auth, slug),
      body: JSON.stringify({
        question_id: questionId,
        lang: 'python3',
        typed_code: typedCode,
        data_input: dataInput,
      }),
      signal: AbortSignal.timeout(INTERPRET_TIMEOUT_MS),
    },
  );
  assertAuthenticated(response);
  if (!response.ok) throw new Error(`LeetCode interpret request failed with status ${response.status}`);
  const body = (await response.json()) as { interpret_id?: string | number };
  if (body.interpret_id == null || String(body.interpret_id).trim() === '') {
    throw new Error('LeetCode interpret response did not include interpret_id');
  }
  return String(body.interpret_id);
}

async function pollExpected(
  fetchImpl: OracleFetch,
  auth: LeetCodeAuth,
  slug: string,
  interpretId: string,
): Promise<string> {
  const url = `https://leetcode.com/submissions/detail/${encodeURIComponent(interpretId)}/check/`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetchImpl(url, {
      headers: authHeaders(auth, slug),
      signal: AbortSignal.timeout(INTERPRET_TIMEOUT_MS),
    });
    assertAuthenticated(response);
    if (!response.ok) throw new Error(`LeetCode poll failed with status ${response.status}`);
    const body = (await response.json()) as {
      state?: string;
      expected_code_answer?: string | null;
      status_msg?: string | null;
    };
    if (body.state === 'SUCCESS') {
      if (typeof body.expected_code_answer !== 'string') {
        throw new Error('LeetCode poll response did not include expected_code_answer');
      }
      return jsonAnswerToPythonLiteral(body.expected_code_answer);
    }
    if (body.state === 'FAILURE' || body.state === 'ERROR') {
      throw new Error(body.status_msg || `LeetCode oracle returned state ${body.state}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('LeetCode oracle timed out after 60s');
}

export async function oracleExpectedOutputs(
  auth: LeetCodeAuth,
  slug: string,
  questionId: string,
  pythonSnippet: string,
  inputs: string[][],
  fetchImpl: OracleFetch = fetch,
): Promise<string[]> {
  const outputs: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    if (i > 0) await sleep(CASE_SPACING_MS);
    const dataInput = inputs[i]!.join('\n');
    const interpretId = await postInterpret(
      fetchImpl,
      auth,
      slug,
      questionId,
      pythonSnippet,
      dataInput,
    );
    outputs.push(await pollExpected(fetchImpl, auth, slug, interpretId));
  }
  return outputs;
}
