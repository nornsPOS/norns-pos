# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────────
# Warehouse14 API (api-cloud) — production image. Build context = repo root:
#   docker build -f apps/api-cloud/Dockerfile -t warehouse14-api .
# Multi-stage: a full workspace build, then a slim runtime via `pnpm deploy`.
# Targets linux/arm64 (the Oracle Ampere server) but is arch-agnostic.
# ──────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ── Build the api-cloud dependency graph, then deploy a prod-only subset ────
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
# db must build first: the audit↔db cyclic dep means a clean topo-build would
# compile `audit` before `db`'s dist exists (audit imports db types). db itself
# only references audit in comments, so it compiles standalone.
RUN pnpm --filter @norns/db build
# Build api-cloud + only its workspace dependencies (skips the Tauri frontends).
RUN pnpm --filter "@norns/api-cloud..." build
# Flatten into a self-contained, prod-only deployable at /app.
RUN pnpm --filter=@norns/api-cloud deploy --prod /app

# ── Slim runtime (the API server) ────────────────────────────────────────────
# (Migrations run via the separate psql-based image, infrastructure/docker/migrate.Dockerfile.)
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001 NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=build /app ./
# Normalise read/traverse perms: some source package.json files ship 0600,
# which Node (running as the non-root `node` user) can't read — that silently
# breaks ESM `exports` resolution. Make everything world-readable.
RUN chmod -R go+rX /app
EXPOSE 3001
# Persistent data dirs (mounted as named volumes in prod: photosdata→/data/photos,
# kycdata→/data/kyc). Create + own them as the node user (uid 1000) BEFORE dropping
# privileges so a fresh/empty volume mounts node-writable instead of root:root 0755
# — otherwise writeKycImage / photo-store hit 500 EACCES (mkdir denied) on first use
# after a clean deploy or DR restore. KYC shards stay private (0700).
RUN mkdir -p /data/photos /data/kyc \
  && chown -R 1000:1000 /data \
  && chmod 700 /data/kyc
USER node
# /health is the readiness probe (no DB dependency).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
