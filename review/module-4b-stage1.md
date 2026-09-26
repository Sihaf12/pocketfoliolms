# Module 4b · stage 1: app shell, tokens, entrance choreography, auth and onboarding

## Where things stand

- **The ten stage 5 fixes** are on `module-4a` (`26ff7bf` to `284ec80`), each with its tests and green.
- **`main`** was fast-forwarded to `284ec80` and pushed.
- **Stage 1** is committed on `module-4b` and pushed.

## What stage 1 builds

The learner app is part of the Next.js front end, with its own root layout and stylesheet. The studio and console moved under `app/(staff)`, so the two surfaces' class names never meet.

**Screens on an academy's host:**

| Path | Screen |
|---|---|
| `/` | Landing |
| `/signup` | Create your account |
| `/signin` | Welcome back |
| `/onboarding` | About you, in two steps: goal and daily time, then confidence 1 to 5 per tier |

**Tokens.** The design's variables are mapped onto the ten-token contract; the layout writes the academy's own tokens, fetched on the server.
- A dark academy is detected from its surface token, not from a mode switch. It gets the design's night-sky glow and dark scene.
- Status and tier colours are fixed.

**Entrances.**
- Screen content springs in: a `linear()` spring on the movement, an ease-out on the fade.
- The landing's path draws itself once, within 900ms: edges, then nodes, with the next lesson settling last.
- Moving between sign-in and sign-up slides the form across, as the design does.
- Reduced motion switches all of it off, and anything that waits on an animation (the path's nodes and labels) is shown drawn.

**New public API reads.**
- `GET /api/v1/academy`: name, tagline, tokens.
- `GET /api/v1/catalogue`: the academy's offered courses, in tier order, with lesson counts, minutes, lesson titles and what opens each tier.
- The gate wording for a tier comes from `tierRequirement()` in `src/domain/placement.ts`.

**Taken email.** A taken email is now refused beside the email field.

## Deviations from the design, and why

1. **Text never uses `--faint`.** The design's faint grey fails 4.5:1 in every palette. Those texts use `--ink-soft`. Tier labels are ink on a tinted chip, with a coloured dot.
2. **The certificate caption uses `--brand-ink`, not the accent.** Accent yellow on the blue gradient fails contrast.
3. **The landing's example path uses this academy's own lessons**, labelled "An example, three lessons in", instead of a named learner. A broker's curriculum may differ from the demo's.
4. **No invented numbers.**
   - Streak and XP chips come from `/api/v1/me`; the streak chip shows once there is a streak.
   - The sign-in aside says what streaks and XP are rather than showing a made-up "4-day streak".
5. **Links to pages that don't exist are left out:** Terms, Privacy, "Forgot your password?". The sign-up checkbox says what is agreed to: that the academy keeps the learning record and never shares it with another academy.
6. **App screens get top navigation on desktop.** The design has only the phone tab bar; the skill asks for top navigation on desktop, never both.
7. **The landing draws within 900ms** (the design's took 1.4s), as the skill requires.

## Tests

| Suite | Result |
|---|---|
| `npm test` | 170/170, including 3 new (public academy and catalogue; a taken email is named as a field) |
| RLS proof | 51 PASS |
| Studio proof | 75 PASS |
| `npm run test:migrate` | 24 tables |
| `npm run test:demo-seed` | passes |
| `npm run test:e2e` | 52/52 |

The 10 new browser tests cover:
- landing, sign-up, sign-in and both onboarding steps in GTL and Meridian, at 390 and 1280, each with axe, a brand-coloured focus ring and stillness under reduced motion;
- sign-up through onboarding by keyboard (arrow keys in the choice groups);
- confidence as a 1 to 5 row with no slider;
- a refused password shown beside its field;
- sign-in returning a learner where they belong.

The accessibility checks now wait for entrances to finish before measuring, so contrast is read from the page and not from a fade.

## Next

Stage 2: placement, starting point, and the path with a bottom sheet on phones.
