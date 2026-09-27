# One image for the API, the relay, the front end and the migrate step.
# No secret is ever in it: everything secret arrives as environment at
# `docker compose up`, from deploy/.env on the server.

FROM node:20.20.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npx next build studio && npm prune --omit=dev --no-audit --no-fund

FROM node:20.20.2-bookworm-slim
# psql 16 for the migrations and the seed, from the PostgreSQL project's own repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
# A new named volume takes this directory's owner, so the demo team's file is writable by node.
RUN mkdir /demo && chown node:node /demo
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/studio ./studio
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/deploy/migrate.sh /app/deploy/role_passwords.sql ./deploy/
USER node
