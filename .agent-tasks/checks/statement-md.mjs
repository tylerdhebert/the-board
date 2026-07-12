// Checks for htmlToMarkdown / splitStatement / stripFigureRefs.
// Run: npx tsx .agent-tasks/checks/statement-md.mjs
import { htmlToMarkdown, splitStatement, stripFigureRefs } from '../../engine/src/leetcode.ts';

let failed = 0;
function check(name, cond, got) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}\n  got: ${JSON.stringify(got)}`);
  }
}

// Shaped like real LC content: attributed <strong class="example">, <pre>
// examples with <strong> labels, <sup> inside <code>, an <img>, a
// Constraints <ul>, and a Follow up.
const html = `
<p>Given an integer array <code>nums</code>, rotate the array to the right by <code>k</code> steps, where <code>k</code> is <strong>non-negative</strong>.</p>

<p><strong class="example">Example 1:</strong></p>
<img alt="rotation diagram" src="https://assets.leetcode.com/uploads/rotate.jpg" style="width: 300px;" />
<pre>
<strong>Input:</strong> nums = [1,2,3,4,5,6,7], k = 3
<strong>Output:</strong> [5,6,7,1,2,3,4]
</pre>

<p>&nbsp;</p>
<p><strong>Constraints:</strong></p>
<ul>
  <li><code>1 &lt;= nums.length &lt;= 10<sup>5</sup></code></li>
  <li><code>-2<sup>31</sup> &lt;= nums[i] &lt;= 2<sup>31</sup> - 1</code></li>
</ul>

<p><strong>Follow up:</strong></p>
<p>Could you do it in-place with <code>O(1)</code> extra space?</p>
`;

const md = htmlToMarkdown(html);

check('inline code preserved', md.includes('`nums`') && md.includes('`k`'), md);
check('attributed strong -> bold', md.includes('**Example 1:**'), md);
check('pre -> fence with labels as plain text', /```\nInput: nums = \[1,2,3,4,5,6,7\], k = 3\nOutput: \[5,6,7,1,2,3,4\]\n```/.test(md), md);
check('sup inside code -> caret', md.includes('`1 <= nums.length <= 10^5`'), md);
check('negative power sup', md.includes('`-2^31 <= nums[i] <= 2^31 - 1`'), md);
check('img -> markdown image', md.includes('![rotation diagram](https://assets.leetcode.com/uploads/rotate.jpg)'), md);
check('list items -> dashes, dedented', /^- `1 <= nums\.length/m.test(md), md);
check('image hugs its label line (pre-wrap spacing)', md.includes('**Example 1:**\n![rotation diagram]'), md);
check('fence hugs the image line', md.includes('rotate.jpg)\n```'), md);
check('list items single-spaced', md.includes('10^5`\n- `-2^31'), md);
check('no leftover tags', !/<[a-z/]/i.test(md), md);
check('no leftover entities', !/&(lt|gt|amp|nbsp|quot);/.test(md), md);

const { statementMd, constraintsMd } = splitStatement(md);
check('split: statement keeps examples', statementMd.includes('**Example 1:**'), statementMd);
check('split: statement drops constraints', !statementMd.includes('nums.length <= 10^5'), statementMd);
check('split: constraints keep follow up', constraintsMd.includes('**Follow up:**') && constraintsMd.includes('10^5'), constraintsMd);

const stripped = stripFigureRefs(statementMd);
check('strip: image -> [figure: alt]', stripped.includes('[figure: rotation diagram]') && !stripped.includes('assets.leetcode.com'), stripped);
check('strip: figure:N refs too', stripFigureRefs('see ![tree](figure:0) here') === 'see [figure: tree] here', stripFigureRefs('see ![tree](figure:0) here'));

// A statement containing huge numbers must not trip the fence sentinel.
const big = htmlToMarkdown('<p>at most 100000000 calls</p><pre>x = 1</pre>');
check('fence sentinel survives big numbers', big.includes('100000000') && big.includes('```\nx = 1\n```'), big);
check('fence hugs plain label line', big.includes('calls\n```'), big);

console.log(failed === 0 ? '\nAll statement-md checks passed.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
