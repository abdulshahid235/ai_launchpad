#!/bin/sh
# Registers the app with the catalog. The CI OIDC token is CI_OIDC_TOKEN. Do not print it.
set -eu
: "${CATALOG_URL:?CATALOG_URL is not set.}"
: "${CI_OIDC_TOKEN:?CI_OIDC_TOKEN is not set.}"
: "${OWNER_OBJECT_ID:?OWNER_OBJECT_ID is not set.}"
APP_NAME=$(awk '/^name:/{gsub(/["\r]/, "", $2); print $2; exit}' app.yaml)
if [ -z "${APP_NAME}" ]; then
  echo "app.yaml has no name." >&2
  exit 1
fi
export APP_NAME
: "${APP_DESCRIPTION:?APP_DESCRIPTION is not set.}"
: "${APP_URL:?APP_URL is not set.}"
: "${REVISION:?REVISION is not set.}"
node --input-type=module -e '
const names = ["CATALOG_URL", "CI_OIDC_TOKEN", "APP_NAME", "OWNER_OBJECT_ID", "APP_DESCRIPTION", "APP_URL", "REVISION"];
for (const name of names) {
  if (!process.env[name]) {
    console.error(name + " is not set.");
    process.exit(1);
  }
}
const url = process.env.CATALOG_URL.replace(/\/$/, "") + "/api/apps";
const response = await fetch(url, {
  method: "POST",
  headers: {
    authorization: "Bearer " + process.env.CI_OIDC_TOKEN,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    name: process.env.APP_NAME,
    owner_object_id: process.env.OWNER_OBJECT_ID,
    description: process.env.APP_DESCRIPTION,
    url: process.env.APP_URL,
    revision: process.env.REVISION,
  }),
});
const text = await response.text();
if (response.status !== 200 && response.status !== 201) {
  console.error(String(response.status));
  console.error(text);
  process.exit(1);
}
console.log(String(response.status));
'
