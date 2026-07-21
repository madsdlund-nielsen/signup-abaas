import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { provisionOwner } from "@/server/auth/provisioning";

interface UpsertCall {
  table: string;
  values: Record<string, unknown>;
  options?: { onConflict?: string };
}

/** Minimal fake af service-klienten: registrerer upsert-kald og returnerer valgt fejl. */
function fakeService(errors: Record<string, { message: string }> = {}) {
  const calls: UpsertCall[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(values: Record<string, unknown>, options?: { onConflict?: string }) {
          calls.push({ table, values, options });
          return Promise.resolve({ error: errors[table] ?? null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("provisionOwner", () => {
  it("opretter app_user og tildeler 'ejer'-rollen (idempotent upserts)", async () => {
    const { client, calls } = fakeService();
    await provisionOwner(client, "user-1", "ejer@example.dk");

    expect(calls).toHaveLength(2);
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
    const { client, calls } = fakeService({ app_user: { message: "boom" } });
    await expect(provisionOwner(client, "u", "e@x.dk")).rejects.toThrow(/app_user/);
    expect(calls).toHaveLength(1);
  });

  it("kaster hvis rolletildeling fejler", async () => {
    const { client } = fakeService({ user_role_assignment: { message: "nope" } });
    await expect(provisionOwner(client, "u", "e@x.dk")).rejects.toThrow(/rolletildeling/);
  });
});
