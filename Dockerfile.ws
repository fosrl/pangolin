# Standalone image that only terminates device WebSockets
# (server/private/wsGatewayServer.ts) and passes everything to Pangolin over the
# regional Redis, so Pangolin can be deployed without bouncing the devices.
#
# Build:  docker build -f Dockerfile.ws -t pangolin-ws .
# Run:    docker run -v ./config:/app/config -p 3010:3010 pangolin-ws
#
# The mounted config directory needs the same privateConfig.yml as the Pangolin
# server (only redis.regional_redis is read), or set REGIONAL_REDIS_HOST,
# REGIONAL_REDIS_PORT, REGIONAL_REDIS_PASSWORD and REGIONAL_REDIS_DB instead.
# Pangolin needs flags.enable_ws_gateway. See docs/ws-gateway.md.

# Mirror of docker.io/library/node, kept in sync by
# .github/workflows/mirror-node.yml (avoids Docker Hub / ECR pull rate limits)
ARG NODE_IMAGE=ghcr.io/fosrl/node:24.22.1-slim

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY package.json ./

# esbuild.mjs marks every npm package external, so bundling needs only the
# bundler's own tooling (at the versions package.json pins), not the full
# dependency tree. Installed outside /app so the root package.json's
# dependencies aren't pulled in with it.
RUN mkdir /tools && cd /tools && echo '{"private": true}' > package.json && \
    npm install --no-audit --no-fund --no-package-lock $(node -p ' \
        const p = require("/app/package.json"); \
        const all = { ...p.dependencies, ...p.devDependencies }; \
        ["esbuild", "esbuild-node-externals", "yargs"] \
            .map((n) => `${n}@${all[n]}`).join(" ")') && \
    ln -s /tools/node_modules /app/node_modules

COPY . .

# The gateway is private code, so only saas/enterprise builds include it
ARG BUILD=enterprise

# Bundle, then write a package.json listing only the packages the bundle
# imports at runtime
RUN npm run set:$BUILD && \
    mkdir -p dist && \
    node esbuild.mjs -e server/private/wsGatewayServer.ts -o dist/ws-gateway.mjs -m dist/ws-gateway.meta.json && \
    node scripts/bundle-package-json.mjs dist/ws-gateway.meta.json /out/package.json

FROM ${NODE_IMAGE} AS deps

WORKDIR /app

# Installing the trimmed package.json against the root lockfile keeps every
# transitive version pinned to what the main Pangolin image ships
COPY --from=builder /out/package.json ./package.json
COPY package-lock.json .npmrc ./

RUN npm install --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runner

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=builder /app/dist/ws-gateway.mjs ./dist/ws-gateway.mjs

ENV ENVIRONMENT=prod
ENV NODE_ENV=production

# WebSocket connections, and the HTTP health check (GET /healthz)
EXPOSE 3010/tcp

ARG VERSION="dev"
ARG REVISION=""
ARG CREATED=""

LABEL org.opencontainers.image.source="https://github.com/fosrl/pangolin" \
      org.opencontainers.image.url="https://github.com/fosrl/pangolin" \
      org.opencontainers.image.documentation="https://docs.pangolin.net" \
      org.opencontainers.image.vendor="Fossorial" \
      org.opencontainers.image.licenses="Fossorial Commercial License" \
      org.opencontainers.image.title="Pangolin WebSocket Gateway" \
      org.opencontainers.image.description="Standalone Pangolin WebSocket gateway" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

CMD ["node", "--enable-source-maps", "dist/ws-gateway.mjs"]
