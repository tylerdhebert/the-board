/**
 * Mutation / in-place / k-prefix grading check.
 * Run from repo root: npx tsx .agent-tasks/checks/mutation-grade.mjs
 * Or from engine/: npx tsx ../.agent-tasks/checks/mutation-grade.mjs
 */
import { extractCases } from '../../engine/src/exampleCases.ts';
import { runStudentCode } from '../../engine/src/runStudentCode.ts';
import { detectJudge } from '../../engine/src/leetcode.ts';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function summarize(label, result) {
  const passes = result.cases?.filter((c) => c.pass).length ?? 0;
  const total = result.cases?.length ?? 0;
  const errs = (result.cases ?? [])
    .filter((c) => c.error)
    .map((c) => c.error)
    .slice(0, 3);
  console.log(
    `\n=== ${label} ===`,
    `\n  error:`, result.error ?? null,
    `\n  pass: ${passes}/${total}`,
    errs.length ? `\n  caseErrors: ${JSON.stringify(errs)}` : '',
  );
  return result;
}

const rotateExamples = [
  { input: 'rotate([1,2,3,4,5,6,7], 3)', output: '[5,6,7,1,2,3,4]' },
  { input: 'rotate([-1,-100,3,99], 2)', output: '[3,99,-1,-100]' },
];

const rotateMeta = JSON.stringify({
  name: 'rotate',
  params: [
    { name: 'nums', type: 'integer[]' },
    { name: 'k', type: 'integer' },
  ],
  return: { type: 'void' },
});

const rotateJudge = detectJudge(rotateMeta, rotateExamples);
assert(rotateJudge?.kind === 'in-place' && rotateJudge.argIndex === 0, 'rotate judge');

const rotateCorrect = `
class Solution:
    def rotate(self, nums, k):
        n = len(nums)
        k %= n
        nums[:] = nums[-k:] + nums[:-k]
`;

const rotateWrong = `
class Solution:
    def rotate(self, nums, k):
        # wrong k: rotate by k+1 — permutation of expected, must FAIL under strict order
        n = len(nums)
        k = (k + 1) % n
        nums[:] = nums[-k:] + nums[:-k]
`;

const moveZeroesExamples = [
  { input: 'moveZeroes([0,1,0,3,12])', output: '[1,3,12,0,0]' },
  { input: 'moveZeroes([0])', output: '[0]' },
];

const moveZeroesMeta = JSON.stringify({
  name: 'moveZeroes',
  params: [{ name: 'nums', type: 'integer[]' }],
  return: { type: 'void' },
});

const moveZeroesJudge = detectJudge(moveZeroesMeta, moveZeroesExamples);
assert(moveZeroesJudge?.kind === 'in-place', 'moveZeroes judge');

const moveZeroesTs = `
function moveZeroes(nums: number[]): void {
  let w = 0;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== 0) {
      nums[w++] = nums[i]!;
    }
  }
  for (let i = w; i < nums.length; i++) nums[i] = 0;
}
`;

const removeDupExamples = [
  { input: 'removeDuplicates([1,1,2])', output: '2, nums = [1,2,_]' },
  { input: 'removeDuplicates([0,0,1,1,1,2,2,3,3,4])', output: '5, nums = [0,1,2,3,4,_,_,_,_,_]' },
];

const removeDupMeta = JSON.stringify({
  name: 'removeDuplicates',
  params: [{ name: 'nums', type: 'integer[]' }],
  return: { type: 'integer' },
});

const removeDupJudge = detectJudge(removeDupMeta, removeDupExamples);
assert(removeDupJudge?.kind === 'k-prefix' && removeDupJudge.argIndex === 0, 'removeDup judge');

const removeDupCorrect = `
class Solution:
    def removeDuplicates(self, nums):
        if not nums:
            return 0
        w = 1
        for i in range(1, len(nums)):
            if nums[i] != nums[w - 1]:
                nums[w] = nums[i]
                w += 1
        return w
`;

const removeDupWrongK = `
class Solution:
    def removeDuplicates(self, nums):
        # mutates correctly-ish but returns wrong k
        if not nums:
            return 0
        w = 1
        for i in range(1, len(nums)):
            if nums[i] != nums[w - 1]:
                nums[w] = nums[i]
                w += 1
        return w - 1
`;

const twoSumExamples = [
  { input: 'twoSum([2,7,11,15], 9)', output: '[0,1]' },
  { input: 'twoSum([3,2,4], 6)', output: '[1,2]' },
];

const twoSumMeta = JSON.stringify({
  name: 'twoSum',
  params: [
    { name: 'nums', type: 'integer[]' },
    { name: 'target', type: 'integer' },
  ],
  return: { type: 'integer[]' },
});

const twoSumJudge = detectJudge(twoSumMeta, twoSumExamples);
assert(twoSumJudge === undefined, 'twoSum should be judge-less');

const twoSumCode = `
class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], i]
            seen[x] = i
`;

async function main() {
  // 1. Rotate Array correct
  {
    const cases = await extractCases(rotateExamples, { judge: rotateJudge });
    const result = summarize(
      '1. python Rotate Array correct (in-place)',
      await runStudentCode(rotateCorrect, 'python', cases, undefined, rotateJudge),
    );
    assert(!result.error, '1: no fatal');
    assert(result.cases.length === 2 && result.cases.every((c) => c.pass), '1: all pass');
  }

  // 2. Rotate Array wrong rotation (permutation of expected) — fail, not "got nothing back"
  {
    const cases = await extractCases(rotateExamples, { judge: rotateJudge });
    const result = summarize(
      '2. python Rotate Array wrong k (permutation; must fail strict order)',
      await runStudentCode(rotateWrong, 'python', cases, undefined, rotateJudge),
    );
    assert(!result.error, '2: no fatal');
    assert(result.cases.every((c) => !c.pass), '2: all fail (strict order)');
    for (const c of result.cases) {
      assert(
        !c.error || !String(c.error).includes('got nothing back'),
        `2: must not say got nothing back, got: ${c.error}`,
      );
    }
  }

  // 3. Move Zeroes typescript
  {
    const cases = await extractCases(moveZeroesExamples, { judge: moveZeroesJudge });
    const result = summarize(
      '3. typescript Move Zeroes (in-place)',
      await runStudentCode(moveZeroesTs, 'typescript', cases, undefined, moveZeroesJudge),
    );
    assert(!result.error, '3: no fatal');
    assert(result.cases.length === 2 && result.cases.every((c) => c.pass), '3: all pass');
  }

  // 4a. Remove Duplicates correct
  {
    const cases = await extractCases(removeDupExamples, { judge: removeDupJudge });
    const result = summarize(
      '4a. python Remove Duplicates correct (k-prefix)',
      await runStudentCode(removeDupCorrect, 'python', cases, undefined, removeDupJudge),
    );
    assert(!result.error, '4a: no fatal');
    assert(result.cases.length === 2 && result.cases.every((c) => c.pass), '4a: all pass');
  }

  // 4b. Remove Duplicates wrong k
  {
    const cases = await extractCases(removeDupExamples, { judge: removeDupJudge });
    const result = summarize(
      '4b. python Remove Duplicates wrong k (k-prefix)',
      await runStudentCode(removeDupWrongK, 'python', cases, undefined, removeDupJudge),
    );
    assert(!result.error, '4b: no fatal');
    assert(result.cases.every((c) => !c.pass), '4b: all fail');
  }

  // 5. judge-less two-sum
  {
    const cases = await extractCases(twoSumExamples);
    const result = summarize(
      '5. python Two Sum judge-less',
      await runStudentCode(twoSumCode, 'python', cases),
    );
    assert(!result.error, '5: no fatal');
    assert(result.cases.length === 2 && result.cases.every((c) => c.pass), '5: all pass');

    // null-return still gets the classic message when judge is absent
    const voidish = `
class Solution:
    def twoSum(self, nums, target):
        return None
`;
    const nullResult = summarize(
      '5b. python Two Sum returns None (judge-less message)',
      await runStudentCode(voidish, 'python', cases),
    );
    assert(nullResult.cases.some((c) => String(c.error ?? '').includes('got nothing back')), '5b: classic message');
  }

  console.log('\nAll mutation-grade checks passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
