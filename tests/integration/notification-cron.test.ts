import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cron/notifications/route";

// Supabase-klienten mockes: ruten må ikke nå en rigtig base. Kataloget har intet tidspunkt, så
// en korrekt autoriseret kørsel skal svare 'ikke fastlagt' uden at røre klienten.
const mocked = vi.hoisted(() => ({ touched: false }));
vi.mock("@/server/auth/supabase-server", () => ({
  createServiceSupabase: () =>
    new Proxy({}, {
      get() {
        mocked.touched = true;
        throw new Error("Klienten må ikke røres når tidspunktet ikke er fastlagt");
      },
    }),
  createServerSupabase: async () => ({}),
}));

function call(secret?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/cron/notifications", {
      method: "POST",
      headers: secret === undefined ? {} : { "x-cron-secret": secret },
    }),
  );
}

describe("/api/cron/notifications — beskyttet, men ikke planlagt (TODO(ejer))", () => {
  beforeEach(() => {
    mocked.touched = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("503 uden CRON_SECRET — åbnes aldrig uden hemmelighed", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("noget")).status).toBe(503);
  });

  it("401 uden eller med forkert hemmelighed", async () => {
    vi.stubEnv("CRON_SECRET", "den-rigtige");
    expect((await call()).status).toBe(401);
    expect((await call("den-forkerte")).status).toBe(401);
    expect((await call("")).status).toBe(401);
  });

  it("503 når Supabase ikke er konfigureret (efter hemmeligheden er godkendt)", async () => {
    vi.stubEnv("CRON_SECRET", "den-rigtige");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await call("den-rigtige")).status).toBe(503);
  });

  it("med den rigtige hemmelighed svarer begge kørsler 'ikke fastlagt' og sender intet", async () => {
    vi.stubEnv("CRON_SECRET", "den-rigtige");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");

    const response = await call("den-rigtige");

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, { status: string }>;
    expect(body.reminders?.status).toBe("ikke-fastlagt");
    expect(body.ratings?.status).toBe("ikke-fastlagt");
    expect(mocked.touched).toBe(false);
  });
});
