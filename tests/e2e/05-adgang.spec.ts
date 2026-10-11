/**
 * Negative rejser (fase 6.1): hvem må IKKE komme ind. Verificeres både i UI'et (omdirigeringer) og
 * mod den rigtige PostgREST/GoTrue (RLS med `auth.uid()` fra et rigtigt login, ikke test-shim'en).
 *
 * Forudsætter 01-ejer (ejeren med eget board) og 03-partner (partnerens login).
 */

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { E2E_PASSWORD, USERS } from "./support/data";
import { loadSupabaseEnv } from "./support/env";
import { login, shot } from "./support/ui";

const OTHER_OWNER_BOARD = "d0000000-0000-4000-8000-000000000401";

test.describe("Anonym", () => {
  for (const path of ["/dashboard", "/onboarding", "/board", "/moeder", "/betaling", "/konto", "/partner", "/admin", "/admin/priser"]) {
    test(`${path} omdirigeres til login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test("indsigtsudtræk afvises uden login (401)", async ({ request }) => {
    const response = await request.post("/api/admin/indsigt", { form: { email: USERS.ejer } });
    expect(response.status()).toBe(401);
  });

  test("forsiden og login er åbne", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primær" })).toBeVisible();
    await shot(page, "offentlig", "04-forside");
    await page.goto("/login");
    await shot(page, "offentlig", "05-login");
  });
});

test.describe("Ejer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.ejer);
  });

  for (const path of ["/admin", "/admin/priser", "/admin/honorar", "/admin/boards", "/admin/juridisk", "/admin/drift", "/partner"]) {
    test(`kan ikke åbne ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByText("Platformen i tal")).toHaveCount(0);
    });
  }

  test("kan ikke hente indsigtsudtræk (403)", async ({ page }) => {
    const response = await page.request.post("/api/admin/indsigt", { form: { email: USERS.ejerBefolket } });
    expect(response.status()).toBe(403);
  });

  test("nav viser ikke Admin- eller Partner-links", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primær" });
    await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Partner" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Møder" })).toBeVisible();
  });
});

test.describe("Partner", () => {
  test("kan ikke åbne /admin eller ejerens flader", async ({ page }) => {
    await login(page, USERS.partner);
    for (const path of ["/admin", "/admin/honorar", "/moeder", "/betaling", "/board"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
  });
});

test.describe("RLS mod den rigtige PostgREST", () => {
  async function signedIn(email: string) {
    const { apiUrl, publishableKey } = loadSupabaseEnv();
    const client = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
    expect(error).toBeNull();
    return client;
  }

  test("anon ser ingen forretningsdata", async () => {
    const { apiUrl, publishableKey } = loadSupabaseEnv();
    const anon = createClient(apiUrl, publishableKey, { auth: { persistSession: false } });
    for (const table of ["board", "meeting", "membership", "payment_charge", "app_user", "meeting_note", "meeting_rating", "rating_link", "notification_template"]) {
      const { data } = await anon.from(table).select("*").limit(5);
      expect(data ?? [], `anon må ikke læse ${table}`).toHaveLength(0);
    }
  });

  test("en ejer ser kun sit eget board og sine egne møder", async () => {
    const owner = await signedIn(USERS.ejer);
    const { data: boards } = await owner.from("board").select("id, owner_id");
    expect(boards).toHaveLength(1);
    const { data: foreign } = await owner.from("board").select("id").eq("id", OTHER_OWNER_BOARD);
    expect(foreign).toHaveLength(0);
    const { data: foreignMeetings } = await owner.from("meeting").select("id").eq("board_id", OTHER_OWNER_BOARD);
    expect(foreignMeetings).toHaveLength(0);
    const { data: foreignNotes } = await owner.from("meeting_note").select("id");
    expect(foreignNotes).toHaveLength(0);
  });

  test("en ejer kan ikke skrive til forretningstabeller eller give sig selv en rolle", async () => {
    const owner = await signedIn(USERS.ejer);
    const { data: me } = await owner.auth.getUser();
    const escalate = await owner.from("user_role_assignment").insert({ user_id: me.user?.id, role: "admin" });
    expect(escalate.error).not.toBeNull();
    const rule = await owner
      .from("pricing_rule")
      .insert({ version: 99, base_amount_minor: 1, per_partner_amount_minor: 1, factor_4_weeks: 1, factor_8_weeks: 1, factor_12_weeks: 1 });
    expect(rule.error).not.toBeNull();
    const board = await owner.from("board").update({ name: "Overtaget" }).eq("id", OTHER_OWNER_BOARD).select();
    expect(board.data ?? []).toHaveLength(0);
  });

  test("en partner ser ikke andre partneres honorar eller noter", async () => {
    const partner = await signedIn(USERS.partner);
    const { data: lines } = await partner.from("partner_fee_line").select("partner_profile_id");
    for (const line of (lines ?? []) as Array<{ partner_profile_id: string }>) {
      expect(line.partner_profile_id).toBe("d0000000-0000-4000-8000-000000000301");
    }
    const { data: notes } = await partner.from("meeting_note").select("partner_profile_id");
    for (const note of (notes ?? []) as Array<{ partner_profile_id: string }>) {
      expect(note.partner_profile_id).toBe("d0000000-0000-4000-8000-000000000301");
    }
    const { data: templates } = await partner.from("notification_template").select("id");
    expect(templates ?? []).toHaveLength(0);
  });
});
