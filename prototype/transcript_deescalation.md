
STUDENT: i can already do two sum with two nested loops checking every pair — that's O(n^2). people say you can do it faster but i genuinely cannot see how. i've stared at it for an hour and i've got nothing.
TEACHER: Good, you’re exactly at the right pain point.

For one number, say `nums[i] = 4` and `target = 9`, what single number are you actually looking for?

And in your nested loop, are you “discovering” that needed number from scratch every time?

STUDENT: the number i need is 5. and yeah, i loop through everything to find the 5. but i don't see any other way — how ELSE would you find the 5 without looking through the array? you have to look for it somehow.
TEACHER: Totally fair. So don’t try to find the `5` in the future.

Flip it: as you walk left to right, ask:

“Have I already passed the number that would pair with this one?”

For example, with target `9`, if you’re currently at `5`, what earlier number would make you immediately done?

STUDENT: the earlier number would be 4. but to know whether i've 'already passed' a 4, don't i STILL have to look back through everything i passed? that's the same loop again. i'm genuinely not seeing how it's different.
TEACHER: You’re right if your only memory is the original array.

But you’re allowed to keep notes as you walk.

When you pass the `4`, what tiny note would you want to have written down so that later, at `5`, you can answer “did I already see a 4?” without scanning backward?

STUDENT: what note though? i genuinely don't get it. i mean i'd just keep a list of the numbers i've seen so far — but then to find the 4 in that list i'm searching the list, which is the same slow thing again. so what's the actual note?
TEACHER: You’re right: a plain list still leaves you scanning.

So make the note more useful first. When you pass a number like `4`, and later it pairs with `5`, the problem doesn’t just need “yes, I saw 4.”

What exact extra piece of information about that `4` would you need to return the answer?

STUDENT: the index of the 4 i guess, so i know where it was. but i STILL don't understand how i find the 4 in the first place without looking through everything. we keep going in circles and i'm completely lost, this is hopeless.
TEACHER: MODE: analog

Not hopeless. This is a missing tool, not a missing brain.

Side puzzle: you run a coat check. Each guest hands you a coat with a ticket number on it. Later, someone gives you a ticket number, and you need to find that coat immediately without scanning every coat on the rack.

How would you organize the coats as they come in?

STUDENT: i'd put them on numbered hooks — coat with ticket 7 goes on hook 7. then when someone hands me ticket 7, i walk straight to hook 7 and grab it. no scanning.
TEACHER: MODE: analog

Exactly.

Now bridge it back: in Two Sum, what could play the role of the ticket number on the hook, and what could you store on that hook so that later, when you need “the 4,” you can go straight there instead of scanning?
