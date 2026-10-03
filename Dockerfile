# syntax=docker/dockerfile:1

# ---- build: compile deps for glibc/Debian 12 (same as the runtime), build the SPA,
# ---- and assemble the final filesystem tree under /out ----
# Runs on the build host's platform (no QEMU for the arm64 image): the only native server
# dependency, better-sqlite3, ships prebuilds for every platform inside its package, and
# the web toolchain (esbuild, lightningcss, tailwind oxide) only runs here, never in the image.
FROM --platform=$BUILDPLATFORM docker.io/library/node:24-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# --ignore-scripts (install and deploy): no node-gyp rebuild of better-sqlite3 (no toolchain
# here; its shipped prebuilds are used).
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @replaymark/web build
# Production deps of the server only, then assemble the runtime tree. The app tree stays
# root-owned and read-only for the runtime user; only /data is writable (owner and group 0
# get the same rights so an arbitrary UID with GID 0, OpenShift style, can write it).
RUN pnpm --filter @replaymark/server deploy --prod --ignore-scripts /deploy \
 && mkdir -p /out/app/apps/server /out/app/apps/web /out/rw/data \
 && cp -r /deploy/node_modules /deploy/package.json /out/app/apps/server/ \
 && cp -r apps/server/src apps/server/drizzle /out/app/apps/server/ \
 && cp -r apps/web/dist /out/app/apps/web/dist \
 && cd /out/app/apps/server/node_modules/.pnpm \
 && rm -rf @types+* node-addon-api@* undici-types@* \
 && cd better-sqlite3@*/node_modules/better-sqlite3 \
 && rm -rf deps src build binding.gyp \
 && rm -f prebuilds/darwin-* prebuilds/win32-* prebuilds/linuxmusl-* \
 && cd /app \
 && find /out -xtype l -delete \
 && find /out/app/apps/server/node_modules -name '*.d.ts' -delete -o -name '*.d.mts' -delete -o -name '*.d.cts' -delete \
 && find /out -name '*.map' -delete \
 && chmod -R go-w /out/app \
 && chmod 0775 /out/rw/data

# ---- runtime: distroless Node 24 (glibc, Debian 12), no shell, UID 1000, GID 0 ----
FROM gcr.io/distroless/nodejs24-debian12:nonroot AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="replaymark" \
      org.opencontainers.image.description="Self-hosted Twitch stream notifier: mails you when followed streamers go live in games you care about, with a timeline and VOD links." \
      org.opencontainers.image.source="https://github.com/replaymark/replaymark" \
      org.opencontainers.image.url="https://github.com/replaymark/replaymark" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production DATA_DIR=/data \
    PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COPY --from=build --chown=0:0 /out/app /app
COPY --from=build --chown=1000:0 /out/rw/ /
USER 1000:0
WORKDIR /app/apps/server
VOLUME /data
EXPOSE 8080 8081
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:8082/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["src/index.ts"]
