FROM node:22.21.0-bookworm-slim AS deps
ARG NPM_STRICT_SSL=true
WORKDIR /app
COPY package.json package-lock.json ./
# CI leaves NPM_STRICT_SSL at true. The retry uses that same setting.
RUN npm ci || npm ci --strict-ssl="$NPM_STRICT_SSL"

FROM node:22.21.0-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_AZURE_CLIENT_ID
ARG NEXT_PUBLIC_AZURE_TENANT_ID
ENV NEXT_PUBLIC_AZURE_CLIENT_ID=$NEXT_PUBLIC_AZURE_CLIENT_ID
ENV NEXT_PUBLIC_AZURE_TENANT_ID=$NEXT_PUBLIC_AZURE_TENANT_ID
RUN npm run build

FROM node:22.21.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
