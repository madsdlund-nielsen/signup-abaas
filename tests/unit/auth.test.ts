import { describe, expect, it } from "vitest";
import { createSessionProvider, requireRole } from "@/server/auth";
import { SupabaseSessionProvider } from "@/server/auth/supabase-provider";
import type { AuthUser } from "@/server/auth";
import type { SupabaseAuthGateway } from "@/server/auth/supabase-provider";

const CONFIGURED_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

describe("createSessionProvider (env-styret valg)", () => {
  it("uden Supabase-nøgler returneres stub (kontofri CI)", () => {
    expect(createSessionProvider({}).name).toBe("stub");
  });

  it("mangler service-role-nøglen alene → stadig stub", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _omit, ...partial } = CONFIGURED_ENV;
    void _omit;
    expect(createSessionProvider(partial).name).toBe("stub");
  });

  it("med fuld Supabase-konfiguration returneres Supabase-provideren", () => {
    expect(createSessionProvider(CONFIGURED_ENV).name).toBe("supabase");
  });
});

describe("SupabaseSessionProvider.getCurrentUser", () => {
  function providerWith(gateway: SupabaseAuthGateway): SupabaseSessionProvider {
    return new SupabaseSessionProvider(async () => gateway);
  }

  it("mapper session + roller til AuthUser", async () => {
    const provider = providerWith({
      async getAuthUser() {
        return { id: "u1", email: "u1@example.dk" };
      },
      async getRoles() {
        return ["admin", "ejer"];
      },
    });
    expect(await provider.getCurrentUser()).toEqual({
      id: "u1",
      email: "u1@example.dk",
      roles: ["admin", "ejer"],
    });
  });

  it("ingen session → null (og roller slås ikke op)", async () => {
    let rolesCalled = false;
    const provider = providerWith({
      async getAuthUser() {
        return null;
      },
      async getRoles() {
        rolesCalled = true;
        return [];
      },
    });
    expect(await provider.getCurrentUser()).toBeNull();
    expect(rolesCalled).toBe(false);
  });

  it("email = null falder tilbage til tom streng", async () => {
    const provider = providerWith({
      async getAuthUser() {
        return { id: "u2", email: null };
      },
      async getRoles() {
        return [];
      },
    });
    expect((await provider.getCurrentUser())?.email).toBe("");
  });
});

describe("requireRole", () => {
  const user: AuthUser = { id: "u1", email: "u1@example.dk", roles: ["partner"] };

  it("returnerer brugeren når rollen haves", () => {
    expect(requireRole(user, "partner")).toBe(user);
  });

  it("kaster når rollen mangler", () => {
    expect(() => requireRole(user, "admin")).toThrow();
  });

  it("kaster for anonym bruger", () => {
    expect(() => requireRole(null, "partner")).toThrow();
  });
});
