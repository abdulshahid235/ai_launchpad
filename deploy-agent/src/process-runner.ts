import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DeployRequest, DeployResult, Runner } from "./types.ts";

export type ProcessRunnerOptions = {
  workRoot: string;
  routesFile: string;
  catalogRegisterUrl: string;
  accessToken: string;
  proxyPort?: number;
};

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not allocate port"));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

async function registerRoute(
  routesFile: string,
  appName: string,
  port: number,
): Promise<void> {
  const { readFileSync, writeFileSync } = await import("node:fs");
  let routes: Record<string, number> = {};
  if (existsSync(routesFile)) {
    routes = JSON.parse(readFileSync(routesFile, "utf8")) as Record<
      string,
      number
    >;
  }
  routes[appName] = port;
  writeFileSync(routesFile, `${JSON.stringify(routes, null, 2)}\n`);
}

export class ProcessRunner implements Runner {
  constructor(private readonly options: ProcessRunnerOptions) {}

  async deploy(request: DeployRequest): Promise<DeployResult> {
    const workDir = resolve(this.options.workRoot, request.appName);
    mkdirSync(this.options.workRoot, { recursive: true });
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    cpSync(request.sourcePath, workDir, { recursive: true });

    await run("npm", ["ci"], workDir);
    await run("npm", ["run", "build"], workDir);

    const port = await freePort();
    const child = spawn("npm", ["run", "start", "--", "-p", String(port)], {
      cwd: workDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, PORT: String(port) },
      detached: true,
    });
    child.unref();

    await registerRoute(this.options.routesFile, request.appName, port);

    const proxyPort = this.options.proxyPort ?? 8080;
    const url = `http://${request.appName}.localhost:${proxyPort}`;

    const response = await fetch(this.options.catalogRegisterUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: request.appName,
        owner_object_id: request.ownerObjectId,
        description: request.description,
        url,
        revision: request.revision,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`POST /api/apps failed: ${response.status} ${text}`);
    }

    return { appName: request.appName, port, url };
  }
}
