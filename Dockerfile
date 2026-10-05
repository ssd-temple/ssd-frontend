# SSD Frontend — Next.js 16, pnpm, standalone output
# Multi-stage build: install deps, build the app, then copy only the traced
# standalone output into a minimal runtime image (no full node_modules).

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, and
# .dockerignore excludes .env*, so they must be passed as --build-arg.
ARG NEXT_PUBLIC_AUTH_API_BASE_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_NETS_SERVICE_URL=http://localhost:2003
ENV NEXT_PUBLIC_AUTH_API_BASE_URL=$NEXT_PUBLIC_AUTH_API_BASE_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_NETS_SERVICE_URL=$NEXT_PUBLIC_NETS_SERVICE_URL
# Needs output: "standalone" set in next.config.ts (already added).
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
