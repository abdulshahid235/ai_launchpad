import { createServer, request as httpRequest } from "node:http";
import { readFileSync, watchFile } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { bearerFromHeader, verifyAccessToken } from "./auth";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv({ path: join(root, ".env") });

const port = Number(process.env.PROXY_PORT || 8080);
const authMockUrl = (
  process.env.AUTH_MOCK_URL ||
  process.env.AUTH_ISSUER ||
  "http://127.0.0.1:9100"
).replace(/\/$/, "");
const catalogUpstream =
  process.env.CATALOG_UPSTREAM || "http://127.0.0.1:3000";
const routesFile = resolve(
  root,
  process.env.PROXY_ROUTES_FILE || "proxy/routes.json",
);

type Routes = Record<string, number>;

function loadRoutes(): Routes {
  try {
    const raw = JSON.parse(readFileSync(routesFile, "utf8")) as Routes;
    return raw && typeof raw === "object" ? raw : { catalog: 3000 };
  } catch {
    // [DEBUG] routes file missing or invalid — fall back to catalog only
    return { catalog: 3000 };
  }
}

let routes = loadRoutes();
watchFile(routesFile, { interval: 1000 }, () => {
  routes = loadRoutes();
});

function subdomain(hostHeader: string | undefined): string {
  const host = (hostHeader || "").split(":")[0].toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return "catalog";
  if (host.endsWith(".localhost")) {
    return host.slice(0, -".localhost".length) || "catalog";
  }
  return "catalog";
}

function upstreamFor(app: string): URL {
  if (app === "catalog") return new URL(catalogUpstream);
  const mapped = routes[app];
  if (!mapped) throw new Error(`no route for ${app}`);
  return new URL(`http://127.0.0.1:${mapped}`);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function loginRedirect(returnTo: string): string {
  const clientId =
    process.env.AZURE_SPA_CLIENT_ID ||
    process.env.AUTH_AUDIENCE ||
    "api://catalog-local";
  const redirectUri = `http://catalog.localhost:${port}/auth/callback`;
  const url = new URL("/auth", authMockUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile access_as_user");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set(
    "resource",
    process.env.AUTH_AUDIENCE || "api://catalog-local",
  );
  url.searchParams.set("state", returnTo);
  return url.toString();
}

const server = createServer(async (req, res) => {
  try {
    const app = subdomain(req.headers.host);
    const incoming = new URL(
      req.url || "/",
      `http://${req.headers.host || "catalog.localhost"}`,
    );

    if (incoming.pathname === "/proxy/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", routes }));
      return;
    }

    const headerToken = bearerFromHeader(req.headers.authorization);
    const cookieToken = readCookie(req.headers.cookie, "launchpad_token");
    const token = headerToken || cookieToken;

    const isCallback = incoming.pathname.startsWith("/auth/callback");
    const isPublic =
      isCallback ||
      incoming.pathname === "/api/health" ||
      incoming.pathname === "/api/config";

    if (!token && !isPublic) {
      res.writeHead(302, {
        location: loginRedirect(incoming.pathname + incoming.search),
      });
      res.end();
      return;
    }

    if (token && !isPublic) {
      try {
        await verifyAccessToken(token);
      } catch {
        // [DEBUG] proxy JWT rejected — compare AUTH_ISSUER / AUTH_AUDIENCE / JWKS_URI with auth-mock
        res.writeHead(302, {
          location: loginRedirect(incoming.pathname + incoming.search),
          "set-cookie":
            "launchpad_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
        });
        res.end();
        return;
      }
    }

    let target: URL;
    try {
      target = upstreamFor(app);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`No upstream registered for ${app}`);
      return;
    }

    const upstreamUrl = new URL(
      incoming.pathname + incoming.search,
      target,
    );
    const headers = { ...req.headers };
    headers.host = upstreamUrl.host;
    if (token) headers.authorization = `Bearer ${token}`;
    // Drop forged identity headers — catalog must validate the bearer JWT.
    delete headers["x-ms-client-principal"];
    delete headers["x-ms-client-principal-id"];
    delete headers["x-ms-client-principal-name"];
    delete headers["x-ms-token-aad-access-token"];

    const proxyReq = httpRequest(
      upstreamUrl,
      { method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", (error) => {
      // [DEBUG] upstream proxy failed — confirm catalog/dev agent port in routes.json
      console.error("upstream error", app, error);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end("Bad gateway");
      }
    });
    req.pipe(proxyReq);
  } catch (error) {
    // [DEBUG] proxy request failed
    console.error("proxy failed", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("proxy error");
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`proxy listening on http://catalog.localhost:${port}`);
  console.log(`routes file ${routesFile}`);
});
