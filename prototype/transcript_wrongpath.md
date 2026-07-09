
STUDENT: ok two sum. i think the move is to sort the array first, then use two pointers from both ends moving inward to find the pair that sums to target. clean and O(n log n).
TEACHER: Before locking that in: the problem asks for indices in the original array.

If `nums = [3, 2, 4]`, `target = 6`, sorting finds `2 + 4`. How would you return their original indices after sorting, especially if duplicates are involved?

STUDENT: easy — i pair each value with its original index first, like (value, index), THEN sort those pairs by value, then two-pointer. indices preserved. so sorting works fine, right?
TEACHER: Yep, pairing with original indices makes the sorting approach valid.

Now the next interview question is: can you beat `O(n log n)`?

In your two-pointer version, sorting is the expensive part. What is sorting helping you do that the brute-force version does slowly?
