#!/bin/sh
# Builds the container image. IMAGE is the full registry reference.
set -eu
: "${IMAGE:?IMAGE is not set.}"
: "${NEXT_PUBLIC_AZURE_CLIENT_ID:?NEXT_PUBLIC_AZURE_CLIENT_ID is not set.}"
: "${NEXT_PUBLIC_AZURE_TENANT_ID:?NEXT_PUBLIC_AZURE_TENANT_ID is not set.}"
docker build \
  --build-arg "NEXT_PUBLIC_AZURE_CLIENT_ID=${NEXT_PUBLIC_AZURE_CLIENT_ID}" \
  --build-arg "NEXT_PUBLIC_AZURE_TENANT_ID=${NEXT_PUBLIC_AZURE_TENANT_ID}" \
  -t "$IMAGE" \
  .
