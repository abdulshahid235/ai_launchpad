#!/bin/sh
# POC Azure login. Reads AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET, AZURE_SUBSCRIPTION_ID.
# ⚠️ [HNI-CRED-05] VIOLATION: service principal client secret. Do not print AZURE_CLIENT_SECRET.
set -eu
: "${AZURE_CLIENT_ID:?AZURE_CLIENT_ID is not set.}"
: "${AZURE_TENANT_ID:?AZURE_TENANT_ID is not set.}"
: "${AZURE_CLIENT_SECRET:?AZURE_CLIENT_SECRET is not set.}"
: "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is not set.}"
az login --service-principal \
  --username "$AZURE_CLIENT_ID" \
  --password "$AZURE_CLIENT_SECRET" \
  --tenant "$AZURE_TENANT_ID" \
  --output none
az account set --subscription "$AZURE_SUBSCRIPTION_ID"
