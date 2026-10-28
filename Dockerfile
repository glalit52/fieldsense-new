# syntax=docker/dockerfile:1
# FieldSense: one container serving the API and the built web app (Railway, Fly, any Docker host).

FROM node:22-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/

# ---- build the web app ----
FROM base AS build
# mongodb-memory-server (a test-only dev dependency) would otherwise download mongod during install
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN npm ci
COPY web web
RUN npm run build --workspace web

# ---- production dependencies of the server only ----
FROM base AS deps
RUN npm ci --omit=dev --workspace server && npm cache clean --force

# ---- runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/package.json server/
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/data && chown node:node /app/data

EXPOSE 8787
# Used by `docker run`; Railway uses healthcheckPath from railway.json instead.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Starts as root only to take ownership of the mounted volume, then runs the server as the unprivileged `node` user.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
