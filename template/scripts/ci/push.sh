#!/bin/sh
# Pushes IMAGE to ACR. Uses the Azure session from login.sh.
set -eu
: "${IMAGE:?IMAGE is not set.}"
: "${ACR_NAME:?ACR_NAME is not set.}"
az acr login --name "$ACR_NAME" --output none
docker push "$IMAGE"
