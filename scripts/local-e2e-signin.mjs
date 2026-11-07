import { createHash, randomBytes } from "node:crypto";

const issuer = process.env.AUTH_ISSUER || "http://127.0.0.1:9100";
const audience = process.env.AUTH_AUDIENCE || "api://catalog-local";
const clientId = process.env.AZURE_SPA_CLIENT_ID || "catalog-local";
const redirectUri = "http://127.0.0.1:3000/auth/callback";
const catalog = process.env.CATALOG_URL || "http://127.0.0.1:3000";

const jar = new Map();

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() || [];
  for (const item of raw) {
    const [pair] = item.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function request(url, init = {}) {
  const headers = new Headers(init.headers || {});
  if (jar.size > 0) headers.set("cookie", cookieHeader());
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  storeCookies(response);
  return response;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());

const authUrl = new URL("/auth", issuer);
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", "openid profile access_as_user");
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("code_challenge", challenge);
authUrl.searchParams.set("code_challenge_method", "S256");
authUrl.searchParams.set("resource", audience);

let location = authUrl.toString();
for (let i = 0; i < 8; i += 1) {
  const response = await request(location, { method: "GET" });
  const next = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && next) {
    location = new URL(next, location).toString();
    if (location.startsWith(redirectUri)) break;
    continue;
  }
  if (location.includes("/interaction/") && response.status === 200) {
    const uid = new URL(location).pathname.split("/")[2];
    const body = new URLSearchParams({
      login: "tester@hni.test",
      password: "password",
    });
    const login = await request(`${issuer}/interaction/${uid}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const after = login.headers.get("location");
    if (!after) {
      console.error("login had no redirect", login.status, await login.text());
      process.exit(1);
    }
    location = new URL(after, issuer).toString();
    continue;
  }
  console.error("unexpected step", response.status, location);
  process.exit(1);
}

const code = new URL(location).searchParams.get("code");
if (!code) {
  console.error("no code in", location);
  process.exit(1);
}

const tokenResponse = await fetch(`${issuer}/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: audience,
  }),
});
const tokenBody = await tokenResponse.json();
if (!tokenResponse.ok || !tokenBody.access_token) {
  console.error("token failed", tokenResponse.status, tokenBody);
  process.exit(1);
}

const apps = await fetch(`${catalog}/api/apps`, {
  headers: { authorization: `Bearer ${tokenBody.access_token}` },
});
const appsBody = await apps.json();
console.log(
  JSON.stringify(
    {
      token_ok: true,
      apps_status: apps.status,
      apps: appsBody,
    },
    null,
    2,
  ),
);
if (apps.status !== 200) process.exit(1);
