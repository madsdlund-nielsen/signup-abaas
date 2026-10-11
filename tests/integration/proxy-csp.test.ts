import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../../next.config";
import { proxy } from "@/proxy";
import { staticHeaderRules } from "@/server/security/headers";

// Sessionsopfriskningen genopbygger svaret når den skriver cookies. Mocken kalder setAll, som
// den rigtige klient gør ved en udløbet token, så vi kan se at CSP'en overlever genopbygningen.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: { setAll: (c: Array<{ name: string; value: string; options: object }>) => void };
    },
  ) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll([{ name: "sb-token", value: "ny", options: {} }]);
        return { data: { user: null } };
      },
    },
  }),
}));

/**
 * Proxyen sætter Content-Security-Policy med en frisk nonce pr. request (fase 6.2, ADR 0070)
 * — og lader den ligge på request-headeren, hvor Next læser den og stempler sine egne scripts.
 * Uden Supabase-konfiguration (kontofri CI) tager proxyen den korte vej; den skal bære CSP'en
 * dér også, ellers ville CI-bygget og produktion opføre sig forskelligt.
 */
function request(path = "/", init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://abaas.example${path}`, init);
}

const nonceOf = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("APP_GATE_ENABLED", "");
  vi.stubEnv("CSP_REPORT_ONLY", "");
  vi.stubEnv("FLAG_ANALYTICS", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — CSP", () => {
  it("sætter CSP med nonce på svaret", async () => {
    const response = await proxy(request());
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("upgrade-insecure-requests"); // https-request
  });

  it("åbner kun PostHog EU når browser-analytics er slået til (FLAG_ANALYTICS + nøgle) — ADR 0072", async () => {
    const csp = async () => (await proxy(request())).headers.get("content-security-policy") ?? "";
    expect(await csp()).not.toContain("posthog");

    vi.stubEnv("FLAG_ANALYTICS", "true");
    expect(await csp()).not.toContain("posthog"); // flag uden browser-nøgle
    vi.stubEnv("FLAG_ANALYTICS", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    expect(await csp()).not.toContain("posthog"); // nøgle uden flag

    vi.stubEnv("FLAG_ANALYTICS", "true");
    const open = await csp();
    expect(open).toContain("connect-src 'self' https://eu.i.posthog.com https://eu-assets.i.posthog.com");
  });

  it("giver Next den samme politik på request-headeren, så nonce'n stemples på scripts", async () => {
    const response = await proxy(request());
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
  });

  it("bruger en ny nonce for hver request", async () => {
    const a = nonceOf((await proxy(request())).headers.get("content-security-policy") ?? "");
    const b = nonceOf((await proxy(request())).headers.get("content-security-policy") ?? "");
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("opgraderer ikke til https over http (localhost/next start ville brydes)", async () => {
    const response = await proxy(new NextRequest("http://localhost:3000/"));
    expect(response.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
  });

  it("CSP_REPORT_ONLY=true skifter til Report-Only på både request og svar", async () => {
    vi.stubEnv("CSP_REPORT_ONLY", "true");
    const response = await proxy(request());
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("content-security-policy-report-only")).toContain("nonce-");
    expect(response.headers.get("x-middleware-request-content-security-policy-report-only")).toContain(
      "nonce-",
    );
  });

  it("med Supabase: CSP overlever at sessionsopfriskningen genopbygger svaret, og cookien følger med", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projekt.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const response = await proxy(request("/dashboard"));
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("nonce-");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(response.cookies.get("sb-token")?.value).toBe("ny");
    // De opfriskede cookies skal også nå serverkomponenterne via request-headeren.
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-token=ny");
  });

  it("adgangsporten kører stadig før alt: uden cookie omdirigeres til /gate", async () => {
    vi.stubEnv("APP_GATE_ENABLED", "true");
    vi.stubEnv("APP_GATE_PASSWORD_HASH", "salt:hash");
    vi.stubEnv("APP_GATE_COOKIE_SECRET", "hemmelighed");
    const response = await proxy(request("/login"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/gate");
  });
});

describe("next.config — statiske sikkerhedsheadere", () => {
  it("udstiller headers() med de samme regler som modulet", async () => {
    expect(await nextConfig.headers?.()).toEqual(staticHeaderRules());
  });
});
