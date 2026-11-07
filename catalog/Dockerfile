# [HNI-INFRA-06] Multi-stage image. The runner has no toolchain and no test files.
# [HNI-CICD-10] BASE_IMAGE is the Node image already imported into this environment's ACR.
# There is no Docker Hub default. Pass it as a build-arg.
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS deps
ARG NPM_STRICT_SSL=true
WORKDIR /app
COPY package.json package-lock.json ./
# CI leaves NPM_STRICT_SSL at true. The retry uses that same setting.
RUN npm ci || npm ci --strict-ssl="$NPM_STRICT_SSL"

FROM ${BASE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${BASE_IMAGE} AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
COPY migrations ./migrations
RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser \
    && chown -R appuser:appgroup /app
USER appuser
CMD ["node", "scripts/migrate.mjs"]

FROM ${BASE_IMAGE} AS runner
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
