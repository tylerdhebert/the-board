// Manual/observational regression harness for the DE-ESCALATION trigger — the
// one safety-critical behavior the gate cannot backstop (an over-eager
// de-escalation reveals too much and no component catches it).
// NOT a unit test: it makes real model calls. Run:
//   npx tsx probes/deescalation.ts <borderline|plateau|hopeless> [cardPath]
// Expected: borderline stays socratic; plateau de-escalates ~turn 4; hopeless
// de-escalates at the give-up turn.
import { readFile } from 'node:fs/promises';
import { CodexCliClient } from '../src/llm.js';
import { TutorSession } from '../src/session.js';
import type { ProblemCard } from '../src/types.js';

// Two contrasting students. The TRIGGER test: borderline should stay socratic
// (stuck-but-progressing); hopeless should eventually de-escalate (analog/scaffold).
const personas: Record<string, string[]> = {
  borderline: [
    "ok two sum. i need to return the indices of two numbers that add up to target. not sure how to actually find them though.",
    "i guess i could check every possible pair and see which adds up? feels slow but it'd work.",
    "it's O(n^2) i think, a loop inside a loop. i feel like there's a faster way but i can't quite see it.",
    "hmm. the slow part is that for each number i scan the whole rest of the array to find its match. not sure how to avoid that.",
    "i'm a bit stuck honestly. is there some way to not have to re-scan the array every time?",
    "maybe i could keep track of the numbers i've already looked at somehow? not sure how that helps yet.",
  ],
  plateau: [
    "two sum — i can already do the brute force, nested loops checking every pair, that's O(n^2). i know there's supposedly a faster way.",
    "i want to make it faster but i honestly don't see how. the inner loop scans the whole array each time.",
    "yeah i get that i'm re-searching. but i don't know how else to find the matching number — you have to look for it somehow, right?",
    "i still don't see it. how would you find the number without searching the array? i feel like i'm going in circles.",
    "no i really don't get it. i've been staring at this for ages and i have no idea what the trick is.",
    "honestly still nothing. i just don't see how you avoid searching.",
  ],
  hopeless: [
    "honestly i don't even get what two sum is asking.",
    "uhh i don't know. what even is an index?",
    "i really don't understand how you'd find them with code. i can see it with my eyes but not in code.",
    "i don't get it. you just add them? i don't know what you want me to say.",
    "i really can't do this, i keep getting more confused. i give up honestly.",
    "idk. i still don't understand any of this. this is hopeless.",
  ],
};

const persona = process.argv[2] ?? 'borderline';
const cardPath = process.argv[3] ?? '../cards/two_sum.card.json';
const msgs = personas[persona]!;
const card = JSON.parse(await readFile(cardPath, 'utf-8')) as ProblemCard;
const s = new TutorSession(new CodexCliClient(), card, {
  teacher: 'gpt-5.5', gate: 'gpt-5.4-mini', unlock: 'gpt-5.4-mini',
});

console.log(`### persona: ${persona} | problem: ${card.title}\n`);
for (let i = 0; i < msgs.length; i++) {
  const r = await s.submit(msgs[i]!);
  const flag = r.mode !== 'socratic' ? `  <<<<< DE-ESCALATED to ${r.mode}` : '';
  const extra = `${r.redrafted ? ' (redrafted)' : ''}${r.unlockedThisTurn.length ? ' unlocked:[' + r.unlockedThisTurn.join(', ') + ']' : ''}`;
  console.log(`--- turn ${i + 1} [${r.mode}]${flag}${extra} ---`);
  console.log('STUDENT:', msgs[i]);
  console.log('TUTOR  :', r.reply, '\n');
}
console.log(`lockedTerms remaining: ${s.lockedTerms.length}`);
