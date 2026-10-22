FROM node:22-trixie-slim AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @kintsugi/api... build \
    && pnpm --filter @kintsugi/portal build

FROM node:22-trixie-slim

ARG KINTSUGI_BUILD_COMMIT=unknown
ARG KINTSUGI_BUILD_TIME=

ENV NODE_ENV=production \
    KINTSUGI_BUILD_COMMIT=$KINTSUGI_BUILD_COMMIT \
    KINTSUGI_BUILD_TIME=$KINTSUGI_BUILD_TIME \
    PORT=3000 \
    KINTSUGI_PORTAL_DIR=/app/apps/portal/dist

RUN groupadd --system --gid 10001 kintsugi \
    && useradd --system --uid 10001 --gid 10001 --home-dir /app --no-create-home kintsugi \
    && apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/ /app/
USER 10001:10001

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
