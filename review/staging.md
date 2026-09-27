# Staging: one Ubuntu server, compose and Caddy

## Where things stand

- **`main`:** fast-forwarded to `27cfc4d` and pushed. `module-4b` and `google-signin` are both on it; neither needed a merge commit.
- **`staging-deploy`:** branched from that `main`. Five commits, pushed:

| Commit | What |
|---|---|
| `5858b33` | The edge server believes exactly one proxy, the one presenting `PROXY_SECRET`. It answers `/healthz` itself. |
| `b7f4349` | The API gets `GET /healthz`, and an internal listener (`TLS_ASK_PORT`) that answers Caddy's on-demand TLS question. |
| `6770c05` | `src/outbox/main.ts` runs the relay. `npm run worker` pointed at a file that didn't exist. `stop()` now waits for the pass under way. |
| `482d7a8` | The demo seed takes `-v demo_domain=`, and the team takes `DEMO_DOMAIN`. |
| `2acbde5` | `deploy/`: the Dockerfile, `compose.yml`, `Caddyfile`, `deploy.sh`, `migrate.sh`, `role_passwords.sql` and `.env.example`. Plus the README section. |

**`staging-deploy` is not merged to `main`.** You asked me to merge the other two branches, not this one, and `deploy.sh` deploys `main`. So step 0 below is that merge, after you've read the branch.

The decisions you made are all in:
- on-demand TLS, not a DNS-challenge wildcard;
- the seed runs once on first boot, and `--reseed` runs it again;
- Postgres is never restarted by a deploy, while the app restarts behind Caddy with a 20-second hold;
- a separate Google client for staging.

## What was tested, and what wasn't

**Every suite passed on the final code:**

| Suite | Result |
|---|---|
| `npm test` | 189 pass. It was 177; the 12 new tests are 6 edge, 5 TLS-ask and 1 relay-stop. |
| RLS proof | 59 PASS |
| Studio proof | 75 PASS |
| `test:migrate` | PASS, 26 tables |
| `test:demo-seed` | PASS, including the new check that a staging domain moves the three academies in place |
| e2e | 86 pass |

Two notes on those runs:
- **Where step 1's run stands.** Its e2e run hit one failure. The lesson test measured the rationale's height in the same instant it started to unfold; the test now waits for the unfold. It's in the step-1 commit, and step 1's full run was otherwise green.
- **Steps 2 to 5 were run once, together.** They were committed one at a time after that run, so each commit was not run on its own.

**The whole chain, run locally.** This test:
- uses the real `deploy/Caddyfile`, rewritten by `sed` to three things: Caddy's local CA instead of Let's Encrypt, ports 8080/8443, and 127.0.0.1 upstreams;
- runs in front of the real edge server and API, against `academy_demo`;
- passed 14 of 14:
  - academies are served over https, and the API works through the chain;
  - http gets a 308 to https, keeping the host and path;
  - the console answers 401 without basic auth and reaches its sign-in with it, and its API is behind basic auth too;
  - the callback host gets a certificate and no pages;
  - a stranger host and an unknown domain get no certificate;
  - a client's own secret header and `X-Forwarded-For` are overwritten by Caddy;
  - the edge refuses a wrong secret sent to it directly;
  - responses carry `noindex`.
- Caddy obtained exactly four certificates: gtl, meridian, console and auth.

**`deploy/migrate.sh`, run three times against a throwaway `*_staging` database:**
- **First boot** seeds the academies on the staging domain.
- **A redeploy** skips the seed and keeps a lesson edited in the studio.
- **`RESEED=1`** puts the lesson back.
- The role-password step ran against your local cluster with the placeholder password the roles already had, so nothing there changed.

**Also checked:** `docker compose config` accepts `compose.yml`, and a bcrypt hash in `.env` survives as a literal. `caddy validate` accepts the Caddyfile.

**Not tested: the image.** Your Mac's disk is full.
- The data volume had about 7 GB free before this work. My image build pushed it to 82 MB, and Docker's VM then hit input/output errors partway through the build.
- Docker also holds your other projects' data: the docverify containers and database volume, and a Supabase volume. So I didn't touch its disk file. I restarted Docker Desktop, and space recovered to about 2 GB, but Docker Desktop didn't finish quitting and may need a restart from its menu.

So the first deploy on the server is the first time these run:
- the image build;
- the psql 16 install inside it;
- the containers running with read-only root filesystems. Next.js is the likeliest to object. If it does, the fix is to drop `read_only` from the `frontend` service.
- the `/demo` volume's ownership, which is fixed in the Dockerfile but not seen working.

The real Let's Encrypt issuance and the Ubuntu commands below also run for the first time on the server.

## What changed in how things run

- **The front end's edge server** keeps `X-Forwarded-For` only from a request carrying the right `X-Academy-Proxy-Secret`, which in staging is Caddy. A wrong secret gets a 400. With no secret it uses the socket's address, as before, and the secret never reaches Next.js. This closes the README's first "before production" item, which is now removed.
- **Caddy's TLS question** is answered on port 3001. Only Caddy can reach that port, on the `ask` network. The answer is yes only for:
  - an active academy's domain, looked up exactly as the tenant scope does it;
  - the console host;
  - the Google callback host.

  A suspended academy is refused. A broker's own verified domain gets a certificate on its first visit.
- **Containers:** each gets only the secrets it needs. Postgres is reachable only from the `data` network: the migrate step, the API and the relay. Only Caddy publishes ports. The front end can't reach the database.

## The commands, in order

Replace `<ip>` with the server's address.

### 0. On your machine: merge this branch into main

```
git checkout main
git merge --ff-only staging-deploy
git push origin main
```

### 1. DNS (at your DNS provider)

- `A     *.academy-staging.globaltutoringlab.com   <ip>`
- If the server has IPv6: `AAAA  *.academy-staging.globaltutoringlab.com   <ipv6>`

Then check it from anywhere:

```
dig +short gtl.academy-staging.globaltutoringlab.com
dig +short auth.academy-staging.globaltutoringlab.com
```

Both should print `<ip>`. No DNS API token is needed; certificates are issued over HTTP and TLS.

### 2. Google Cloud console: the staging client

1. **Credentials → Create credentials → OAuth client ID.** Type **Web application**, name "Academy staging".
2. **Authorized JavaScript origins:** none.
3. **Authorized redirect URIs:** exactly `https://auth.academy-staging.globaltutoringlab.com/api/auth/google/callback`
4. **Consent screen:** `globaltutoringlab.com` is an authorized domain, and the scopes are only `openid`, `email` and `profile`. While it is in Testing, add each tester under **Test users**.
5. Keep the client ID and secret for step 5.

### 3. On the server, as a sudo user: Docker, firewall, deploy user

```
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl git ufw unattended-upgrades

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable

sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /srv/academy /srv/backups
sudo chown deploy:deploy /srv/academy /srv/backups
```

Only Caddy publishes ports. Docker's own rules sit in front of ufw for published ports, which is why nothing else publishes any.

### 4. As `deploy`: the code

```
sudo -iu deploy
ssh-keygen -t ed25519 -N "" -f ~/.ssh/academy_deploy -C "academy staging deploy key"
cat ~/.ssh/academy_deploy.pub
```

On GitHub, go to **Sihaf12/pocketfoliolms → Settings → Deploy keys → Add deploy key**, paste the key, and leave "Allow write access" off. Then:

```
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/academy_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
git clone git@github.com:Sihaf12/pocketfoliolms.git /srv/academy
```

### 5. As `deploy`: the secrets

```
cd /srv/academy
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
for k in POSTGRES_PASSWORD APP_USER_PASSWORD APP_CONTROL_PASSWORD APP_STUDIO_PASSWORD APP_CONSOLE_PASSWORD PROXY_SECRET; do
  sed -i "s|^$k=\$|$k=$(openssl rand -hex 32)|" deploy/.env
done
sed -i "s|^CONSOLE_TOTP_KEY=\$|CONSOLE_TOTP_KEY=$(openssl rand -base64 32)|" deploy/.env
docker run --rm -it caddy:2.10.2-alpine caddy hash-password
```

The last command asks for the console's basic-auth password twice and prints a hash starting `$2a$14$`. Then open the file:

```
nano deploy/.env
```

Fill in these five lines:

```
ACME_EMAIL=<an address Let's Encrypt can write to>
CONSOLE_BASIC_USER=<a user name>
CONSOLE_BASIC_HASH='<the hash, inside the single quotes>'
GOOGLE_CLIENT_ID=<the staging client id>
GOOGLE_CLIENT_SECRET=<the staging client secret>
```

Keep the single quotes around the hash: without them compose reads its `$` signs as variables. Then check nothing is left empty:

```
grep -nE "=$|=''$" deploy/.env
```

It should print nothing. Keep a copy of `deploy/.env` somewhere safe: it holds the only copy of the database passwords and of the key that seals the console's TOTP secrets.

### 6. As `deploy`: the first deploy

```
cd /srv/academy
deploy/deploy.sh
```

The first run:
- builds the image;
- starts Postgres;
- migrates, sets the role passwords, seeds the academies on `*.academy-staging.globaltutoringlab.com`, and makes the demo team;
- starts the API, the relay, the front end and Caddy;
- then checks the sites.

Each host's first request waits a few seconds while its certificate is issued. The run ends with `Deployed <commit>`.

### 7. As `deploy`: the team's sign-in details

```
cd /srv/academy
alias dc='docker compose -f deploy/compose.yml --env-file deploy/.env'
dc run --rm --no-deps migrate cat /demo/team.json
dc run --rm --no-deps migrate node dist/src/cli/demoTeam.js --code
```

`team.json` holds:
- the shared password;
- admin@, author@, reviewer@ and compliance@ each academy's domain;
- the console's owner@, author@, reviewer@ and compliance@ `console.academy-staging.globaltutoringlab.com`.

The second command prints the owner's current console code. Each code works once.

### 8. Open it

- **The academies:** `https://gtl.academy-staging.globaltutoringlab.com/`, `https://pocketfolio.…/` and `https://meridian.…/`.
- **Their studios:** `/studio` on each.
- **The console:** `https://console.academy-staging.globaltutoringlab.com/`. Basic auth first, then the owner's email, password and code.
- **Google sign-in:** Continue with Google on any academy's `/signin`, as one of the test users from step 2.

### 9. From then on

```
cd /srv/academy && deploy/deploy.sh             # deploy main
cd /srv/academy && deploy/deploy.sh --reseed    # also put the seeded lessons back
```

- **Roll back:** `deploy.sh` prints the rollback command for the build before. It works only if no migration since that build needs the new code.
- **Logs and status:** `dc logs -f api` (or `relay`, `frontend`, `caddy`, `db`), and `dc ps`.

### 10. Optional: nightly database backups, kept two weeks

```
crontab -e
```

Add:

```
15 3 * * * docker exec academy-db-1 pg_dump -U academy_owner -Fc academy_staging > /srv/backups/academy-$(date +\%F).dump && find /srv/backups -name 'academy-*.dump' -mtime +14 -delete
```

## Things to know

- **Let's Encrypt's limit** is 50 certificates a week for `globaltutoringlab.com` as a whole, subdomains included. The `caddy_data` volume keeps the certificates, so never delete it. `docker compose down` keeps volumes; only `down -v` would lose them.
- **Postgres is pinned to 16.4.** Upgrading it is a manual job: dump, new volume, restore. No deploy does it.
- **The console's own sign-in and TOTP** still apply behind basic auth.
- **The demo team is refreshed on every deploy** from `/demo/team.json`, so its password stays the same across deploys.
- **The README's other "before production" items** still stand. Among them, `tls_state` isn't updated by domain changes, even though Caddy now issues certificates on demand.
