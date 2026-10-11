import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  NO_PHONE_REASON,
  createSupabaseNotificationStore,
} from "@/server/notifications/store";

/**
 * Modtager-opslaget i Supabase-lageret (skive K, ADR 0061): SMS kræver et nummer (samtykket er kontrakten, ADR 0065).
 * Klienten er en minimal dobbeltgænger der svarer med én `app_user`-række og husker hvilke
 * kolonner der blev spurgt om — så testen også vogter at e-mail ikke læses til en SMS.
 */
type Row = Record<string, unknown> | null;

function fakeService(row: Row, error: { message: string } | null = null) {
  const selects: string[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe("app_user");
      return {
        select: (columns: string) => {
          selects.push(columns);
          return { eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, selects };
}

const USER = "00000000-0000-0000-0000-00000000000a";

describe("resolveRecipient — SMS kræver et telefonnummer (samtykket er kontrakten, ADR 0065)", () => {
  it("giver nummeret — uden noget samtykke ved siden af", async () => {
    const { client } = fakeService({ phone_e164: "+4500000000" });
    const store = createSupabaseNotificationStore(client);
    expect(await store.resolveRecipient(USER, "sms")).toEqual({ address: "+4500000000" });
  });

  it("NEGATIV: uden telefonnummer er der ingen adresse, og begrundelsen er 'intet telefonnummer'", async () => {
    const { client } = fakeService({ phone_e164: null });
    const store = createSupabaseNotificationStore(client);
    expect(await store.resolveRecipient(USER, "sms")).toEqual({ address: null, reason: NO_PHONE_REASON });
  });

  it("NEGATIV: ingen række og en tom række lander begge i samme begrundelse", async () => {
    const store = createSupabaseNotificationStore(fakeService(null).client);
    expect(await store.resolveRecipient(USER, "sms")).toEqual({ address: null, reason: NO_PHONE_REASON });
    const empty = createSupabaseNotificationStore(fakeService({}).client);
    expect(await empty.resolveRecipient(USER, "sms")).toEqual({ address: null, reason: NO_PHONE_REASON });
  });

  it("begrundelsen er den aftalte tekst og indeholder aldrig et telefonnummer", () => {
    expect(NO_PHONE_REASON).toBe("intet telefonnummer");
  });

  it("e-mail påvirkes ikke af telefonnummeret", async () => {
    const { client, selects } = fakeService({ email: "modtager@example.invalid" });
    const store = createSupabaseNotificationStore(client);
    expect(await store.resolveRecipient(USER, "email")).toEqual({ address: "modtager@example.invalid" });
    expect(selects).toEqual(["email"]);
  });

  it("SMS-opslaget læser ikke e-mailadressen", async () => {
    const { client, selects } = fakeService({ phone_e164: "+4500000000" });
    await createSupabaseNotificationStore(client).resolveRecipient(USER, "sms");
    expect(selects).toEqual(["phone_e164"]);
  });

  it("fejler højlydt hvis basen svarer med en fejl (ingen stille 'intet nummer')", async () => {
    const store = createSupabaseNotificationStore(fakeService(null, { message: "nede" }).client);
    await expect(store.resolveRecipient(USER, "sms")).rejects.toThrow(/Kunne ikke læse modtageren/);
  });
});

describe("resolveRecipientName", () => {
  async function nameOf(row: Row): Promise<string | null> {
    return createSupabaseNotificationStore(fakeService(row).client).resolveRecipientName(USER);
  }

  it("trimmer navnet, og et tomt eller manglende navn er 'intet navn'", async () => {
    expect(await nameOf({ display_name: "  [DEMO] Eva  " })).toBe("[DEMO] Eva");
    expect(await nameOf({ display_name: "   " })).toBeNull();
    expect(await nameOf({ display_name: null })).toBeNull();
    expect(await nameOf(null)).toBeNull();
  });
});
