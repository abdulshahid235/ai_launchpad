import { defineConfig } from "@playwright/test";

// [HNI-TEST-06] The target comes from BASE_URL. No environment host is written here.
export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: process.env.BASE_URL,
  },
});
