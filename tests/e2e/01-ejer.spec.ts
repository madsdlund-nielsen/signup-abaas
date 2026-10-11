/**
 * Ejerens rejse (fase 6.1): signup → bekræft e-mail → login → onboarding-quiz → board-anbefaling →
 * godkend board → book møde → abonnement med demo-kort → dashboard.
 *
 * Alt klikkes i browseren; kun e-mail-bekræftelsen hentes fra Mailpit (Supabase Auth's udgående
 * mail i den lokale stak). Kører på demo-adaptere (ADR 0041): bookingen er en DEMO-booking.
 */

import { expect, test } from "@playwright/test";

import { E2E_PASSWORD, futureBookingSlot, serviceClient, USERS } from "./support/data";
import { APP_URL } from "./support/env";
import { verifyLink, waitForMail } from "./support/mail";
import { login, shot } from "./support/ui";

test.describe.configure({ mode: "serial" });

test.describe("Ejer", () => {
  test("opretter konto og bekræfter e-mailen", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("E-mail").fill(USERS.ejer);
    await page.getByLabel("Adgangskode").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Opret konto" }).click();

    await expect(page).toHaveURL(/\/check-email$/);
    await expect(page.getByRole("heading", { name: "Tjek din e-mail" })).toBeVisible();
    await shot(page, "ejer", "01-tjek-din-email");

    // Før bekræftelsen kan hun ikke logge ind.
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(USERS.ejer);
    await page.getByLabel("Adgangskode").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Log ind" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    const mail = await waitForMail(USERS.ejer, "confirm");
    await page.goto(verifyLink(mail));
    // Supabase bekræfter kontoen og sender browseren tilbage til appen (site_url).
    expect(page.url().startsWith(APP_URL)).toBe(true);
  });

  test("rollen 'ejer' er tildelt ved signup (ikke selvbetjent eskalering)", async () => {
    const { data: user } = await serviceClient().from("app_user").select("id").eq("email", USERS.ejer).single();
    const { data: roles } = await serviceClient()
      .from("user_role_assignment")
      .select("role")
      .eq("user_id", (user as { id: string }).id);
    expect((roles as Array<{ role: string }>).map((r) => r.role)).toEqual(["ejer"]);
  });

  test("logger ind og ser et tomt dashboard", async ({ page }) => {
    await login(page, USERS.ejer);
    await expect(page.getByText("Du har endnu ikke et board")).toBeVisible();
    await shot(page, "ejer", "02-dashboard-foer-board");
  });

  test("besvarer onboarding-quizzen", async ({ page }) => {
    await login(page, USERS.ejer);
    await page.goto("/onboarding");
    await expect(page.getByText("Spørgsmål 1 af 2")).toBeVisible();
    await shot(page, "ejer", "03-onboarding-spoergsmaal-1");

    // «Videre» er låst til der er valgt noget.
    await expect(page.getByRole("button", { name: "Videre" })).toBeDisabled();
    await page.getByRole("button", { name: /fastholdelse og churn/ }).click();
    await page.getByRole("button", { name: /salg og marketing/ }).click();
    await page.getByRole("button", { name: "Videre" }).click();

    await expect(page.getByText("Spørgsmål 2 af 2")).toBeVisible();
    await page.getByRole("button", { name: "Hver 8. uge" }).click();
    await page.getByRole("button", { name: "Gem svar" }).click();

    await expect(page.getByRole("heading", { name: "Tak" })).toBeVisible();
    await shot(page, "ejer", "04-onboarding-faerdig");
  });

  test("ser board-anbefalingen og godkender den", async ({ page }) => {
    await login(page, USERS.ejer);
    await page.goto("/board");
    await expect(page.getByRole("heading", { name: "Dit anbefalede board" })).toBeVisible();
    // 2-3 partnere, hver med en forklaring af hvorfor (kompetencer).
    const cards = page.locator(".partner-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
    await shot(page, "ejer", "05-board-anbefaling");

    await page.getByRole("button", { name: "Godkend board" }).click();
    await expect(page.getByRole("heading", { name: "Dit board", exact: true })).toBeVisible();
    await shot(page, "ejer", "06-board-godkendt");
  });

  test("booker et møde med boardet", async ({ page }) => {
    await login(page, USERS.ejer);
    await page.goto("/moeder");
    await expect(page.getByText("Ingen møder endnu")).toBeVisible();
    await shot(page, "ejer", "07-moeder-foer-booking");

    await page.getByLabel("Starttidspunkt").fill(futureBookingSlot());
    await page.getByRole("button", { name: "Book møde" }).click();

    // Rækken for det nye møde: status Planlagt og et videolink (demo-mødelokale).
    const row = page.getByRole("row").filter({ hasText: "Planlagt" });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("link", { name: "Deltag" })).toBeVisible();
    await shot(page, "ejer", "08-moeder-booket");

    // Mødesiden: dagsorden/forberedelse hører til her.
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/moeder\/[0-9a-f-]{36}$/);
    await shot(page, "ejer", "09-moede-detalje");
  });

  test("opretter abonnement og registrerer demo-kort", async ({ page }) => {
    await login(page, USERS.ejer);
    await page.goto("/betaling");
    // Prisen kommer fra demo-seed'ets DEMO-regel — aldrig et rigtigt forretningstal.
    await expect(page.getByRole("heading", { name: "Din pris" })).toBeVisible();
    await shot(page, "ejer", "10-betaling-foer-medlemskab");

    await page.getByLabel("Mødefrekvens").selectOption("8");
    await page.getByRole("button", { name: "Opret medlemskab" }).click();
    await expect(page.getByRole("cell", { name: "Mangler" })).toBeVisible();

    await page.getByRole("button", { name: "Registrér betalingskort" }).click();
    await expect(page).toHaveURL(/\/betaling\/demo-kort\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Demo-kortregistrering" })).toBeVisible();
    await shot(page, "ejer", "11-demo-kortregistrering");

    await page.getByRole("button", { name: "Bekræft demo-kort" }).click();
    await page.goto("/betaling");
    await expect(page.getByRole("cell", { name: "Registreret", exact: true })).toBeVisible();
    await shot(page, "ejer", "12-betaling-kort-registreret");
  });

  test("dashboardet viser næste møde og abonnement", async ({ page }) => {
    await login(page, USERS.ejer);
    await expect(page.getByText("Kommende møder").first()).toBeVisible();
    await expect(page.getByText(/Næste: /)).toBeVisible();
    await expect(page.getByText("8 uger")).toBeVisible();
    await shot(page, "ejer", "13-dashboard-med-board");
  });
});
