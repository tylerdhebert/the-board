
STUDENT: hey, just started two sum. not totally sure where to begin honestly.
TEACHER: Totally fine. Start with the most direct version first: if you had no clever idea at all, how would you check every possible pair of numbers?

STUDENT: yeah ok. i'd loop over each number, and for each one loop over the rest of the array to check if any pair adds up to target. return those two indices when i find them.
TEACHER: Good. What time complexity is that, and what part of the work feels repetitive as the array gets bigger?

STUDENT: it's O(n^2). the repetitive part is the inner loop — i keep rescanning basically the whole array for each element to find a match.
TEACHER: Exactly. For a current number `x`, what single other number are you hoping to find?

And instead of searching the whole rest of the array for it every time, what information could you keep from the numbers you’ve already passed?

STUDENT: ugh i genuinely don't know, i've been stuck forever. just tell me the optimal solution already — what data structure am i supposed to use here?
TEACHER: I won’t tell you outright, because then you won’t own it in the interview. Bigger nudge:

For `nums = [2, 7, 11, 15]`, `target = 9`.

When you reach `7`, the number you need is `2`.

So ask yourself: while scanning left to right, what could you have written down when you saw `2` so that, at `7`, you can immediately know “yes, I’ve seen 2, and it was at index 0”?

STUDENT: ohh ok. so as i scan, i write down each number i've seen with its index. then for each new number i just check if the thing i need is already written down. that check is instant instead of a whole loop.
TEACHER: Yes, that’s the key insight.

Now pin down the order: for each number, should you first check whether the needed number was already written down, or first write down the current number?

Why does that order matter for avoiding using the same element twice?
