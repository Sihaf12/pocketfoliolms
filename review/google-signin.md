# Google sign-in for learners

Branch `google-signin`, from `module-4b` (`8067ca3`). Four commits, each green and pushed; this note and the README section are the fifth.

| Commit | Step |
|---|---|
| `6c59bd4` | Tables: `app.sso_states`, `app.sso_handoffs`, the unique Google id per academy, `app.sso_state_take()` |
| `9f40d07` | PKCE and ID-token checks with `node:crypto` (no jose) |
| `53a4939` | Routes: start, callback, complete; start-up refusals |
| `265fa55` | Front end: Continue with Google, the reasons on `/signin`, the callback host has no pages, e2e with a local stand-in for Google |

## What you put in `.env`

`npm run demo` reads `.env` from the repository root. It is sourced by `sh`, so write plain `KEY=value` lines with no spaces or quotes. Google's values don't need any.

**Development** (`npm run demo`, academies at `http://*.academy.test:3100`):

```
GOOGLE_CLIENT_ID=<your client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your client secret>
AUTH_CALLBACK_HOST=localhost:3100
```

That's all. `demo.sh` still sets the database URLs, `PROXY_SECRET`, `CONSOLE_HOST`, `DEV_INSECURE_COOKIE` and `NODE_ENV`, and overrides anything `.env` says about them.

Don't set `GOOGLE_AUTHORIZE_URL`, `GOOGLE_TOKEN_URL`, `GOOGLE_JWKS_URL` or `GOOGLE_ISSUER`. Only the e2e run's stand-in uses them.

**Production** (the same three settings):

```
GOOGLE_CLIENT_ID=<your client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your client secret>
AUTH_CALLBACK_HOST=auth.<your platform domain>
```

- **Both processes need them.** The Fastify API needs all three. The Next.js front end needs `AUTH_CALLBACK_HOST`, so that host serves no pages.
- **Production reads the process environment, not `.env`.** Nothing outside `demo.sh` reads that file. On Node 20 you can use `node --env-file=.env`, or your host's secret store.
- **The callback host** needs DNS pointing at the front end, the same as an academy, and a TLS certificate.
- **The server won't start if the callback host:**
  - is an academy's domain;
  - is the console's host;
  - isn't a plain host name;
  - is `localhost` while `NODE_ENV=production`.

Leave `GOOGLE_CLIENT_ID` or `AUTH_CALLBACK_HOST` empty and Google sign-in is off. The button disappears, and the routes aren't registered.

## What you register in the Google console

In Google Cloud console, under **APIs & Services** (or **Google Auth Platform** in the newer layout):

1. **OAuth consent screen.**
   - User type **External**.
   - App name: the platform's name. Learners at every academy will see this name, because there is one client for all of them.
   - A support email.
   - **Authorized domains:** your platform domain, the parent of `AUTH_CALLBACK_HOST`.
   - **Scopes:** `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`, and nothing else. These are non-sensitive scopes, so they don't need Google's scope verification.
   - While the app is in **Testing**, only the test users you list can sign in. **Publish** it before real learners use it.
2. **Credentials → Create credentials → OAuth client ID.**
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** none. The whole flow runs on the server.
   - **Authorized redirect URIs:** exactly one per environment, character for character:
     - development: `http://localhost:3100/api/auth/google/callback`
     - production: `https://auth.<your platform domain>/api/auth/google/callback`

   You can put both on one client, or make one client per environment. Separate clients keep a development secret away from production.
3. Copy the **client ID** and **client secret** into `.env` as above.

Google accepts plain `http` only for `localhost`, which is why development uses `localhost:3100` rather than an `*.academy.test` host.

## How it works

1. **Start, on the academy's host.** `GET /api/v1/auth/google/start?ref=&next=` stores a state for this academy with:
   - the hash of the state, and the hash of a browser binding;
   - the PKCE verifier and the nonce;
   - the referral code, the return page, and the academy's origin.

   The state lasts 10 minutes and works once. The start sets an `sso_bind` cookie (HttpOnly, Lax, path `/api/v1/auth/google`) and redirects to Google with `openid email profile`, S256 and `prompt=select_account`.
2. **Callback, on `AUTH_CALLBACK_HOST` only** (any other host gets a 404).
   - `app.sso_state_take()` deletes the state and returns it, once.
   - The callback exchanges the code with the verifier, then checks the ID token: RS256 against Google's keys, the issuer, the audience or azp, the expiry, our nonce, and a verified email.
   - It then works under the state's academy's RLS:
     - **refuse** any account holding a studio role;
     - **link** a learner with the same email: set `sso_subject`, clear the password, revoke that learner's sessions;
     - **or create** a learner: `registered`, Google's display name, the page's `ib_ref_code`.

     Every case is audited.
   - It writes a handoff code valid for 60 seconds and redirects to the academy's origin.
3. **Complete, on the academy's host.** `GET /api/v1/auth/google/complete?code=` redeems the code under that host's RLS, and only with the matching `sso_bind` cookie. It issues a normal learner session and goes to the return page, or wherever the learner's stage says: `/onboarding`, `/placement` or `/path`.

**What the failures do:**
- Anything that can't finish goes back to `/signin?sso=<reason>` on the academy it started from. The reasons are `cancelled`, `expired`, `unavailable`, `studio_account`, `unverified`, `conflict` and `failed`, each with its own message.
- An unknown or already-used state gets a plain page that names no academy.

## Deviations from the plan

- **No `app.sso_state_begin()` function.** The start route writes the state with a plain `INSERT` under the academy's RLS. The request role holds INSERT and nothing else on `sso_states`, so it can never read a verifier back, and the policy's `WITH CHECK` stops it writing a state for another academy. The RLS proof covers both. A definer function would have added nothing.
- **Added a browser-binding cookie (`sso_bind`)**, which the plan didn't name. Without it, someone could complete their own Google sign-in in a victim's browser (login CSRF). The binding is checked in the redeeming `UPDATE`'s `WHERE`, so a wrong or missing cookie doesn't use up the code.
- **An unverified Google email is refused** (`unverified`) rather than linked or created, because linking by an email Google hasn't verified would hand over someone else's account.
- **A learner already linked to a different Google account is refused** (`conflict`), not relinked.
- **The `studio_account` message says the email belongs to a studio account.** Only someone who has just proved to Google that they control that address can see it.

## Tests

The final code passed every suite. After that run, only the README and this note changed.

| Suite | Result |
|---|---|
| `npm test` | 177 pass (was 168; +9 in `test/http.google.test.ts`) |
| `rls_proof.sql` | 59 PASS (section 21: both tables forced; a state written and never read back; another academy can't plant or see one; take works once; a handoff can't be seen or redeemed by another academy) |
| `test:studio` | 75 PASS |
| `test:migrate` | PASS, 26 tables with RLS forced |
| `test:demo-seed` | PASS |
| `test:e2e` | 86 pass (was 74; +12 in `e2e/google.spec.ts`, at 390 and 1280) |

**What `test/http.google.test.ts` covers:**
- **The start:** its parameters (the scope, S256, the one redirect URI) and the binding cookie.
- **A new learner:** created as `registered` with the referral code and Google's name, and no studio role.
- **Linking an existing learner:** the password is cleared, the old session and password login stop working, and the audit records it. The learner is found again by Google id after changing their Google email.
- **Cross-academy:** a Northgate code taken to Sable gets `expired`, no session and no account. It still redeems at Northgate afterwards.
- **A replayed handoff code** gets `expired`. So does a missing or foreign binding cookie, and neither uses up the code. So does a code older than 60 seconds.
- **A replayed or unknown callback state** gets the 400 page that names no academy.
- **The failure reasons:** `expired` state, `cancelled` (the state is spent), `studio_account` (nothing linked, the password untouched, audited), `unverified`, `conflict`, and `unavailable`.
- **Host rules:** the callback answers only on its host.
- **Start-up refusals:** the console's host, an academy's host, and localhost in production. Localhost in development gives an `http` redirect. With Google off, the button is gone and the routes answer 404.

**What `e2e/google.spec.ts` covers.** It uses a local stand-in (`test/fakeGoogleServer.ts`) that enforces the registered redirect, the client secret, and the PKCE verifier. In GTL and Meridian:
- sign-up through Google lands on `/onboarding` with the referral code and name;
- Cancel returns to `/signin` with the message focused, and passes axe, the keyboard focus ring, and reduced motion;
- the button works by keyboard;
- the callback host serves no pages.

## Not done

- **Not tried against the real Google.** Everything above ran against stand-ins, because I don't have your client. To try it: put the development `.env` above in place, run `npm run demo`, open `http://gtl.academy.test:3100/signin` and choose Continue with Google.
- **Not merged.** `google-signin` sits on top of `module-4b`, and neither is merged to `main`.
