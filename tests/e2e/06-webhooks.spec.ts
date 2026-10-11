/**
 * Webhooks (fase 6.1/6.2): signaturverifikation og idempotens under bevidst genafspilning mod den
 * rigtige database. Hemmelighederne er kendte lokale testværdier, så testen kan signere præcis som
 * leverandøren — men intet her aktiverer en rigtig adapter (der er ingen leverandørnøgler).
 *
 * Kører sidst: den aflyser et planlagt møde og markerer seed-opkrævningen som fejlet.
 */

import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

import { serviceClient } from "./support/data";
import { E2E_ALUNTA_WEBHOOK_SECRET, E2E_CALCOM_WEBHOOK_SECRET } from "./support/env";

const SEED_MEMBERSHIP = "d0000000-0000-4000-8000-000000000501";
const SEED_CHARGE = "d0000000-0000-4000-8000-000000000b01";

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test.describe.configure({ mode: "serial" });

test.describe("Cal.com-webhook", () => {
  // Et møde som rejserne har booket og som stadig er planlagt (demo-bookingens uid er DEMO-…).
  let meetingId = "";
  let bookingUid = "";
  let body = "";

  test.beforeAll(async () => {
    const { data, error } = await serviceClient()
      .from("meeting")
      .select("id, provider_booking_uid")
      .eq("status", "planlagt")
      .not("provider_booking_uid", "is", null)
      .limit(1)
      .single();
    expect(error).toBeNull();
    meetingId = (data as { id: string }).id;
    bookingUid = (data as { provider_booking_uid: string }).provider_booking_uid;
    body = JSON.stringify({
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: "2026-10-11T08:00:00.000Z",
      payload: { uid: bookingUid },
    });
  });

  test("afviser manglende og forkert signatur (401) uden at røre noget", async ({ request }) => {
    const missing = await request.post("/api/webhooks/calcom", { data: body, headers: { "content-type": "application/json" } });
    expect(missing.status()).toBe(401);
    const wrong = await request.post("/api/webhooks/calcom", {
      data: body,
      headers: { "content-type": "application/json", "x-cal-signature-256": sign("forkert-hemmelighed", body) },
    });
    expect(wrong.status()).toBe(401);

    const { data } = await serviceClient().from("meeting").select("status").eq("id", meetingId).single();
    expect((data as { status: string }).status).toBe("planlagt");
  });

  test("anvender en signeret aflysning præcis én gang, også ved genafspilning", async ({ request }) => {
    const headers = {
      "content-type": "application/json",
      "x-cal-signature-256": sign(E2E_CALCOM_WEBHOOK_SECRET, body),
    };
    const first = await request.post("/api/webhooks/calcom", { data: body, headers });
    expect(first.status()).toBe(200);
    expect(await first.text()).not.toContain("Allerede behandlet");

    // Mødet er aflyst i Supabase (sandhedskilden følger leverandørens hændelse).
    const { data } = await serviceClient().from("meeting").select("status").eq("id", meetingId).single();
    expect((data as { status: string }).status).toBe("aflyst");

    // Genafspilning: samme bytes, samme signatur → 200 «allerede behandlet», ingen ny mutation.
    for (let i = 0; i < 3; i += 1) {
      const replay = await request.post("/api/webhooks/calcom", { data: body, headers });
      expect(replay.status()).toBe(200);
      expect(await replay.text()).toContain("Allerede behandlet");
    }
    const { count } = await serviceClient()
      .from("meeting_webhook_event")
      .select("*", { count: "exact", head: true })
      .eq("provider_booking_uid", bookingUid);
    expect(count).toBe(1);
  });

  test("en booking der ikke findes oprettes aldrig af en webhook", async ({ request }) => {
    const unknown = JSON.stringify({
      triggerEvent: "BOOKING_CREATED",
      createdAt: "2026-10-11T09:00:00.000Z",
      payload: { uid: "DEMO-UKENDT-BOOKING", startTime: "2026-12-01T10:00:00.000Z" },
    });
    const before = await serviceClient().from("meeting").select("*", { count: "exact", head: true });
    const response = await request.post("/api/webhooks/calcom", {
      data: unknown,
      headers: { "content-type": "application/json", "x-cal-signature-256": sign(E2E_CALCOM_WEBHOOK_SECRET, unknown) },
    });
    expect(response.status()).toBe(200);
    const after = await serviceClient().from("meeting").select("*", { count: "exact", head: true });
    expect(after.count).toBe(before.count);
  });
});

test.describe("Alunta-webhook", () => {
  const body = JSON.stringify({
    event: "invoice.payment_failed",
    timestamp: "2026-10-11T08:00:00.000Z",
    data: {
      event_id: "e2e-event-1",
      customer: { uuid: `DEMO-CUSTOMER-${SEED_MEMBERSHIP}` },
      invoice: { uuid: "DEMO-INVOICE-E2E-1" },
      error: "[E2E] kort afvist",
    },
  });

  test("afviser forkert signatur (401)", async ({ request }) => {
    const response = await request.post("/api/webhooks/alunta", {
      data: body,
      headers: { "content-type": "application/json", signature: sign("forkert-hemmelighed", body) },
    });
    expect(response.status()).toBe(401);
  });

  test("markerer opkrævningen som fejlet præcis én gang under genafspilning", async ({ request }) => {
    const headers = { "content-type": "application/json", signature: sign(E2E_ALUNTA_WEBHOOK_SECRET, body) };
    const first = await request.post("/api/webhooks/alunta", { data: body, headers });
    expect(first.status()).toBe(200);

    const { data } = await serviceClient()
      .from("payment_charge")
      .select("status, failure_reason, provider_invoice_ref")
      .eq("id", SEED_CHARGE)
      .single();
    expect(data).toEqual({ status: "fejlet", failure_reason: "[E2E] kort afvist", provider_invoice_ref: "DEMO-INVOICE-E2E-1" });

    const replay = await request.post("/api/webhooks/alunta", { data: body, headers });
    expect(replay.status()).toBe(200);
    expect(await replay.text()).toContain("Allerede behandlet");
    const { count } = await serviceClient()
      .from("payment_webhook_event")
      .select("*", { count: "exact", head: true })
      .eq("provider", "alunta");
    expect(count).toBe(1);
  });
});
