# Stage 5 result

**The click-through works on all three hosts**, as you tested it yourself in Chrome: gtl.academy.test, pocketfolio.academy.test and meridian.academy.test. I couldn't run the automated click-through because the Chrome extension wasn't connected, and you chose to test manually instead.

## Committed and pushed

Stage 5 is committed on `demo-wiring` and pushed to `origin` (github.com/Sihaf12/pocketfoliolms). `main` is unchanged.

The stage 5 commit contains:

- **`web/index.html`, rewired.** Every screen now reads the API, and the rules the browser used to compute are removed.
- **`test/web.client.test.ts`.** A guard that fails if any removed rule comes back. It also compiles the page script.
- **`db/seed/demo.sql`.** The two approved wording changes.
- **Updated test counts** in CLAUDE.md and the README.

The `review/` notes are committed separately.

## Final test results

| Suite | Result |
|---|---|
| `npm test` | 93/93 |
| SQL proof | 51 PASS |
| `npm run test:migrate` | passes (16 tables with RLS forced) |
| `npm run test:demo-seed` | passes |

## Still open

- **Consent:** the terms checkbox is required in the browser but not stored. E03-F01 consent capture has no API yet.
- **Badges (E17-F02)** are deferred from the demo.
- **All lesson content is a draft**, marked "Pending compliance review". The claims to review first are listed in `review/stage-4.md`.
- **The certificate trigger** (every lesson in a course passed) is temporary; E14-F02 course assessments will replace it.
- **Nothing is merged into `main`.**
