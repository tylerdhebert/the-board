# Round A: review notes and margin ergonomics

Implement the remaining Round A work described in `HANDOFF.md` under `CURRENT STATE` items 2 and 3.

## Scope

Edit only the web UI files needed for this increment, primarily `web/src/App.tsx` and `web/src/index.css`. The working tree already contains Tyler's uncommitted prototype edits in those files:

- the composer textarea was changed from 2 rows to 6;
- Send was moved to its own full-width row;
- the tutor margin changed from 400px to 25vw.

Treat those edits as design intent. Supersede them with the complete implementation below; do not revert or discard them.

## 1. Review-my-work includes composer notes

- When `review my work` is clicked, include the current composer text in the review prompt when it is non-empty.
- Add it as a clearly separated section beginning exactly `My notes:`.
- The composer text is context for the tutor; the existing code and latest-run context remain intact.
- Clear the composer only after the review action is accepted for submission, matching normal Send behavior.
- Keep the visible transcript label concise as the existing `review my work` action; do not echo the hidden code/prompt payload into the margin.
- Refactor `reviewPrompt` as needed so this behavior is explicit and easy to read.

## 2. Resizable tutor margin

- Add a narrow draggable divider on the left edge of the tutor margin.
- Pointer dragging changes the margin width smoothly.
- Persist the chosen width in `localStorage` and restore it on reload.
- Use a stable, literal storage key scoped to this app.
- Clamp the width to practical minimum and maximum bounds so neither the desk nor margin becomes unusable. Account for the current viewport width rather than using an unbounded pixel value.
- Preserve the existing two-column board layout and desktop-shell behavior.
- Give the divider appropriate resize cursor and accessible separator semantics. Keyboard resizing with arrow keys is expected.
- Avoid explanatory visible labels.

## 3. Composer textarea ergonomics

- Auto-grow with content from a compact starting height up to about 5-6 text rows.
- Once capped, the textarea scrolls internally.
- Add a drag handle on the textarea's top edge so the user can manually pull it taller or shorter.
- Manual height should remain usable while typing; auto-grow must not immediately erase the user's chosen size. A reset to the compact auto-sized height after a message is sent or reviewed is acceptable and preferred.
- Keep Send on its own full-width row as in the prototype, but remove the inline style and express it in CSS.
- Enter submits and Shift+Enter inserts a newline, preserving existing behavior.
- Use pointer events and clean up listeners/capture correctly. Do not add dependencies.

## 4. Styling pass

- Give student notes a soft, restrained shadow.
- Give tutor notes a faint chalk glow.
- Give the composer textarea a chalk treatment consistent with The Board: hand-drawn/rough-edged feel, slate/chalk palette, no rounded generic card.
- Preserve the established fonts, colors, chalk motif, margin annotations, and square geometry.
- Do not add hero content, helper copy, tooltips, or explanatory control labels.

## Constraints

- Do not touch server or engine behavior.
- Do not discard unrelated user changes.
- Keep the implementation direct; no new package or abstraction layer.
- Do not run unit or integration tests. Run `bun run build` in `web/` after implementation.
- Return: files changed, build command/result, and any residual risk.
