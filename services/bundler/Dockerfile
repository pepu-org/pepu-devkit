# Alto ERC-4337 bundler for PEPU mainnet (chain 97741), built from the npm
# package that was actually proven live: @pimlico/alto 0.0.21 (pinned by
# package.json + package-lock.json), on Node 24.4.1, the exact Node version
# of the proof-of-run recorded in README.md. The previously referenced
# ghcr.io/pimlicolabs/alto:v1.2.8 image is alto 0.0.20, one version behind, so
# it is NOT used.
#
# Both tags below were confirmed to exist on Docker Hub (2026-10-09). Bump Node
# deliberately, re-run the README "Proof of life" checks, then change the pin.
#
# This image has NO secrets in it. RPC URL and executor keys arrive at runtime
# as env vars or, preferably, as mounted secret files (ALTO_RPC_URL_FILE,
# ALTO_EXECUTOR_PRIVATE_KEYS_FILE), see docker-entrypoint.sh.
#
# NOT YET EXECUTED: no Docker daemon was available where this was written.
# `docker build` + the smoke tests in deploy/hosting/RUNBOOK.md are the proof.

FROM node:24.4.1-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Lockfile install: alto 0.0.21 and its whole tree exactly as proven.
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24.4.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# Production config: enable-cors is false because the Caddy proxy in front owns
# CORS with an Origin allowlist (Alto's flag is boolean-only and reflects ANY
# origin). Local standalone use mounts alto.config.json over this file.
COPY alto.config.prod.json ./alto.config.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh

# Non-root (uid/gid 1000, provided by the official image).
USER node
EXPOSE 4337
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4337/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["--config", "/app/alto.config.json"]
