/**
 * Fælles UI-hjælpere. Selektorerne er roller og labels (som en bruger ser siden), aldrig CSS.
 */

import { expect, type Page } from "@playwright/test";

import { E2E_PASSWORD } from "./data";

/** Log ind via /login som en rigtig bruger og vent på dashboardet. */
export async function login(page: Page, email: string, password: string = E2E_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Adgangskode").fill(password);
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function logout(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Log ud" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * Skærmbillede af en hovedskærm til `tests/e2e/__screens__/<rolle>/<navn>.png`. Gitignoreret og
 * uploadet som CI-artefakt (ADR 0071): billederne ændrer sig med hvert designtoken og ville
 * ellers støje i hver PR. Fuld side, så hele skærmen kan gennemses af Mads.
 */
export async function shot(page: Page, role: string, name: string): Promise<void> {
  await page.screenshot({ path: `tests/e2e/__screens__/${role}/${name}.png`, fullPage: true });
}
