import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { provisionPartner } from "@/server/auth/provisioning";

interface FakeOpts {
  /** Katalogpostens nuværende kobling (null = ledig). Undefined-post = findes ikke. */
  profile?: { id: string; app_user_id: string | null } | null;
  /** Simulér tavs skrivefejl: rollen lander aldrig (forkert nøgle → RLS blokerer). */
  dropWrites?: boolean;
  updateError?: { message: string };
}

/** Fake for præcis de kæder provisionPartner bruger (DI, ikke mocks — tests/CLAUDE.md). */
function fakeService(opts: FakeOpts = {}) {
  const roles = new Set<string>();
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              if (table === "partner_profile") {
                return {
                  maybeSingle: () =>
                    Promise.resolve({ data: opts.profile ?? null, error: null }),
                };
              }
              // user_role_assignment-verifikation
              return Promise.resolve({
                data: [...roles].map((role) => ({ role })),
                error: null,
              });
            },
          };
        },
        upsert(values: Record<string, unknown>) {
          if (table === "user_role_assignment" && !opts.dropWrites) roles.add(String(values.role));
          return Promise.resolve({ error: null });
        },
        update(values: Record<string, unknown>) {
          updates.push(values);
          return {
            eq() {
              return {
                select() {
                  return {
                    single: () =>
                      opts.updateError
                        ? Promise.resolve({ data: null, error: opts.updateError })
                        : Promise.resolve({ data: { app_user_id: values.app_user_id }, error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

describe("provisionPartner (2.8, ADR 0025)", () => {
  it("kobler katalogpost ↔ bruger og tildeler rollen 'partner'", async () => {
    const { client, updates } = fakeService({ profile: { id: "p1", app_user_id: null } });
    await provisionPartner(client, "user-1", "partner@example.dk", "p1");
    expect(updates[0]).toMatchObject({ app_user_id: "user-1" });
  });

  it("er idempotent: allerede koblet til SAMME bruger er ok", async () => {
    const { client } = fakeService({ profile: { id: "p1", app_user_id: "user-1" } });
    await expect(provisionPartner(client, "user-1", "p@x.dk", "p1")).resolves.toBeUndefined();
  });

  it("NEGATIV: nægter at stjæle en katalogpost koblet til en ANDEN bruger", async () => {
    const { client, updates } = fakeService({ profile: { id: "p1", app_user_id: "anden-bruger" } });
    await expect(provisionPartner(client, "user-1", "p@x.dk", "p1")).rejects.toThrow(/anden bruger/);
    expect(updates).toHaveLength(0);
  });

  it("NEGATIV: kaster hvis katalogposten ikke findes", async () => {
    const { client } = fakeService({ profile: null });
    await expect(provisionPartner(client, "u", "p@x.dk", "ukendt")).rejects.toThrow(/findes ikke/);
  });

  it("kaster hvis koblingen ikke kan skrives", async () => {
    const { client } = fakeService({
      profile: { id: "p1", app_user_id: null },
      updateError: { message: "nope" },
    });
    await expect(provisionPartner(client, "u", "p@x.dk", "p1")).rejects.toThrow(/kobling/);
  });

  it("kaster hvis rollen ikke landede (tavs skrivefejl → forkert service-nøgle/RLS)", async () => {
    const { client } = fakeService({ profile: { id: "p1", app_user_id: null }, dropWrites: true });
    await expect(provisionPartner(client, "u", "p@x.dk", "p1")).rejects.toThrow(/blev ikke skrevet/);
  });
});
