#!/bin/sh
# Starts a throwaway Postgres for catalog tests. The password comes from the environment.
set -eu
if [ -z "${CATALOG_TEST_DB_PASSWORD:-}" ]; then
  echo "CATALOG_TEST_DB_PASSWORD is not set."
  exit 1
fi
mkdir -p certs
docker rm -f catalog-test-pg >/dev/null 2>&1 || true
docker run -d --name catalog-test-pg --entrypoint bash \
  -e POSTGRES_USER=catalog \
  -e POSTGRES_PASSWORD="$CATALOG_TEST_DB_PASSWORD" \
  -e POSTGRES_DB=catalog \
  -p 127.0.0.1:5432:5432 \
  postgres:16.10 \
  -c "openssl req -new -x509 -days 1 -nodes -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout /tmp/server.key -out /tmp/server.crt -subj /CN=localhost && chmod 600 /tmp/server.key && chown postgres:postgres /tmp/server.key /tmp/server.crt && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key"
i=0
while [ "$i" -lt 30 ]; do
  if docker cp catalog-test-pg:/tmp/server.crt certs/server.crt 2>/dev/null; then
    break
  fi
  i=$((i + 1))
  sleep 1
done
test -f certs/server.crt
i=0
while [ "$i" -lt 30 ]; do
  if docker exec catalog-test-pg pg_isready -U catalog -d catalog; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "Postgres did not become ready."
exit 1
