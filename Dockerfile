# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine

# ── Build (runs natively; the output is platform-independent JavaScript) ──
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# ── Runtime: just Node + one bundled JS file + the static web UI ──
FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="Torboxed" \
      org.opencontainers.image.description="Self-hosted TorBox downloader with a qBittorrent-compatible API for Sonarr & Radarr" \
      org.opencontainers.image.source="https://github.com/scopeddlol/torboxed" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    TORBOXED_DOCKER=1 \
    TORBOXED_DATA=/config \
    TORBOXED_DOWNLOADS=/downloads \
    TORBOXED_PORT=8080 \
    PUID=1000 \
    PGID=1000 \
    UMASK=002
COPY --from=build /app/dist ./dist
RUN mkdir -p /config /downloads
VOLUME ["/config", "/downloads"]
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${TORBOXED_PORT}/api/health" >/dev/null || exit 1
# Starts as root only long enough to fix volume ownership, then drops to PUID:PGID.
CMD ["node", "dist/server/index.cjs"]
