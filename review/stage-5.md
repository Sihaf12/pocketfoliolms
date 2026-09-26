# Stage 5 review: rewiring the prototype

**Status:** built, and every automated suite passes, but not committed. The manual click-through in Chrome hasn't happened yet: it's blocked on the `/etc/hosts` entries below, which need your password.

## What you need to do manually

1. **Add the three demo hosts to `/etc/hosts`.** This needs `sudo`, so run it in your own terminal:

   ```
   sudo sh -c 'echo "127.0.0.1 gtl.academy.test pocketfolio.academy.test meridian.academy.test" >> /etc/hosts'
   ```

   The line it adds:

   ```
   127.0.0.1 gtl.academy.test pocketfolio.academy.test meridian.academy.test
   ```

2. **Tell me when that's done.** I'll then drive Chrome through sign-up → placement → lessons → certificate → `/verify` on all three hosts, fix whatever breaks, and commit stage 5 once it works.

3. **If you want to click through yourself**, the demo is already running on port 3000 (`npm run demo`):
   - http://gtl.academy.test:3000/
   - http://pocketfolio.academy.test:3000/
   - http://meridian.academy.test:3000/

   Signing up at one academy doesn't sign you in at another; each keeps its own session. `npm run demo:reset` clears the demo learners and keeps the academies and curriculum.

## Content changes applied

Both wording changes are in `db/seed/demo.sql`, and the running demo has been re-seeded with them:

- "Venues do not penalise you for an order that did not fill" → "Most venues do not charge for an order that did not fill."
- "often run by the same people" → "sometimes run by the same people" (in the glossary definition and the option text).

The quotes in `review/stage-4.md` were updated to match.

## What changed in `web/index.html`

- **Rules removed from the browser:** the baseline formula, level bands, gates, lesson states, the answer keys, check grading, the local question bank, client-invented events, client-generated serials and coins. A new guard test (`test/web.client.test.ts`) fails if any of them come back; run against the original prototype, it catches all eleven kinds. It also compiles the page script.
- **Every screen now reads the API:**
  - sign-up and a new sign-in form;
  - onboarding, which saves goal and daily time;
  - placement: draw, answer, one submission;
  - baseline;
  - the tree and catalogue, with the server's states and reasons;
  - lessons, rendered from the Markdown subset with all text escaped;
  - checks and certificates;
  - Progress and Me, from `/me`;
  - the outbox drawer, from `/me/events`.
- **Branding:** the name and all colours come from the tokens the server injects. The dark academy uses `data-mode`, and the theme picker is gone.

## Differences you'll see from the prototype

- **Checks are marked together.** You answer all three, submit once, then see feedback on each: your answer, the correct one, and the rationale for what you chose. The browser no longer knows the answers, so it can't mark them one at a time.
- **Removed:**
  - the fake QR code, and the PDF, image and LinkedIn buttons;
  - "Continue with Google" and "Retake placement";
  - the badges card, replaced by a line saying badges (E17-F02) are planned.
- **Consent:** the checkbox is required in the browser but not stored. E03-F01 consent capture has no API yet.
- **XP after a pass** is the change in `/me`'s total, so a retake of a lesson you've already verified shows no XP.

## Test results

| Suite | Result |
|---|---|
| `npm test` | 93/93 (the 4 new tests are the client guard) |
| SQL proof | 51 PASS |
| `npm run test:migrate` | passes (16 tables with RLS forced) |
| `npm run test:demo-seed` | passes |

## Not yet done

- The manual click-through on all three hosts.
- The stage 5 commit. Nothing from this stage is committed yet, and neither is this `review/` folder.
