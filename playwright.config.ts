import { defineConfig, devices } from "@playwright/test";

import { APP_PORT, APP_URL, appEnv } from "./tests/e2e/support/env";

/**
 * Ende-til-ende-verifikation af hele rejsen (fase 6.1, ADR 0071) — en rigtig browser mod et
 * produktions-build (`next build && next start`) der taler med en LOKAL Supabase-stak
 * (`npm run e2e:db:up`). Ikke en del af `npm test`: stakken kræver Docker og tager minutter.
 *
 * Nøglerne til Supabase genereres af CLI'en og læses ved opstart (tests/e2e/support/env.ts) —
 * ingen hemmeligheder i repoet. Leverandørnøgler blankes eksplicit; rejsen kører på demo-adaptere
 * (ADR 0041), og en rigtig nøgle ville vinde over dem.
 *
 * Specs kører i filrækkefølge på én worker: de deler én database, og senere specs bygger på
 * tilstand tidligere specs har oprettet (ejerens board → partnerens møder). Se docs/e2e.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: APP_URL,
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Chromium fra PLAYWRIGHT_BROWSERS_PATH. Matcher versionen ikke (fx en forhåndsinstalleret
    // browser), kan stien overstyres uden at ændre koden.
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // E2E_SKIP_BUILD=1 genbruger et eksisterende .next fra en tidligere kørsel med samme miljø.
    command: `${process.env.E2E_SKIP_BUILD ? "" : "npm run build && "}npm run start -- --port ${APP_PORT}`,
    url: `${APP_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 6 * 60_000,
    env: appEnv(),
    stdout: "pipe",
    stderr: "pipe",
  },
});
