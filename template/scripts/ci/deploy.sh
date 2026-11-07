#!/bin/sh
# Updates the tenant container app to IMAGE. The app name is read from app.yaml.
set -eu
: "${IMAGE:?IMAGE is not set.}"
: "${RESOURCE_GROUP:?RESOURCE_GROUP is not set.}"
APP_NAME=$(awk '/^name:/{gsub(/["\r]/, "", $2); print $2; exit}' app.yaml)
if [ -z "${APP_NAME}" ]; then
  echo "app.yaml has no name." >&2
  exit 1
fi
az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE" \
  --output none
