# =============================================================================
# Trackify.API — Production Dockerfile for Strapi 5
# Multi-stage build: build deps → minimal production image
# =============================================================================

# ---- Build Stage ----
FROM node:20-alpine AS build

WORKDIR /app

# Install build dependencies (python/make for native modules like better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy package manifests first for better layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci --ignore-scripts \
 && npm rebuild --build-from-source

# Copy source code
COPY . .

# Build Strapi admin UI + server
RUN npm run build

# Prune devDependencies after build
RUN npm prune --omit=dev

# ---- Production Stage ----
FROM node:20-alpine AS production

# Install runtime system deps
# - libc6-compat: needed for Alpine compatibility with some native modules
# - curl: for healthchecks
RUN apk add --no-cache libc6-compat curl tini

# Create non-root user
RUN addgroup -g 1001 -S strapi \
 && adduser -S strapi -u 1001 -G strapi

WORKDIR /app

# Copy built artifacts from build stage
COPY --from=build --chown=strapi:strapi /app/package.json ./
COPY --from=build --chown=strapi:strapi /app/package-lock.json ./
COPY --from=build --chown=strapi:strapi /app/node_modules ./node_modules
COPY --from=build --chown=strapi:strapi /app/dist ./dist
COPY --from=build --chown=strapi:strapi /app/config ./config
COPY --from=build --chown=strapi:strapi /app/database ./database
COPY --from=build --chown=strapi:strapi /app/public ./public
COPY --from=build --chown=strapi:strapi /app/favicon.png ./favicon.png
COPY --from=build --chown=strapi:strapi /app/.env.example ./.env.example

# Create tmp directory for uploads (with correct permissions)
RUN mkdir -p /app/public/uploads && chown -R strapi:strapi /app

# Switch to non-root user
USER strapi

# Use tini as init to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Expose Strapi port
EXPOSE 1337

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:1337/_health || exit 1

# Start Strapi in production mode
CMD ["node", "dist/server.js"]
