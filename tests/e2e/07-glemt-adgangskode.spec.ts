/**
 * Glemt adgangskode (B-70, ADR 0073): anmod → Mailpit → link → ny adgangskode → login. Plus de
 * negative sider af den åbne indgang: samme svar uanset om adressen findes, ingen session uden
 * link, og ingen åben redirect via `next`.
 *
 * Bruger sin egen ejer (`glemt@e2e.test`), så ingen af de andre rejsers adgangskoder rokkes.
 */

import { expect, test } from "@playwright/test";

import { E2E_PASSWORD, ensureUser } from "./support/data";
import { confirmLink, waitForMail } from "./support/mail";
import { login, shot } from "./support/ui";

const EMAIL = "glemt@e2e.test";
const NEW_PASSWORD = "e2e-ny-kun-lokalt-Pass-2";
const NOTICE = /Hvis adressen findes, har vi sendt et link/;

test.describe.configure({ mode: "serial" });

test.describe("Glemt adgangskode", () => {
  test.beforeAll(async () => {
    await ensureUser(EMAIL, "ejer");
  });

  test("loginsiden linker til «Glemt adgangskode»", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Glemt adgangskode?" }).click();
    await expect(page).toHaveURL(/\/glemt-adgangskode$/);
    await shot(page, "offentlig", "06-glemt-adgangskode");
  });

  test("svarer ens for en ukendt adresse (intet konto-orakel)", async ({ page }) => {
    await page.goto("/glemt-adgangskode");
    await page.getByLabel("E-mail").fill("findes-ikke@e2e.test");
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByRole("status").filter({ hasText: NOTICE })).toBeVisible();
  });

  test("uden session kan man ikke vælge adgangskode", async ({ page }) => {
    await page.goto("/konto/adgangskode");
    await expect(page).toHaveURL(/\/login\?fejl=ny-adgangskode$/);
    await expect(page.getByText("Din session er udløbet")).toBeVisible();
  });

  test("bekræftelsesruten afviser ukendt type, manglende token og åben redirect", async ({ page }) => {
    for (const query of [
      "type=recovery",
      "token_hash=abc&type=magiclink",
      "token_hash=abc",
      "token_hash=opfundet&type=recovery&next=//evil.example",
    ]) {
      await page.goto(`/auth/confirm?${query}`);
      await expect(page).toHaveURL(/\/login\?fejl=ugyldigt-link$/);
    }
  });

  test("anmod → mail → link → ny adgangskode → login", async ({ page }) => {
    await page.goto("/glemt-adgangskode");
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByRole("button", { name: "Send link" }).click();
    // Samme tekst som for en ukendt adresse.
    await expect(page.getByRole("status").filter({ hasText: NOTICE })).toBeVisible();

    const mail = await waitForMail(EMAIL, "adgangskode");
    await page.goto(confirmLink(mail));
    await expect(page).toHaveURL(/\/konto\/adgangskode$/);

    await page.getByLabel("Ny adgangskode").fill(NEW_PASSWORD);
    await page.getByLabel("Gentag adgangskode").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Gem adgangskode" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Den gamle adgangskode virker ikke længere; den nye gør.
    await page.getByRole("button", { name: "Log ud" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Adgangskode").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Log ind" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Forkert e-mail eller adgangskode" })).toBeVisible();

    await login(page, EMAIL, NEW_PASSWORD);
  });
});
