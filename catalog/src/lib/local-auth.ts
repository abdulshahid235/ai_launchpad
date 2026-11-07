function envValue(name: string): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

// APP_ENV is read at runtime. Unset means prod, so a local override cannot turn on by accident.
export function appEnv(): string {
  return envValue("APP_ENV") || "prod";
}

export function localAuthEnabled(): boolean {
  const requested = envValue("LOCAL_AUTH_MODE") === "true";
  const env = appEnv();
  if (requested && env !== "local") {
    console.error(
      "LOCAL_AUTH_MODE=true requires APP_ENV=local. Refusing to start.",
    );
    process.exit(1);
  }
  return requested && env === "local";
}

// A JWKS override is used only for the local demo. Any other environment ignores it.
export function localJwksOverride(name: string): string | undefined {
  if (!localAuthEnabled()) return undefined;
  const value = envValue(name);
  return value || undefined;
}
