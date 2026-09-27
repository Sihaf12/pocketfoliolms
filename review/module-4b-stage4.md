# Module 4b · stage 4: web/index.html retired, and the full Playwright pass

## Where things stand

- Stage 4 is committed on `module-4b` in two commits, and pushed.
  - `21b4b3d` carries only the deletions. The rest of that change failed to stage, because a path in my `git add` no longer existed, and I didn't notice before pushing.
  - On its own, `21b4b3d` does not build. The next commit completes stage 4, and the suites below were run on that complete state.
  - I haven't rewritten the pushed history. If you want the two squashed into one, it needs a force push to `module-4b`; say so and I'll do it.
- Module 4b is complete on that branch. It is not merged to `main`.
- The demo's API needs a restart to drop the old routes (below).

## What was retired

**Deleted: `web/index.html` and `web/verify.html`**, with everything that served them:
- Fastify's `GET /` and `GET /verify/:serial` (`src/http/routes/pages.ts`);
- the `webRoot` option and `WEB_ROOT` setting;
- the page-writing half of `src/http/brand.ts`.

**What now serves those addresses.** The Next.js learner app answers at `/` and `/verify` on every academy host. The public certificate API (`/api/v1/certificates/:serial`) is unchanged.

**One behaviour changes.** The old verify page answered on any host. The new one answers only on an academy's host (the links a certificate gives out are on its academy's host).

**The old page's tests are replaced by checks on the new app** (`test/learner.client.test.ts`, run in `npm test`):
- no server-owned rule in the learner app's source: baseline formula, levels, gates, answer keys, the 60/40 weighting, a pass mark or threshold, client serials, coins;
- every API call is to `/api/v1/` through the one client, with no stray `fetch`;
- every CSS variable used is defined, all ten tokens have defaults, and there is no theme or mode switch;
- lessons render through `packages/shared/markdown.ts` in the learner app and the studio's preview, with no copy of the renderer;
- a hostile brand reaches the page only as its one valid token (`tokenStylesheet`, now in `packages/shared/brand.ts`).

**Kept:** the brand sanitiser test, and the development-cookie test (now `test/http.devcookie.test.ts`).

**The pass mark now comes with the paper.** A check paper carries `passMark` from the server, so the app's "N more correct to verify" counts down from the server's rule rather than a hardcoded 2.

**Housekeeping.** `npm run build` now empties `dist/` first, so a deleted test can't linger and run.

## The Playwright pass

`npm run test:e2e`: 74 tests. Each runs at 390 and 1280. The learner screens run in GTL and in Meridian.

Every learner screen gets axe at WCAG 2.1 AA (contrast in that academy's palette), a check that each Tab stop shows a 2px-plus outline in the academy's brand colour, and a check that nothing animates or transitions under reduced motion:
- landing, sign-up, sign-in, onboarding (both steps);
- placement, starting point, path, the lesson detail (sheet on phone, popover on desktop), Explore;
- a lesson, a locked lesson, the simulator in the red zone;
- the check, the verified moment, a missed check;
- progress, me, the certificate, the public verify page, and the verify form on its own.

Stage 4 adds:
- the verify form alone, with a malformed code refused in words;
- a locked lesson opened directly, showing its reason;
- a check answered all wrong: "Not this time", then Try again drawing a new paper;
- sign-up to the starting point with the keyboard alone: typing, Space for the checkbox, arrow keys in the choice groups, A/B/C through placement.

| Suite | Result |
|---|---|
| `npm run typecheck` | the API, the studio and learner app, and the e2e specs pass |
| `npm test` | 166/166 |
| RLS proof | 51 PASS |
| Studio proof | 75 PASS |
| `npm run test:migrate` | 24 tables |
| `npm run test:demo-seed` | passes |
| `npm run test:e2e` | 74/74 |

## Open the learner app in Chrome

The demo still runs the code from before stage 1. To see Module 4b:

    npm run demo                    # stop the running one first (Ctrl+C in its terminal)

Then open http://gtl.academy.test:3100/ and http://meridian.academy.test:3100/.
- "Start your placement" goes through sign-up, onboarding, placement, the starting point and the path.
- Sign-up takes any email and a password of 12 or more characters.
- The lesson with the simulator is "Leverage and margin", in the Safeguard tier.
- For the 390px view, use Chrome's device toolbar (Cmd+Opt+I, then Cmd+Shift+M).

## Decide before merging

1. **Public verify page.** It shows name, course and date only; there is no record hash or audit-log entry, and it says "checked at" rather than "issued by". See the stage 3 review.
2. **Explore.** The design has no Explore screen; this one follows the landing's course cards.
3. **Contrast deviations**, listed in each stage's review. Faint text became ink-soft; the current tab label and tinted-card text became ink.
4. **Merge.** `module-4b` is ready to fast-forward onto `main` if you want it there.
