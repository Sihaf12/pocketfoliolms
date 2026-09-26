# Module 4b · stage 3: lesson, simulator, check, verified moment, progress, me, certificate, verify

## Where things stand

Stage 3 is committed on `module-4b` and pushed.

## What stage 3 builds

| Path | Screen |
|---|---|
| `/learn/:id` | The lesson: Read; Try it where the lesson has the simulator; Watch where it has a video |
| `/learn/:id/check` | Three questions, each marked as it is answered |
| `/progress` | Level, streak and this week, what opens next, certificates, recently verified |
| `/me` | Profile, and signing out |
| `/verify`, `/verify/:serial` | Public certificate check, with no app around it |

**Lesson.**
- **Text.** Rendered by `packages/shared/markdown.ts`, like the studio's preview. Steps are headings, as in the design. Glossary terms are listed with their definitions beneath the text, so they can be read without hovering.
- **Header.** Says who wrote the lesson and who reviewed it, and when.
- **Tabs** are a real tablist: arrow keys move between them.

**Simulator.**
- The design's two sliders, with a spoken value for each.
- At a move that erases the margin, the card turns red and so does the page behind it (amber when critical).
- The page tint is cleared when the learner leaves the tab.

**Check.**
- Each answer is recorded and marked at once. The rationale unfolds: the row grows from zero height rather than popping in. Focus moves to Next.
- A, B and C answer. Stars fill as the learner goes.
- After the third answer the paper is submitted and graded by the server.

**Verified moment.** The ring fills, the tick lands, the XP counts up, with one burst on a pass. A miss offers Try again (a new draw) or Back to lesson. Finishing a course also offers the certificate.

**Certificate.**
- Opens from Progress, and from the verified moment through `#cert-SERIAL`.
- The verification address is in a selectable field. Copy is offered only where there is a clipboard.

**Public verify page.**
- Only a small header: the academy's mark and "Certificate record, checked at …". No nav, tab bar or footer.
- An unknown or revoked code reads the same, as the API answers them.

**API additions.**
- **`POST /api/v1/checks/:attemptId/answers`** `{questionId, key}` records one answer and returns `{correct, correctKey, rationale}`:
  - an answer cannot be changed afterwards (409 `already_answered`);
  - the final submission must carry the same answers (422 `answer_changed`), and it alone grades, emits `progression.verified` and issues certificates;
  - the browser still never receives an answer key before answering.
- **`/api/v1/me` gains `week`**: Monday to Sunday of this UTC week, with whether a check was passed that day.

## Deviations from the design, and why

1. **The verify page does not show a record hash or an audit-log entry number.** The public API returns only name, course and date, by design since Module 2: exposing internal audit positions would leak an academy's volume. Say if you want a public, per-certificate hash; it needs a migration and a decision about what it attests.
2. **"Issued by" on the verify page is "checked at".** Public verification deliberately does not reveal which academy issued a certificate, and a certificate checked on one academy's host may come from another.
3. **No "Add to LinkedIn".** It needs an integration that doesn't exist yet.
4. **Watch appears only for lessons with a video asset.** The design shows Read and Try it; the demo lessons have no video, so they show those two.
5. **The simulator's intro turns to ink on the amber and red tints**, to keep 4.5:1. Its output labels are sentence case, not the design's capitals.

## Tests

| Suite | Result |
|---|---|
| `npm test` | 172/172 (new: per-question answers stand and the submission must match; the week has seven days from Monday, with today marked) |
| RLS proof | 51 PASS |
| Studio proof | 75 PASS |
| migrate, demo seed | pass |
| `npm run test:e2e` | 68/68 |

The 12 new browser runs (in each academy, at each width) cover:
- a lesson and its check answered by keyboard: two right, one wrong, each rationale unfolding with real height, the verified moment and its XP;
- progress (this week's day marked, the lesson in "recently verified") and me;
- the simulator's red zone reaching the page and clearing when the learner leaves the tab;
- a finished course's certificate opening the public page, which has no app around it, and refuses an unknown code.

All of these run with axe, the brand-coloured focus ring and stillness under reduced motion. The tests read correct answers from the e2e database directly.

## Next

Stage 4: retire `web/index.html`, and the full Playwright pass at 390 and 1280 in GTL and Meridian.
