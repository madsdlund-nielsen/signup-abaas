import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRecordingConsent } from "@/server/consent/recording";

/**
 * Grundlaget for mødeoptagelse (ADR 0065): kontrakten dækker ethvert møde på platformen; et møde
 * der ikke findes har intet grundlag. Ingen tabel, ingen tilbagekaldelse — kun "findes mødet?".
 */
function fakeService(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  const calls: Array<{ table: string; column: string; value: unknown }> = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          calls.push({ table, column, value });
          return { maybeSingle: async () => ({ data: row, error }) };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("getRecordingConsent — kontrakten som grundlag", () => {
  it("et møde der findes giver et kontrakt-grundlag for netop dette møde", async () => {
    const { client, calls } = fakeService({ id: "m-1" });
    expect(await getRecordingConsent("m-1", client)).toEqual({ meetingId: "m-1", basis: "kontrakt" });
    expect(calls).toEqual([{ table: "meeting", column: "id", value: "m-1" }]);
  });

  it("NEGATIV: et ukendt møde har intet grundlag (fejler lukket)", async () => {
    const { client } = fakeService(null);
    expect(await getRecordingConsent("m-ukendt", client)).toBeNull();
  });

  it("NEGATIV: en læsefejl er ikke et grundlag — null, og kun mødets id i loggen", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeService({ id: "m-1" }, { message: "forbindelse tabt" });
    expect(await getRecordingConsent("m-1", client)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain("m-1");
  });

  it("NEGATIV: ukonfigureret Supabase giver intet grundlag", async () => {
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      vi.stubEnv(key, "");
    }
    expect(await getRecordingConsent("m-1")).toBeNull();
  });
});
