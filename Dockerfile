# FieldSense — Single Container: API server + production built web app
# Optimized multi-stage Docker build for Railway and production environments

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Cache package installation layers
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

# Copy all source files and build the React frontend
COPY . .
RUN npm run build --workspace web

# Production runner image
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Set default production environment
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist \
    CONTACT_EMAIL=lalit@sensegrass.com \
    NODE_OPTIONS="--experimental-strip-types"

# Copy root package files
COPY --from=build /app/package.json /app/package-lock.json ./

# Copy server application and built web assets
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/web/package.json ./web/

# Install only production dependencies for the server workspace and prepare data directory
RUN npm ci --omit=dev --workspace server && \
    mkdir -p /app/data && \
    chown -R node:node /app

# Expose server port (Railway overrides PORT dynamically at runtime)
EXPOSE 8787

# Mount persistent volume for SQLite cache and saved fields across restarts/deployments
VOLUME ["/app/data"]

# Switch to non-root user for security
USER node

# Healthcheck for Docker/Railway container orchestrator
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
