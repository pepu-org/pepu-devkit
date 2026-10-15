# PEPU paymaster v1 policy service (build context = this directory).
#
#   docker build -t pepu/policy-service:local services/paymaster/policy-service
#
# Hosting rules baked into this image:
#   - Node 22 (22.21.1-bookworm-slim, tag verified on Docker Hub 2026-10-09);
#     the code needs >= 22.5 for node:sqlite, which is flag-free from 22.13.
#   - Runs as the unprivileged `node` user (uid 1000) with `node dist/index.js`.
#   - ALL state lives in the /data volume (DB_PATH=/data/policy.db): event log,
#     audit trail, circuit-breaker state, reconciler cursor. Mount a persistent
#     volume there, or caps and idempotency reset on every redeploy.
#   - SINGLE REPLICA ONLY. Cap accounting assumes one process owns the SQLite
#     file (see README "Spend accounting"). Never run two containers on one
#     volume and never put this behind a load balancer with more than one
#     backend. Redeploys stop the old container before starting the new one.
#   - No secrets in the image. The signer key, Privy secret, admin token and RPC
#     URL arrive as env vars or as secret files (PAYMASTER_SIGNER_PRIVATE_KEY_FILE
#     and friends, e.g. Docker secrets under /run/secrets). deploy/.keys.env is
#     never read when NODE_ENV=production.
#   - .dockerignore keeps .env*, data/, *.db, key files and tests out of the context.

FROM node:22.21.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npx tsup && npm prune --omit=dev --no-audit --no-fund

FROM node:22.21.1-bookworm-slim
ENV NODE_ENV=production \
    PORT=8788 \
    DB_PATH=/data/policy.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Default production-safe config (NO local-dev key). Real deployments mount their own
# files and set APPS_CONFIG_PATH / ALLOWLIST_CONFIG_PATH (see deploy/hosting).
COPY config/allowlist.json config/apps.json ./config/
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8788

# /health is cheap liveness. Readiness (DB + RPC + deposit) is /ready, polled by the monitor.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/index.js"]
