import { describe, expect, it } from "vitest";

import {
  buildCsp,
  cspHeaderName,
  generateNonce,
  HSTS,
  NO_REFERRER_SOURCE,
  DEFAULT_REFERRER_SOURCE,
  PERMISSIONS_POLICY,
  staticHeaderRules,
} from "@/server/security/headers";

/**
 * Sikkerhedsheadere og CSP (fase 6.2, ADR 0070). Testene vogter de valg der er farlige at
 * ændre ubemærket: at script-src aldrig får `unsafe-inline`, at browseren kun må tale med
 * appens egen oprindelse, at siden ikke kan indrammes, og at rating-linket aldrig lækker.
 */
function directive(csp: string, name: string): string[] {
  const found = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  if (!found) throw new Error(`direktivet ${name} mangler i: ${csp}`);
  return found.split(/\s+/).slice(1);
}

describe("generateNonce", () => {
  it("er base64, 128 bit, og forskellig hver gang", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});

describe("buildCsp", () => {
  const nonce = "TESTNONCE123456789012==";
  const csp = buildCsp({ nonce });

  it("script-src bruger nonce + strict-dynamic og aldrig unsafe-inline/unsafe-eval i produktion", () => {
    const script = directive(csp, "script-src");
    expect(script).toContain(`'nonce-${nonce}'`);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("udvikling tillader unsafe-eval (React-fejlsporing) og inline-styles (HMR) — men aldrig inline scripts", () => {
    const dev = buildCsp({ nonce, isDev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(dev, "style-src")).toContain("'unsafe-inline'");
  });

  it("style-src bruger nonce i produktion; inline style-ATTRIBUTTER er det eneste bevidste hul", () => {
    expect(directive(csp, "style-src")).toContain(`'nonce-${nonce}'`);
    expect(directive(csp, "style-src")).not.toContain("'unsafe-inline'");
    expect(directive(csp, "style-src-attr")).toEqual(["'unsafe-inline'"]);
  });

  it("browseren må kun tale med egen oprindelse (connect-src), og intet må indrammes eller indlejres", () => {
    expect(directive(csp, "connect-src")).toEqual(["'self'"]);
    expect(directive(csp, "frame-src")).toEqual(["'none'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
  });

  it("de eneste eksterne værter er Google Fonts (B-81) — og https: til partnerportrætter (B-82)", () => {
    const hosts = csp.match(/https:\/\/[a-z.]+/g) ?? [];
    expect(new Set(hosts)).toEqual(new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]));
    expect(directive(csp, "img-src")).toContain("https:");
    expect(directive(csp, "font-src")).toEqual(["'self'", "https://fonts.gstatic.com"]);
  });

  it("upgrade-insecure-requests kun når bedt om (ellers brydes localhost over http)", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce, upgradeInsecure: true })).toContain("upgrade-insecure-requests");
  });

  it("er én linje uden linjeskift (gyldig headerværdi)", () => {
    expect(csp).not.toMatch(/[\r\n]/);
  });
});

describe("cspHeaderName", () => {
  it("håndhæver som standard", () => {
    expect(cspHeaderName({})).toBe("Content-Security-Policy");
    expect(cspHeaderName({ CSP_REPORT_ONLY: "false" })).toBe("Content-Security-Policy");
  });

  it("CSP_REPORT_ONLY=true er nødbremsen: samme politik, men blokerer intet", () => {
    expect(cspHeaderName({ CSP_REPORT_ONLY: "true" })).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("staticHeaderRules", () => {
  const rules = staticHeaderRules();
  const bySource = (source: string) => rules.find((rule) => rule.source === source)!;
  const value = (source: string, key: string) =>
    bySource(source).headers.find((header) => header.key === key)?.value;

  it("alle sider får HSTS, nosniff, DENY og slået kamera/mikrofon/lokation fra", () => {
    for (const source of [DEFAULT_REFERRER_SOURCE, NO_REFERRER_SOURCE]) {
      expect(value(source, "Strict-Transport-Security")).toBe(HSTS);
      expect(value(source, "X-Content-Type-Options")).toBe("nosniff");
      expect(value(source, "X-Frame-Options")).toBe("DENY");
      expect(value(source, "Permissions-Policy")).toBe(PERMISSIONS_POLICY);
    }
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    }
  });

  it("HSTS er mindst ét år og dækker underdomæner, men er ikke preload (en forpligtelse)", () => {
    const maxAge = Number(HSTS.match(/max-age=(\d+)/)?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(31536000);
    expect(HSTS).toContain("includeSubDomains");
    expect(HSTS).not.toContain("preload");
  });

  it("rating-ruten bevarer no-referrer (ADR 0060); alt andet får strict-origin-when-cross-origin", () => {
    expect(value(NO_REFERRER_SOURCE, "Referrer-Policy")).toBe("no-referrer");
    expect(value(DEFAULT_REFERRER_SOURCE, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("reglerne overlapper ikke: standardreglen udelukker rating-ruten", () => {
    const pattern = new RegExp(`^${DEFAULT_REFERRER_SOURCE}$`);
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/login")).toBe(true);
    expect(pattern.test("/vurdering/abc")).toBe(false);
    // Kun præcis rating-segmentet er undtaget — ikke et præfiks som /vurderinger.
    expect(pattern.test("/admin/vurderinger")).toBe(true);
  });

  it("API-svar får den strengeste CSP (de returnerer data, aldrig dokumenter)", () => {
    expect(value("/api/:path*", "Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});
