import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { REPO_ROOT } from './paths.js';
import { TutorSession, type SessionModels } from './session.js';
import { JsonlTracer } from './trace.js';
import type { ProblemCard } from './types.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

async function main(): Promise<void> {
  // Default `../cards/...` is relative to the engine/ directory under REPO_ROOT.
  const cardPath = resolve(
    join(REPO_ROOT, 'engine'),
    process.argv[2] ?? '../cards/two_sum.card.json',
  );
  const card = JSON.parse(await readFile(cardPath, 'utf-8')) as ProblemCard;

  const logsDir = join(REPO_ROOT, 'logs');
  await mkdir(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(logsDir, `session-${timestamp}.jsonl`);
  const tracer = new JsonlTracer(logPath);

  const models: SessionModels = {
    teacher: { backend: 'codex', model: 'gpt-5.5' },
    gate: { backend: 'codex', model: 'gpt-5.4-mini' },
    unlock: { backend: 'codex', model: 'gpt-5.4-mini' },
  };
  const session = new TutorSession(card, models, { tracer });

  console.log(`Tutoring: ${card.title}`);
  console.log(`(logging to ${logPath})`);

  const rl = readline.createInterface({ input, output });
  let direct = false;
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question(direct ? 'you (off the record)> ' : 'you> ');
      } catch {
        break; // EOF
      }
      const trimmed = line.trim();
      if (trimmed === 'exit' || trimmed === 'quit') break;
      if (trimmed === 'direct') {
        direct = !direct;
        console.log(
          direct
            ? `${DIM}(direct mode ON — gate off, tutor speaks freely)${RESET}`
            : `${DIM}(direct mode OFF — socratic tutoring resumes)${RESET}`,
        );
        continue;
      }
      if (trimmed === '') continue;

      const result = await session.submit(trimmed, undefined, undefined, { direct });
      console.log(`tutor [${result.mode}]> ${result.reply}`);
      if (result.artifact) {
        const artifactsDir = join(logsDir, 'artifacts');
        await mkdir(artifactsDir, { recursive: true });
        const slug = result.artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'walkthrough';
        const artifactPath = join(artifactsDir, `${session.turn}-${slug}.html`);
        await writeFile(artifactPath, result.artifact.html, 'utf8');
        console.log(`${DIM}(walkthrough: ${artifactPath})${RESET}`);
      }
      if (result.unlockedThisTurn.length > 0) {
        console.log(`${DIM}(unlocked: ${result.unlockedThisTurn.join(', ')})${RESET}`);
      }
      if (result.redrafted) {
        console.log(`${DIM}(gate made the tutor redraft)${RESET}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
