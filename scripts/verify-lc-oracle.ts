import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { oracleExpectedOutputs, jsonAnswerToPythonLiteral } from '../engine/src/lcOracle.ts';

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function checkOracle(): Promise<void> {
  assert.equal(jsonAnswerToPythonLiteral('true'), 'True');
  assert.equal(jsonAnswerToPythonLiteral('false'), 'False');
  assert.equal(jsonAnswerToPythonLiteral('null'), 'None');
  assert.equal(
    jsonAnswerToPythonLiteral('[1,[2,false],"text"]'),
    '[1, [2, False], "text"]',
  );

  let interpretCalls = 0;
  let pollCalls = 0;
  const oracleFetch = (async (input, init) => {
    const url = String(input);
    if (url.includes('/interpret_solution/')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.question_id, '42');
      assert.equal(body.lang, 'python3');
      assert.equal(body.typed_code, 'def f(x): return x');
      assert.equal(typeof body.data_input, 'string');
      return jsonResponse({ interpret_id: interpretCalls++ === 0 ? 'one' : 'two' });
    }
    if (url.includes('/submissions/detail/one/check/')) {
      pollCalls++;
      return pollCalls === 1
        ? jsonResponse({ state: 'RUNNING' })
        : jsonResponse({ state: 'SUCCESS', expected_code_answer: 'true' });
    }
    if (url.includes('/submissions/detail/two/check/')) {
      return jsonResponse({
        state: 'SUCCESS',
        expected_code_answer: '[1,[2,false],"text"]',
      });
    }
    throw new Error(`unexpected mocked fetch: ${url}`);
  }) as typeof fetch;

  const outputs = await oracleExpectedOutputs(
    { session: 'session-fixture', csrf: 'csrf-fixture' },
    'fixture-problem',
    '42',
    'def f(x): return x',
    [['[1]'], ['[2]']],
    oracleFetch,
  );
  assert.deepEqual(outputs, ['True', '[1, [2, False], "text"]']);
  assert.equal(interpretCalls, 2);
  assert.equal(pollCalls, 2);

  const expiredFetch = (async () => jsonResponse({}, 403)) as typeof fetch;
  await assert.rejects(
    oracleExpectedOutputs(
      { session: 'session-fixture', csrf: 'csrf-fixture' },
      'fixture-problem',
      '42',
      'def f(x): return x',
      [['[1]']],
      expiredFetch,
    ),
    /LeetCode session expired — sign in again in settings/,
  );
}

async function checkIsolatedServer(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'socratic-lc-oracle-'));
  const dataDir = join(root, 'data');
  const { mkdir } = await import('node:fs/promises');
  const fakeCard = {
  title: 'Fixture card',
  statement: 'Fixture statement',
  constraints: '1 <= x <= 3',
  difficulty: 'Easy',
  brute_force: { approach: 'try it', time: 'O(1)', space: 'O(1)' },
  optimal: {
    approach: 'return one',
    language: 'Python3',
    code: 'def bad(x):\n    return 1',
    time: 'O(1)',
    space: 'O(1)',
  },
  key_insight: 'fixture',
  ladder: ['fixture'],
  traps: [],
  leak_terms: [],
  underlying_primitive: 'fixture',
  examples: [{ input: 'bad(1)', output: '999' }],
  };
  const fallbackCard = {
    ...fakeCard,
    title: 'Fallback card',
    optimal: { ...fakeCard.optimal, code: 'def good(x):\n    return x' },
    examples: [
      { input: 'good(1)', output: '1' },
      { input: 'good(2)', output: '2' },
    ],
  };

  const oldEnv = { ...process.env };
  process.env.TUTOR_DATA_DIR = dataDir;
  process.env.TUTOR_DB_PATH = join(dataDir, 'tutor.db');
  process.env.TUTOR_SEED_CARDS = join(root, 'seed-cards');

  try {
    await mkdir(join(dataDir, 'cards'), { recursive: true });
    const { createRequestHandler } = await import('../server/src/routes/index.ts');
    const { getOrIngestCard } = await import('../server/src/engine.ts');
    const { closeDb } = await import('../server/src/sessionStore/db.ts');
    const server = createServer(
      createRequestHandler({
        getOrIngestCard: (query, opts) =>
          getOrIngestCard(query, {
            ...opts,
            client: {
              complete: async () =>
                JSON.stringify(query === 'fallback-problem' ? fallbackCard : fakeCard),
            },
          }),
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const secret = { session: 'session-fixture-secret', csrf: 'csrf-fixture-secret' };
      const put = await realFetch(`${base}/api/settings/leetcode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secret),
      });
      assert.equal(put.status, 204);
      const settings = await realFetch(`${base}/api/settings`);
      const settingsBody = await settings.text();
      assert.equal(settings.status, 200);
      assert.match(settingsBody, /"leetcode":\{"signedIn":true\}/);
      assert(!settingsBody.includes(secret.session));
      assert(!settingsBody.includes(secret.csrf));

      const clear = await realFetch(`${base}/api/settings/leetcode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      });
      assert.equal(clear.status, 204);

      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.endsWith('/graphql')) {
          return jsonResponse({
            data: {
              question: {
                questionId: '7',
                title: 'Fixture problem',
                titleSlug: 'fixture-problem',
                difficulty: 'Easy',
                content: '<p>Fixture problem.</p>',
                codeSnippets: [
                  { lang: 'Python3', langSlug: 'python3', code: 'def bad(x): return x' },
                ],
              },
            },
          });
        }
        return realFetch(input, init);
      }) as typeof fetch;

      const start = await realFetch(`${base}/api/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'fixture-problem' }),
      });
      const startBody = await start.text();
      assert.equal(start.status, 502);
      assert.match(startBody, /ingest verification failed/);
      const cardPath = join(dataDir, 'cards', 'fixture-problem.card.json');
      const snippetsPath = join(dataDir, 'cards', 'fixture-problem.snippets.json');
      await assert.rejects(access(cardPath));
      await assert.rejects(access(snippetsPath));

      const fallbackSecret = { session: 'fallback-session', csrf: 'fallback-csrf' };
      const fallbackPut = await realFetch(`${base}/api/settings/leetcode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackSecret),
      });
      assert.equal(fallbackPut.status, 204);
      let fallbackOracleCalls = 0;
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.endsWith('/graphql')) {
          return jsonResponse({
            data: {
              question: {
                questionId: '8',
                title: 'Fallback problem',
                titleSlug: 'fallback-problem',
                difficulty: 'Easy',
                content: '<p>Fallback problem.</p>',
                codeSnippets: [
                  { lang: 'Python3', langSlug: 'python3', code: 'def good(x): return x' },
                ],
              },
            },
          });
        }
        if (url.includes('/interpret_solution/')) {
          if (fallbackOracleCalls++ === 0) return jsonResponse({ interpret_id: 'fallback-one' });
          return jsonResponse({}, 500);
        }
        if (url.includes('/submissions/detail/fallback-one/check/')) {
          return jsonResponse({ state: 'SUCCESS', expected_code_answer: '1' });
        }
        return realFetch(input, init);
      }) as typeof fetch;
      const fallback = await realFetch(`${base}/api/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'fallback-problem' }),
      });
      assert.equal(fallback.status, 200);
      const cachedFallback = JSON.parse(
        await readFile(join(dataDir, 'cards', 'fallback-problem.card.json'), 'utf8'),
      ) as { examples: { output: string }[] };
      assert.deepEqual(cachedFallback.examples.map((example) => example.output), ['1', '2']);
    } finally {
      globalThis.fetch = realFetch;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      closeDb();
    }
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

await checkOracle();
await checkIsolatedServer();
console.log('lc oracle checks passed: mocked oracle flow, conversion, expiry, settings secrecy, 502 gate, no cache');
