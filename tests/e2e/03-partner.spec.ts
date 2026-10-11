/**
 * Partnerens rejse (fase 6.1): invitation → vælg adgangskode → login → portal (profil, registrér
 * afholdt, note) → honorar → tilgængelighed (og at booking respekterer den).
 *
 * Forudsætter 02-admin: admin har inviteret katalogposten «Astrid Nørgaard» som partner@e2e.test.
 *
 * Invitationslinket gennemspilles for alvor (B-70, ADR 0073): mail → /auth/confirm → «Vælg
 * adgangskode» → /partner. Partnerens adgangskode er den hun selv vælger her, ikke en der er
 * sat via admin-API'et — de senere tests logger ind med den.
 */

import { expect, test } from "@playwright/test";

import { E2E_PASSWORD, futureBookingSlot, serviceClient, userIdByEmail, USERS } from "./support/data";
import { confirmLink, waitForMail } from "./support/mail";
import { login, shot } from "./support/ui";

const ASTRID = "d0000000-0000-4000-8000-000000000301";
const SEED_UPCOMING_MEETING = "d0000000-0000-4000-8000-000000000701";

test.describe.configure({ mode: "serial" });

test.describe("Partner", () => {
  test("invitationslinket giver partneren en session og en vej til en adgangskode", async ({ page }) => {
    const mail = await waitForMail(USERS.partner, "invite");
    await page.goto(confirmLink(mail));

    // Bekræftelsesruten har indløst tokenet og sat sessionen: partneren står på «Vælg adgangskode».
    await expect(page).toHaveURL(/\/konto\/adgangskode$/);
    await expect(page.getByRole("heading", { name: "Vælg adgangskode" })).toBeVisible();
    await shot(page, "partner", "00-vaelg-adgangskode");

    // Reglerne gælder også her: de to felter skal være ens (for kort stoppes allerede af browseren).
    await page.getByLabel("Ny adgangskode").fill(E2E_PASSWORD);
    await page.getByLabel("Gentag adgangskode").fill(`${E2E_PASSWORD}-forkert`);
    await page.getByRole("button", { name: "Gem adgangskode" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "ikke ens" })).toBeVisible();

    await page.getByLabel("Ny adgangskode").fill(E2E_PASSWORD);
    await page.getByLabel("Gentag adgangskode").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Gem adgangskode" }).click();

    // En partner sendes til portalen.
    await expect(page).toHaveURL(/\/partner$/);
    await expect(page.getByRole("heading", { name: "Din partnerportal" })).toBeVisible();
  });

  test("katalogposten er koblet, og et brugt invitationslink fejler roligt", async ({ page }) => {
    const userId = await userIdByEmail(USERS.partner);
    expect(userId, "admin-specen skal have inviteret partneren").not.toBeNull();
    const { data } = await serviceClient().from("partner_profile").select("app_user_id").eq("id", ASTRID).single();
    expect((data as { app_user_id: string }).app_user_id).toBe(userId);

    // Tokenet er engangs: samme link igen giver ingen session, men en rolig besked på loginsiden.
    const mail = await waitForMail(USERS.partner, "invite");
    await page.goto(confirmLink(mail));
    await expect(page).toHaveURL(/\/login\?fejl=ugyldigt-link$/);
    await expect(page.getByText("Linket er ugyldigt eller udløbet")).toBeVisible();
  });

  test("dashboard og portal: profil kan redigeres, tags kan ikke", async ({ page }) => {
    await login(page, USERS.partner);
    await expect(page.getByText("Dine møder og dit honorar")).toBeVisible();
    await shot(page, "partner", "01-dashboard");

    await page.goto("/partner");
    await expect(page.getByRole("heading", { name: "Din partnerportal" })).toBeVisible();
    // Admin styrer tags: ingen tag-vælger i partnerens profilformular.
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    await page.getByLabel("Titel/rolle").fill("[E2E] Kommerciel direktør");
    await page.getByRole("button", { name: "Gem profil" }).click();
    // Formularen er en server action uden synligt svar: vent på at ændringen lander i sandhedskilden.
    await expect
      .poll(async () => {
        const { data } = await serviceClient().from("partner_profile").select("title").eq("id", ASTRID).single();
        return (data as { title: string | null }).title;
      })
      .toBe("[E2E] Kommerciel direktør");
    await page.goto("/partner");
    await expect(page.getByLabel("Titel/rolle")).toHaveValue("[E2E] Kommerciel direktør");
    await shot(page, "partner", "02-portal");
  });

  test("registrerer det kommende møde som afholdt og skriver en note", async ({ page }) => {
    await login(page, USERS.partner);
    await page.goto("/partner");

    // Partneren sidder på to boards (demo-seed'ets og den ejer-rejse der blev gennemspillet i 01):
    // begge har et planlagt møde, og begge ligger i fremtiden.
    const upcoming = page.getByRole("article").filter({ hasText: "Status: Planlagt" });
    await expect(upcoming).toHaveCount(2);

    // Fund fra e2e: et møde der ikke er begyndt kan ikke registreres som afholdt (det gav før en
    // honorarlinje for et møde ni dage ude i fremtiden). «Forsinket afbud» sker før mødet og er åben.
    await expect(page.getByRole("button", { name: "Afholdt", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Udeblivelse" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Forsinket afbud" })).toHaveCount(2);

    // Tiden går: seed-mødet rykkes to timer tilbage, og så kan det registreres.
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const moved = await serviceClient().from("meeting").update({ starts_at: past }).eq("id", SEED_UPCOMING_MEETING);
    expect(moved.error).toBeNull();
    await page.reload();
    await page.getByRole("button", { name: "Afholdt", exact: true }).click();

    const held = page.getByRole("article").filter({ hasText: "Din registrering: Afholdt." }).filter({ hasText: "Status: Afholdt" });
    await expect(held.first()).toBeVisible();

    const withNote = held.filter({ has: page.getByLabel("Din møde-note (efter møde)") }).first();
    await withNote.getByLabel("Din møde-note (efter møde)").fill("[E2E] Note efter mødet.");
    await withNote.getByRole("button", { name: "Gem note" }).click();
    await shot(page, "partner", "03-moede-registreret");

    // Formularen er en server action uden synligt svar: vent på at noten lander i sandhedskilden.
    await expect
      .poll(async () => {
        const { data } = await serviceClient().from("meeting_note").select("body").eq("partner_profile_id", ASTRID);
        return ((data ?? []) as Array<{ body: string }>).map((n) => n.body);
      })
      .toContain("[E2E] Note efter mødet.");
  });

  test("lead-partner: dashboardet viser boardets kompetencedækning", async ({ page }) => {
    await login(page, USERS.partner);
    await expect(page.getByText("Boardets kompetencer")).toBeVisible();
    await expect(page.getByText("Du er lead på dette board")).toBeVisible();
    await shot(page, "partner", "03b-lead-dashboard");
    await page.goto("/partner");
    await expect(page.getByRole("button", { name: "Initiér næste møde" })).toBeVisible();
  });

  test("honorar: opgørelsen vises med DEMO-satsen", async ({ page }) => {
    await login(page, USERS.partner);
    await page.goto("/partner/honorar");
    await expect(page.getByRole("heading", { name: "Dit honorar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Linjer" })).toBeVisible();
    await shot(page, "partner", "04-honorar");
  });

  test("tilgængelighed: angiver tider, og booking respekterer dem", async ({ page, browser }) => {
    await login(page, USERS.partner);
    await page.goto("/partner/tilgaengelighed");
    await expect(page.getByRole("heading", { name: "Din tilgængelighed" })).toBeVisible();
    await shot(page, "partner", "05-tilgaengelighed-foer");

    await page.getByRole("group", { name: "Ugedage" }).getByLabel("Tirsdag").check();
    await page.getByLabel("Fra", { exact: true }).fill("09:00");
    await page.getByLabel("Til", { exact: true }).fill("12:00");
    await page.getByRole("button", { name: "Tilføj tider" }).click();
    await expect(page.getByRole("button", { name: /Fjern Tirsdag 09:00/ })).toBeVisible();
    await shot(page, "partner", "06-tilgaengelighed-efter");

    // Ejeren forsøger at booke uden for partnerens tider → afvist; inden for → accepteret.
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await login(owner, USERS.ejerBefolket);
    await owner.goto("/moeder");
    const tuesday = futureBookingSlot(20);
    await owner.getByLabel("Starttidspunkt").fill(tuesday.replace("T10:00", "T15:00"));
    await owner.getByRole("button", { name: "Book møde" }).click();
    await expect(owner.getByText(/Mødet kan ikke bookes/)).toBeVisible();

    await owner.getByLabel("Starttidspunkt").fill(tuesday);
    await owner.getByRole("button", { name: "Book møde" }).click();
    await expect(owner.getByRole("row").filter({ hasText: "Planlagt" })).not.toHaveCount(0);
    await ownerContext.close();
  });
});
