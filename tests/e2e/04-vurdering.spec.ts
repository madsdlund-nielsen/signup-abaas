/**
 * Auth-fri rejse (fase 6.1): `/vurdering/<token>` — en vurdering fra et mail-link UDEN login
 * (B-21, ADR 0060). Linket udstedes her på samme måde som notifikationsmotoren gør (en række i
 * `rating_link` + HMAC med `RATING_LINK_SECRET`), og indløses i en anonym browser.
 *
 * Det der verificeres mod en rigtig Supabase: engangsbrugen (andet forsøg afvises — også fra en
 * fane der blev åbnet FØR det første), at et forfalsket token afvises, at siden ikke giver en
 * session, og at indløsningsfunktionen ikke kan kaldes direkte fra den offentlige REST-API.
 */

import { expect, test } from "@playwright/test";

import { formatRatingToken } from "../../src/server/ratings/link";
import { serviceClient, userIdByEmail, USERS } from "./support/data";
import { E2E_RATING_LINK_SECRET, loadSupabaseEnv } from "./support/env";
import { shot } from "./support/ui";

const HELD_MEETING = "d0000000-0000-4000-8000-000000000702";

test.describe.configure({ mode: "serial" });

let token = "";
let linkId = "";

test.describe("Vurdering uden login", () => {
  test.beforeAll(async () => {
    const userId = await userIdByEmail(USERS.ejerBefolket);
    expect(userId).not.toBeNull();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await serviceClient()
      .from("rating_link")
      .insert({ meeting_id: HELD_MEETING, rater_user_id: userId, expires_at: expiresAt })
      .select("id, expires_at")
      .single();
    expect(error).toBeNull();
    const row = data as { id: string; expires_at: string };
    linkId = row.id;
    token = formatRatingToken(E2E_RATING_LINK_SECRET, {
      id: row.id,
      meetingId: HELD_MEETING,
      rater: { kind: "user", userId: userId as string },
      expiresAt: row.expires_at,
    });
  });

  test("et gyldigt link viser vurderingsformularen uden at brænde linket", async ({ page }) => {
    await page.goto(`/vurdering/${token}`);
    await expect(page.getByRole("heading", { name: "Hvordan var mødet?" })).toBeVisible();
    await shot(page, "offentlig", "01-vurdering-formular");

    // Åbning (GET) indløser intet — en mailscanner der henter linket brænder det ikke.
    const { data } = await serviceClient().from("rating_link").select("used_at").eq("id", linkId).single();
    expect((data as { used_at: string | null }).used_at).toBeNull();
    // Og siden gav ingen session.
    const cookies = await page.context().cookies();
    expect(cookies.filter((c) => c.name.startsWith("sb-"))).toHaveLength(0);
  });

  test("indløser linket, og et andet forsøg afvises", async ({ page, browser }) => {
    // En anden fane åbner formularen FØR den første indløser: den holder en gyldig formular.
    const otherContext = await browser.newContext();
    const stale = await otherContext.newPage();
    await stale.goto(`/vurdering/${token}`);
    await expect(stale.getByRole("button", { name: "Send vurdering" })).toBeVisible();

    await page.goto(`/vurdering/${token}`);
    await page.getByLabel("Mødet samlet set").selectOption("4");
    await page.getByLabel("Kommentar (valgfri)").fill("[E2E] Vurdering uden login.");
    await page.getByRole("button", { name: "Send vurdering" }).click();
    await expect(page.getByRole("heading", { name: "Tak for din vurdering" })).toBeVisible();
    await shot(page, "offentlig", "02-vurdering-tak");

    // Gemt i basen, og linket er brugt.
    const { data: ratings } = await serviceClient()
      .from("meeting_rating")
      .select("score, comment")
      .eq("meeting_id", HELD_MEETING)
      .is("subject_partner_profile_id", null);
    expect(ratings).toEqual([{ score: 4, comment: "[E2E] Vurdering uden login." }]);

    // Genindlæsning: «tak», ikke en fejl — og ingen formular.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tak for din vurdering" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send vurdering" })).toHaveCount(0);

    // Andet forsøg fra den gamle fane: afvist, og der gemmes intet nyt.
    await stale.getByLabel("Mødet samlet set").selectOption("1");
    await stale.getByRole("button", { name: "Send vurdering" }).click();
    await expect(stale.getByText(/Linket er allerede brugt/)).toBeVisible();
    await otherContext.close();

    const { data: after } = await serviceClient()
      .from("meeting_rating")
      .select("score")
      .eq("meeting_id", HELD_MEETING)
      .is("subject_partner_profile_id", null);
    expect(after).toEqual([{ score: 4 }]);
  });

  test("et forfalsket token afvises uden at røbe hvorfor", async ({ page }) => {
    const forged = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    await page.goto(`/vurdering/${forged}`);
    await expect(page.getByRole("heading", { name: "Linket kan ikke bruges" })).toBeVisible();
    await shot(page, "offentlig", "03-vurdering-ugyldigt");

    await page.goto("/vurdering/ikke-et-token");
    await expect(page.getByRole("heading", { name: "Linket kan ikke bruges" })).toBeVisible();
  });

  test("indløsningsfunktionen kan ikke kaldes fra den offentlige REST-API", async ({ request }) => {
    const { apiUrl, publishableKey } = loadSupabaseEnv();
    const response = await request.post(`${apiUrl}/rest/v1/rpc/redeem_rating_link`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
      data: { p_link_id: linkId, p_score: 5, p_comment: "forsøg" },
    });
    expect(response.ok()).toBe(false);
    expect([401, 403, 404]).toContain(response.status());
  });
});
