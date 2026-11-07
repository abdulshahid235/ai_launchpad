export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { localAuthEnabled } = await import("./lib/local-auth");
  localAuthEnabled();
}
