import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testMatch: "**/live-binance.spec.ts",
  timeout: 180_000,
  expect: { timeout: 120_000 },
  retries: 0,
});
