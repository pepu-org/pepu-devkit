# Caddy with the per-IP rate-limit module compiled in (it is not part of stock Caddy).
# caddy:2.10.2 (and its -builder variant) exist on Docker Hub (checked 2026-10-09).
# The module is fetched at build time with xcaddy; pin it to a commit/tag for fully
# reproducible builds once you have built successfully once:
#   --with github.com/mholt/caddy-ratelimit@<tag-or-commit>
#
# NOT YET EXECUTED (no Docker daemon where this was written). First check after build:
#   docker run --rm pepu/caddy-ratelimit:2.10.2 caddy list-modules | grep rate_limit

FROM caddy:2.10.2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2.10.2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
