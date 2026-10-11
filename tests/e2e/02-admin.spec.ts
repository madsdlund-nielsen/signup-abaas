/**
 * Administrators rejse (fase 6.1): prisregel, honorarregel, notifikationsskabelon (udkast →
 * publicér → LIVE), board-redigering (udskift partner), partner-invitation, drift og juridisk
 * indsigtsudtræk.
 *
 * Beløb er åbenlyst falske (100 øre = 1 kr, faktor 1) — samme princip som demo-seed'et (ADR 0041).
 * Admin-rollen oprettes af global-setup via service-role; roller kan ikke tildeles i UI'et.
 */

import { expect, test } from "@playwright/test";

import { serviceClient, USERS } from "./support/data";
import { waitForMail } from "./support/mail";
import { login, shot } from "./support/ui";

test.describe.configure({ mode: "serial" });

test.describe("Admin", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.admin);
  });

  test("dashboard og admin-hub", async ({ page }) => {
    await expect(page.getByText("Platformen i tal")).toBeVisible();
    await shot(page, "admin", "01-dashboard");
    await page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await shot(page, "admin", "02-hub");
  });

  test("opretter og aktiverer en ny version af prisreglen", async ({ page }) => {
    await page.goto("/admin/priser");
    await expect(page.getByRole("heading", { name: "Prisregler" })).toBeVisible();

    await page.getByLabel("Grundpris pr. periode (øre)").fill("100");
    await page.getByLabel("Pris pr. partner pr. periode (øre)").fill("100");
    await page.getByLabel("Faktor — hver 4. uge").fill("1");
    await page.getByLabel("Faktor — hver 8. uge").fill("1");
    await page.getByLabel("Faktor — hver 12. uge").fill("1");
    await page.getByRole("button", { name: /Gem som version \d+/ }).click();

    // Den nye version står i tabellen som inaktiv — og kan aktiveres.
    const inactive = page.getByRole("row").filter({ hasText: "—" }).filter({ has: page.getByRole("button", { name: "Aktivér" }) });
    await expect(inactive).toHaveCount(1);
    await shot(page, "admin", "03-priser-ny-version");
    await inactive.getByRole("button", { name: "Aktivér" }).click();
    await expect(page.getByRole("button", { name: "Aktivér" })).toHaveCount(1); // den gamle version kan nu aktiveres igen
    await expect(page.getByRole("cell", { name: "Aktiv", exact: true })).toHaveCount(1);
  });

  test("opretter en ny version af honorarreglen", async ({ page }) => {
    await page.goto("/admin/honorar");
    await expect(page.getByRole("heading", { name: "Honorar", exact: true })).toBeVisible();

    await page.getByLabel("Honorarsats pr. time (øre)").fill("100");
    await page.getByLabel("Gælder fra (dansk tid)").fill("2026-11-01T00:00");
    await page.getByRole("button", { name: /Gem som version \d+/ }).click();

    // Moms og afbudsregel står som «ikke fastlagt» (ejerens beslutning) — ikke et gæt.
    await expect(page.getByRole("row").filter({ hasText: /ikke fastlagt/i }).first()).toBeVisible();
    await shot(page, "admin", "04-honorar");
  });

  test("skabelon: gem udkast → publicér → live", async ({ page }) => {
    await page.goto("/admin/notifikationer");
    await expect(page.getByRole("heading", { name: "Notifikationer" })).toBeVisible();
    await shot(page, "admin", "05-notifikationer");

    await page.getByRole("link", { name: "Redigér skabeloner" }).first().click();
    await expect(page).toHaveURL(/\/admin\/notifikationer\/[a-z-]+$/);

    const email = page.getByRole("region", { name: "E-mail" });
    await email.getByLabel("Emne").fill("[E2E] Påmindelse til {{modtager_navn}}");
    await email.getByLabel("Tekst").fill("[E2E] Hej {{modtager_navn}}, mødet er {{moede_tidspunkt}}.");
    await email.getByRole("button", { name: "Gem udkast" }).click();
    await expect(email.getByText(/Udkast · v\d+/).first()).toBeVisible();
    await shot(page, "admin", "06-skabelon-udkast");

    // Publicering er et to-trins valg, så det ikke sker ved et uheld.
    await email.getByRole("button", { name: "Publicér…" }).click();
    await expect(email.getByText(/bliver LIVE for alle fremtidige udsendelser/)).toBeVisible();
    await email.getByRole("button", { name: "Bekræft: gør live" }).click();
    await expect(email.getByText(/Live · v\d+/).first()).toBeVisible();
    await shot(page, "admin", "07-skabelon-live");

    await page.reload();
    await expect(page.getByRole("region", { name: "E-mail" }).getByText(/Live · v\d+/).first()).toBeVisible();
  });

  test("board: udskifter en partner og ændringen logges", async ({ page }) => {
    await page.goto("/admin/boards");
    await shot(page, "admin", "08-boards");
    await page
      .getByRole("row")
      .filter({ hasText: USERS.ejerBefolket })
      .getByRole("link")
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Partnere på boardet" })).toBeVisible();
    await shot(page, "admin", "09-board-redigering");

    // Camilla Riis (ekstern) → Peter Lundgaard (ekstern): boardet beholder sine interne partnere.
    await page.getByRole("row").filter({ hasText: "Camilla Riis" }).getByRole("link", { name: "Udskift" }).click();
    await expect(page.getByRole("heading", { name: "Udskift Camilla Riis" })).toBeVisible();
    await shot(page, "admin", "10-board-udskift-kandidater");
    await page
      .getByRole("row")
      .filter({ hasText: "Peter Lundgaard" })
      .getByRole("button", { name: "Udskift med denne" })
      .click();
    // «Udskift Camilla»-sektionen forsvinder i samme øjeblik skiftet lykkes — bekræftelsen bor derfor
    // på siden selv (B-71), ikke i formularen.
    await expect(page.getByRole("heading", { name: "Udskift Camilla Riis" })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Camilla Riis er erstattet af Peter Lundgaard" })).toBeVisible();
    await shot(page, "admin", "10b-board-udskift-bekraeftet");

    // Sandhedskilden følger: Peter sidder på boardet, Camilla gør ikke — og ændringen er logget.
    const { data: members } = await serviceClient()
      .from("board_partner")
      .select("partner_profile(name)")
      .eq("board_id", "d0000000-0000-4000-8000-000000000401");
    const names = ((members ?? []) as unknown as Array<{ partner_profile: { name: string } | Array<{ name: string }> }>).map(
      (row) => (Array.isArray(row.partner_profile) ? row.partner_profile[0]?.name : row.partner_profile.name),
    );
    expect(names).toContain("Peter Lundgaard");
    expect(names).not.toContain("Camilla Riis");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Seneste ændringer" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: /Peter Lundgaard/ })).not.toHaveCount(0);
    await shot(page, "admin", "11-board-efter-udskiftning");
  });

  test("inviterer en partner og invitationsmailen sendes", async ({ page }) => {
    await page.goto("/admin/partners");
    await shot(page, "admin", "12-partnerkatalog");
    await page.getByRole("row").filter({ hasText: "Astrid Nørgaard" }).getByRole("link", { name: "Redigér" }).click();

    await expect(page.getByRole("heading", { name: "Partner-login" })).toBeVisible();
    await page.getByLabel("E-mail").first().fill(USERS.partner);
    await page.getByRole("button", { name: "Invitér partner" }).click();
    await expect(page.getByText("Denne partner er koblet til en login-konto.")).toBeVisible();

    const mail = await waitForMail(USERS.partner, "invite");
    expect(mail.Subject.toLowerCase()).toContain("invite");
    await shot(page, "admin", "13-partner-inviteret");
  });

  test("driftsoverblik viser at integrationerne kører som demo", async ({ page }) => {
    await page.goto("/admin/drift");
    await expect(page.getByRole("heading", { name: "Driftsoverblik" })).toBeVisible();
    await expect(page.getByText(/demo/i).first()).toBeVisible();
    await shot(page, "admin", "14-drift");
  });

  test("juridisk: indsigtsudtræk (GDPR art. 15) som download", async ({ page }) => {
    await page.goto("/admin/juridisk");
    await expect(page.getByRole("heading", { name: /Juridisk/ })).toBeVisible();
    await shot(page, "admin", "15-juridisk");

    await page.getByLabel("E-mail").fill(USERS.ejerBefolket);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Hent udtræk" }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const extract = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    expect(JSON.stringify(extract)).toContain(USERS.ejerBefolket);
  });

  test("vurderinger, quiz, tags og honorar kan åbnes", async ({ page }) => {
    for (const [path, heading, name] of [
      ["/admin/vurderinger", /Vurderinger/, "16-vurderinger"],
      ["/admin/quiz", /Quiz/, "17-quiz"],
      ["/admin/tags", /tags/i, "18-tags"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await shot(page, "admin", name);
    }
  });
});
