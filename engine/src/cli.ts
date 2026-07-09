import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { CodexCliClient } from './llm.js';
import { REPO_ROOT } from './paths.js';
import { TutorSession } from './session.js';
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

  const client = new CodexCliClient();
  const session = new TutorSession(client, card, {
    teacher: 'gpt-5.5',
    gate: 'gpt-5.4-mini',
    unlock: 'gpt-5.4-mini',
  });

  console.log(`Tutoring: ${card.title}`);

  const rl = readline.createInterface({ input, output });
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question('you> ');
      } catch {
        break; // EOF
      }
      const trimmed = line.trim();
      if (trimmed === 'exit' || trimmed === 'quit') break;
      if (trimmed === '') continue;

      const result = await session.submit(trimmed);
      console.log(`tutor [${result.mode}]> ${result.reply}`);
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
