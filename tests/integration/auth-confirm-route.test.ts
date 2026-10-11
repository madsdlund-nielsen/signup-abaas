import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bekræftelsesruten `/auth/confirm` (B-70, ADR 0073) og de to server-actions bag «glemt adgangskode»
 * og «sæt adgangskode». Vi mocker kun Supabase-klienten (`createServerSupabase`), `redirect` og
 * rolleopslaget — ruternes og actionernes egen logik kører som i produktion.
 */

interface FakeAuth {
  verifyOtp: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
}

const state = vi.hoisted(() => ({
  auth: null as unknown as FakeAuth,
  roles: ["ejer"] as string[],
}));

vi.mock("@/server/auth/supabase-server", () => ({
  createServerSupabase: async () => ({ auth: state.auth }),
  createServiceSupabase: () => {
    throw new Error("service-role må ikke bruges af disse flows");
  },
}));

vi.mock("@/server/auth/index", () => ({
  getCurrentUser: async () => ({ id: "u1", email: "a@b.dk", roles: state.roles }),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

const { GET } = await import("@/app/auth/confirm/route");
const { requestPasswordResetAction, setPasswordAction } = await import("@/server/auth/actions");

const ORIGIN = "https://app.example.dk";

function confirm(query: string) {
  return GET(new NextRequest(`${ORIGIN}/auth/confirm?${query}`));
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  state.roles = ["ejer"];
  state.auth = {
    verifyOtp: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    updateUser: vi.fn(async () => ({ error: null })),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /auth/confirm", () => {
  it("indløser tokenet server-side og sender invitationen til «sæt adgangskode»", async () => {
    const response = await confirm("token_hash=abc123&type=invite&next=/konto/adgangskode");

    expect(state.auth.verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "abc123" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/konto/adgangskode`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("uden next lander nulstilling stadig på «sæt adgangskode»", async () => {
    const response = await confirm("token_hash=abc123&type=recovery");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/konto/adgangskode`);
  });

  it.each([
    "next=//evil.example",
    "next=https://evil.example/konto",
    "next=/%5Cevil.example",
    "next=/\\evil.example",
  ])("åben redirect (%s) forlader aldrig vores origin", async (next) => {
    const response = await confirm(`token_hash=abc&type=recovery&${next}`);
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/konto/adgangskode");
  });

  it("ukendt type indløses ikke og sender roligt til login", async () => {
    const response = await confirm("token_hash=abc&type=magiclink");
    expect(state.auth.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?fejl=ugyldigt-link`);
  });

  it("manglende token indløses ikke", async () => {
    const response = await confirm("type=invite");
    expect(state.auth.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?fejl=ugyldigt-link`);
  });

  it("brugt eller udløbet token giver samme rolige fejl — og røber ikke årsagen", async () => {
    state.auth.verifyOtp.mockResolvedValueOnce({ error: { message: "Email link is invalid or has expired" } });
    const response = await confirm("token_hash=abc&type=invite");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?fejl=ugyldigt-link`);
    expect(response.headers.get("location")).not.toContain("expired");
  });

  it("uden Supabase-konfiguration svarer ruten roligt i stedet for at kaste", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await confirm("token_hash=abc&type=invite");
    expect(state.auth.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?fejl=ikke-konfigureret`);
  });
});

describe("requestPasswordResetAction (glemt adgangskode)", () => {
  it("svarer det samme uanset om kontoen findes eller Supabase afviser kaldet", async () => {
    const found = await requestPasswordResetAction({}, form({ email: "findes@firma.dk" }));

    state.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: "User not found" } });
    const unknown = await requestPasswordResetAction({}, form({ email: "findes-ikke@firma.dk" }));

    state.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: "Email rate limit exceeded" } });
    const limited = await requestPasswordResetAction({}, form({ email: "findes@firma.dk" }));

    expect(found.notice).toMatch(/Hvis adressen findes/);
    expect(unknown).toEqual(found);
    expect(limited).toEqual(found);
    expect(found.error).toBeUndefined();
  });

  it("kalder Supabase med den trimmede adresse", async () => {
    await requestPasswordResetAction({}, form({ email: "  findes@firma.dk " }));
    expect(state.auth.resetPasswordForEmail).toHaveBeenCalledWith("findes@firma.dk");
  });

  it("tom e-mail afvises uden kald", async () => {
    const result = await requestPasswordResetAction({}, form({ email: "  " }));
    expect(result.error).toBeTruthy();
    expect(state.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("uden Supabase-konfiguration: pæn besked", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const result = await requestPasswordResetAction({}, form({ email: "a@b.dk" }));
    expect(result.error).toMatch(/ikke konfigureret/);
  });
});

describe("setPasswordAction (sæt adgangskode)", () => {
  it("kræver en session — uden en ændres intet", async () => {
    state.auth.getUser.mockResolvedValueOnce({ data: { user: null } });
    const result = await setPasswordAction({}, form({ password: "langt-nok-123", repeat: "langt-nok-123" }));
    expect(result.error).toMatch(/session er udløbet/);
    expect(state.auth.updateUser).not.toHaveBeenCalled();
  });

  it("afviser for kort adgangskode og uens felter før noget kaldes", async () => {
    const short = await setPasswordAction({}, form({ password: "kort", repeat: "kort" }));
    const mismatch = await setPasswordAction({}, form({ password: "langt-nok-123", repeat: "langt-nok-124" }));
    expect(short.error).toMatch(/for kort/);
    expect(mismatch.error).toMatch(/ikke ens/);
    expect(state.auth.getUser).not.toHaveBeenCalled();
    expect(state.auth.updateUser).not.toHaveBeenCalled();
  });

  it("opdaterer adgangskoden og sender en ejer til dashboardet", async () => {
    await expect(
      setPasswordAction({}, form({ password: "langt-nok-123", repeat: "langt-nok-123" })),
    ).rejects.toMatchObject({ to: "/dashboard" });
    expect(state.auth.updateUser).toHaveBeenCalledWith({ password: "langt-nok-123" });
  });

  it("sender en inviteret partner til portalen", async () => {
    state.roles = ["partner"];
    await expect(
      setPasswordAction({}, form({ password: "langt-nok-123", repeat: "langt-nok-123" })),
    ).rejects.toMatchObject({ to: "/partner" });
  });

  it("oversætter Supabase' fejl til dansk uden at lække den rå tekst", async () => {
    state.auth.updateUser.mockResolvedValueOnce({
      error: { message: "New password should be different from the old password." },
    });
    const result = await setPasswordAction({}, form({ password: "langt-nok-123", repeat: "langt-nok-123" }));
    expect(result.error).toMatch(/ikke har brugt før/);
    expect(result.error).not.toMatch(/different/);
  });
});
