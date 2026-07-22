import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { provisionOwner } from "@/server/auth/provisioning";

interface UpsertCall {
  table: string;
  values: Record<string, unknown>;
  options?: { onConflict?: string };
}

interface FakeOpts {
  /** Fejl returneret fra upsert pr. tabel. */
  upsertError?: Record<string, { message: string }>;
  /** Fejl returneret fra verifikations-select. */
  selectError?: { message: string };
  /** Simulér at skrivningen ikke landede (fx forkert service-nøgle → RLS blokerer tavst). */
  dropWrites?: boolean;
}

/** Fake af service-klienten med både upsert- og select().eq()-kæder + et lille rolle-lager. */
function fakeService(opts: FakeOpts = {}) {
  const calls: UpsertCall[] = [];
  const roles = new Set<string>();
  const client = {
    from(table: string) {
      return {
        upsert(values: Record<string, unknown>, options?: { onConflict?: string }) {
          calls.push({ table, values, options });
          const err = opts.upsertError?.[table];
          if (err) return Promise.resolve({ error: err });
          if (table === "user_role_assignment" && !opts.dropWrites) {
            roles.add(String(values.role));
          }
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq() {
              if (opts.selectError) return Promise.resolve({ data: null, error: opts.selectError });
              return Promise.resolve({
                data: [...roles].map((role) => ({ role })),
                error: null,
              });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("provisionOwner", () => {
  it("opretter app_user, tildeler 'ejer' og verificerer skrivningen", async () => {
    const { client, calls } = fakeService();
    await provisionOwner(client, "user-1", "ejer@example.dk");

    expect(calls[0]).toEqual({
      table: "app_user",
      values: { id: "user-1", email: "ejer@example.dk" },
      options: { onConflict: "id" },
    });
    expect(calls[1]).toEqual({
      table: "user_role_assignment",
      values: { user_id: "user-1", role: "ejer" },
      options: { onConflict: "user_id,role" },
    });
  });

  it("kaster hvis app_user-upsert fejler (og springer rolletildeling over)", async () => {
    const { client, calls } = fakeService({ upsertError: { app_user: { message: "boom" } } });
    await expect(provisionOwner(client, "u", "e@x.dk")).rejects.toThrow(/app_user/);
    expect(calls).toHaveLength(1);
  });

  it("kaster hvis rolletildeling fejler", async () => {
    const { client } = fakeService({ upsertError: { user_role_assignment: { message: "nope" } } });
    await expect(provisionOwner(client, "u", "e@x.dk")).rejects.toThrow(/rolletildeling/);
  });

  it("kaster hvis rollen ikke landede (tavs skrivefejl → forkert service-nøgle/RLS)", async () => {
    const { client } = fakeService({ dropWrites: true });
    await expect(provisionOwner(client, "u", "e@x.dk")).rejects.toThrow(/blev ikke skrevet/);
  });

  it("kaster hvis verifikations-læsningen fejler", async () => {
    const { client } = fakeService({ selectError: { message: "read denied" } });
    await expect(provisionOwner(client, "u", "e@x.dk")).rejects.toThrow(/verifikation/);
  });
});
