# The server and web UI in one image. Build from the repo root; ops/home-server runs it.
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3917 \
    DB_PATH=/data/ess-robber-intel.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3917
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3917/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# node is PID 1, so `docker stop` delivers SIGTERM straight to main.ts's graceful shutdown.
CMD ["node", "dist/server/main.js"]
