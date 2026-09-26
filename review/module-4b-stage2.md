# Module 4b · stage 2: placement, starting point, and the path

## Where things stand

Stage 2 is committed on `module-4b` and pushed.

## What stage 2 builds

| Path | Screen |
|---|---|
| `/placement` | Eight scenarios, one at a time |
| `/start` | The starting point: your level and each tier's score |
| `/path` | Continue, and the map of lessons |
| `/explore` | Every course by tier, with what opens a closed tier |

**Placement.**
- **Answering.** A chosen answer is held for 400ms, then the next question arrives by itself, sliding in on the spring. The reader is taken to the new question, and a live region says "Question 2 of 8".
- **Skipping.** "Not covered yet" sits in the top row, beside the tier and the count.
- **Keyboard.** A, B and C answer.
- **Grading.** Nothing is graded on screen. The answers go once, at the end, and the server places.
- **Aside.** The desktop aside shows each tier's stones: answered, skipped, current.
- **Fix.** The paper is drawn once. Refreshing the session after submitting used to ask again, get "already placed", and redirect.

**Starting point.**
- The level springs in.
- The four bars fill one after another (the first at 450ms, then every 400ms), each number rolling up as its bar grows.
- The line under each bar is the server's own, from a new `tierOutlook()` in `src/domain/placement.ts`, sent on `/api/v1/pathway` as `outlook`. The app never works out what opens next itself.

**Path.**
- **Layout.** The map is laid out from the lessons' real prerequisites. A column is the number of prerequisite steps, and each column is ordered by where its prerequisites sit, so edges don't cross.
- **Drawing.** It draws itself within 900ms, the next lesson settling last.
- **On a phone.** The map scrolls sideways, starting with the next lesson in view. Choosing a lesson opens a modal bottom sheet: focus stays inside, and Escape or the veil closes it.
- **Wider screens.** A popover opens beside the node.
- **Every lesson is a button.** It is reached by Tab, opened with Enter or Space, and focus returns to it on close.
- **Locked lessons** show the server's reason ("Requires …", "Unlocks at …").

**Explore.** The tab bar links to it and the design has no screen for it, so it follows the landing's course cards: each course with lessons verified and a progress bar, what opens a closed tier, and a link to the next open lesson.

## Deviations from the design

1. **The current tab's label is ink, with the icon in the brand colour.** Brand on the brand tint misses 4.5:1.
2. **A verified lesson's detail also offers "Read it again".** Retakes are allowed, and the design's "Retake anytime" had nowhere to go.
3. **Explore is new**, as described above.

## Tests

| Suite | Result |
|---|---|
| `npm test` | 171/171, including the outlook rule |
| RLS proof | 51 PASS |
| Studio proof | 75 PASS |
| migrate, demo seed | pass |
| `npm run test:e2e` | 56/56 |

The 4 new browser runs (one test, in each academy, at each width) check:
- placement, starting point, path, the lesson detail and Explore, each with axe, focus ring and reduced motion;
- skip in the top row, above the question;
- an answer holding for 400ms, then advancing, with focus on the new question;
- the bars filling in sequence, with the rolled numbers matching the server's baseline;
- a locked lesson's sheet (phone) or popover (desktop) showing its reason, with Escape returning focus to the node.

## Next

Stage 3: lesson, simulator, check, the verified moment, progress, me, the certificate, and the public verify page.
