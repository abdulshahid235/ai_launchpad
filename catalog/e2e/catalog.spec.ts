import { test, expect } from "@playwright/test";

const configured = Boolean(
  process.env.BASE_URL &&
  process.env.AZURE_CLIENT_ID &&
  process.env.AZURE_TENANT_ID,
);

// [HNI-TEST-05] Skip until Entra and the dev catalog URL are configured.
// [HNI-AUTH-04] This does not store a password or reuse a saved login.
test.skip(!configured, "Entra is not configured");

test("shows the sign-in control", async ({ page }) => {
  await page.goto("/");
  const dev = page.getByRole("button", { name: "Dev", exact: true });
  if ((await dev.count()) > 0) {
    await dev.click();
    await expect(page.getByRole("textbox", { name: "Dev token" })).toBeVisible();
    return;
  }
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
