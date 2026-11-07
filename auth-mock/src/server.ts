import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { findByEmail, findByOid, SEED_USERS } from "./users";

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env") });

// oidc-provider >=9 expects Node 22 URL.parse. Keep the local demo runnable on Node 20.
if (typeof URL.parse !== "function") {
  // @ts-expect-error Node 20 polyfill
  URL.parse = (input: string | URL, base?: string | URL) => {
    try {
      return new URL(input, base);
    } catch {
      return null;
    }
  };
}

const { default: Provider, errors } = await import("oidc-provider");
type Configuration = import("oidc-provider").Configuration;
type KoaContextWithOIDC = import("oidc-provider").KoaContextWithOIDC;

const issuer = (process.env.AUTH_ISSUER || "http://127.0.0.1:9100").replace(
  /\/$/,
  "",
);
const audience = process.env.AUTH_AUDIENCE || "api://catalog-local";
const clientId = process.env.AZURE_SPA_CLIENT_ID || "catalog-local";
const port = Number(new URL(issuer).port || 9000);

const redirectUris = [
  "http://127.0.0.1:3000/auth/callback",
  "http://localhost:3000/auth/callback",
  "http://catalog.localhost:8080/auth/callback",
];

const configuration: Configuration = {
  clients: [
    {
      client_id: clientId,
      token_endpoint_auth_method: "none",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  ],
  cookies: {
    keys: [process.env.AUTH_MOCK_COOKIE_KEY || "launchpad-local-cookie-key"],
  },
  features: {
    devInteractions: { enabled: false },
    resourceIndicators: {
      enabled: true,
      defaultResource: async () => audience,
      getResourceServerInfo: async () => ({
        scope: "access_as_user openid profile",
        audience,
        accessTokenFormat: "jwt",
        jwt: { sign: { alg: "RS256" } },
      }),
      useGrantedResource: async () => true,
    },
  },
  scopes: ["openid", "profile", "access_as_user", "offline_access"],
  claims: {
    openid: ["sub"],
    profile: ["name", "preferred_username", "email"],
  },
  ttl: {
    AccessToken: 3600,
    AuthorizationCode: 600,
    IdToken: 3600,
    RefreshToken: 86400,
    Interaction: 600,
    Session: 86400,
  },
  findAccount: async (_ctx, id) => {
    const user = findByOid(id);
    if (!user) return undefined;
    return {
      accountId: user.oid,
      async claims() {
        return {
          sub: user.oid,
          oid: user.oid,
          name: user.name,
          preferred_username: user.email,
          email: user.email,
          idtyp: "user",
          scp: "access_as_user",
        };
      },
    };
  },
  extraTokenClaims: async (_ctx, token) => {
    const user = findByOid(String(token.accountId));
    if (!user) return {};
    return {
      oid: user.oid,
      idtyp: "user",
      scp: "access_as_user",
      name: user.name,
      preferred_username: user.email,
      azp: clientId,
    };
  },
  renderError: async (ctx, out, error) => {
    ctx.type = "html";
    ctx.body = `<!doctype html><html><body><h1>Auth error</h1><pre>${escapeHtml(
      JSON.stringify({ ...out, error: String(error) }, null, 2),
    )}</pre></body></html>`;
  },
};

const provider = new Provider(issuer, configuration);
provider.proxy = true;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function loginPage(uid: string, error = ""): string {
  const options = SEED_USERS.map(
    (user) =>
      `<option value="${escapeHtml(user.email)}">${escapeHtml(user.email)} — ${escapeHtml(user.name)}</option>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>App Launchpad sign-in</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; }
    label { display: block; margin: 0.75rem 0 0.25rem; }
    select, input, button { width: 100%; padding: 0.5rem; font: inherit; }
    button { margin-top: 1rem; cursor: pointer; }
    .error { color: #a40000; }
    .hint { color: #555; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Sign in</h1>
  <p class="hint">Local mock users. Password for each is <code>password</code>.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  <form method="post" action="/interaction/${encodeURIComponent(uid)}/login">
    <label for="login">User</label>
    <select id="login" name="login" required>${options}</select>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" value="password" required />
    <button type="submit">Continue</button>
  </form>
</body>
</html>`;
}

provider.on("server_error", (_ctx, error) => {
  console.error("oidc server_error", error);
});

const oidc = provider.callback();

async function grantConsent(
  interaction: Awaited<ReturnType<Provider["interactionDetails"]>>,
): Promise<string> {
  let grantId = interaction.grantId;
  const grant = grantId
    ? await provider.Grant.find(grantId)
    : new provider.Grant({
        accountId: interaction.session!.accountId,
        clientId: interaction.params.client_id as string,
      });
  if (!grant) {
    throw new Error("grant missing");
  }
  if (interaction.prompt.details.missingOIDCScope) {
    const missing = interaction.prompt.details.missingOIDCScope as string[];
    grant.addOIDCScope(missing.join(" "));
  }
  if (interaction.prompt.details.missingResourceScopes) {
    for (const [resource, scopes] of Object.entries(
      interaction.prompt.details.missingResourceScopes as Record<
        string,
        string[]
      >,
    )) {
      grant.addResourceScope(resource, scopes.join(" "));
    }
  }
  grantId = await grant.save();
  return grantId;
}

function readForm(
  req: import("node:http").IncomingMessage,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const params = new URLSearchParams(raw);
      const out: Record<string, string> = {};
      for (const [key, value] of params.entries()) out[key] = value;
      resolve(out);
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${port}`;
    const url = new URL(req.url || "/", `http://${host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/interaction/") &&
      !url.pathname.endsWith("/login")
    ) {
      const uid = url.pathname.split("/")[2] || "";
      const interaction = await provider.interactionDetails(req, res);
      if (interaction.prompt.name === "login") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(loginPage(uid));
        return;
      }
      if (interaction.prompt.name === "consent") {
        await provider.interactionFinished(
          req,
          res,
          {
            consent: {
              grantId: await grantConsent(interaction),
            },
          },
          { mergeWithLastSubmission: true },
        );
        return;
      }
    }

    if (
      req.method === "POST" &&
      /^\/interaction\/[^/]+\/login$/.test(url.pathname)
    ) {
      const uid = url.pathname.split("/")[2] || "";
      const body = await readForm(req);
      const user = findByEmail(body.login || "");
      if (!user || body.password !== user.password) {
        res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
        res.end(loginPage(uid, "Sign-in failed. Use a seed user and password."));
        return;
      }
      await provider.interactionFinished(
        req,
        res,
        {
          login: {
            accountId: user.oid,
            remember: false,
          },
        },
        { mergeWithLastSubmission: false },
      );
      return;
    }

    return oidc(req, res);
  } catch (error) {
    if (error instanceof errors.SessionNotFound) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Session not found");
      return;
    }
    // [DEBUG] auth-mock request failed — check issuer URL, redirect_uri, and interaction uid
    console.error("auth-mock request failed", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("auth-mock error");
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`auth-mock listening on ${issuer}`);
  console.log(
    `seed users: ${SEED_USERS.map((user) => user.email).join(", ")} (password)`,
  );
  void 0 as KoaContextWithOIDC;
});
