import { describe, expect, it } from "vitest";

import {
  CONFIRM_TYPES,
  destinationAfterPassword,
  loginErrorMessage,
  LOGIN_ERRORS,
  parseConfirmRequest,
  safeInternalPath,
} from "@/server/auth/confirm";
import { PASSWORD_MIN_LENGTH, validateNewPassword } from "@/server/auth/password-policy";

const params = (query: string) => new URLSearchParams(query);

describe("safeInternalPath — ingen åben redirect", () => {
  it("accepterer relative stier og bevarer query", () => {
    expect(safeInternalPath("/konto/adgangskode")).toBe("/konto/adgangskode");
    expect(safeInternalPath("/partner?fane=moeder")).toBe("/partner?fane=moeder");
    expect(safeInternalPath("/dashboard#top")).toBe("/dashboard");
  });

  it.each([
    ["absolut URL", "https://evil.example/konto"],
    ["protokol-relativ", "//evil.example"],
    ["protokol-relativ med sti", "//evil.example/konto"],
    ["bagstreg som skråstreg", "/\\evil.example"],
    ["bagstreg midt i stien", "/konto\\..\\evil"],
    ["tabulator der bliver til //", "/\t/evil.example"],
    ["linjeskift", "/konto\nSet-Cookie: x=1"],
    ["wagenrücklauf", "/konto\r"],
    ["javascript-skema", "javascript:alert(1)"],
    ["data-skema", "data:text/html,x"],
    ["uden indledende skråstreg", "konto"],
    ["tom", ""],
    ["for lang", `/${"a".repeat(600)}`],
  ])("afviser %s", (_name, value) => {
    expect(safeInternalPath(value)).toBeNull();
  });

  it("afviser manglende værdi", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
  });
});

describe("parseConfirmRequest", () => {
  it.each(CONFIRM_TYPES)("accepterer typen %s", (type) => {
    const parsed = parseConfirmRequest(params(`token_hash=abc&type=${type}`));
    expect(parsed).toMatchObject({ ok: true, tokenHash: "abc", type });
  });

  it("invitation og nulstilling lander på «sæt adgangskode» som standard", () => {
    expect(parseConfirmRequest(params("token_hash=abc&type=invite"))).toMatchObject({ next: "/konto/adgangskode" });
    expect(parseConfirmRequest(params("token_hash=abc&type=recovery"))).toMatchObject({ next: "/konto/adgangskode" });
  });

  it("signup og e-mailskift har egne standarddestinationer", () => {
    expect(parseConfirmRequest(params("token_hash=abc&type=signup"))).toMatchObject({ next: "/dashboard" });
    expect(parseConfirmRequest(params("token_hash=abc&type=email_change"))).toMatchObject({ next: "/konto" });
  });

  it("bruger en gyldig next", () => {
    expect(parseConfirmRequest(params("token_hash=abc&type=recovery&next=/konto"))).toMatchObject({ next: "/konto" });
  });

  it("falder tilbage til standarden når next er en åben redirect", () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const parsed = parseConfirmRequest(
        new URLSearchParams({ token_hash: "abc", type: "recovery", next }),
      );
      expect(parsed).toMatchObject({ ok: true, next: "/konto/adgangskode" });
    }
  });

  it("afviser manglende eller tomt token", () => {
    expect(parseConfirmRequest(params("type=invite"))).toEqual({ ok: false, reason: "mangler-token" });
    expect(parseConfirmRequest(params("token_hash=&type=invite"))).toEqual({ ok: false, reason: "mangler-token" });
    expect(parseConfirmRequest(params(`token_hash=${"x".repeat(600)}&type=invite`))).toEqual({
      ok: false,
      reason: "mangler-token",
    });
  });

  it("afviser ukendt eller manglende type (også de Supabase kender, men appen ikke bruger)", () => {
    expect(parseConfirmRequest(params("token_hash=abc"))).toEqual({ ok: false, reason: "ukendt-type" });
    expect(parseConfirmRequest(params("token_hash=abc&type=magiclink"))).toEqual({ ok: false, reason: "ukendt-type" });
    expect(parseConfirmRequest(params("token_hash=abc&type=__proto__"))).toEqual({ ok: false, reason: "ukendt-type" });
  });
});

describe("loginErrorMessage", () => {
  it("slår kendte koder op", () => {
    expect(loginErrorMessage("ugyldigt-link")).toBe(LOGIN_ERRORS["ugyldigt-link"]);
  });

  it("gengiver aldrig en ukendt kode", () => {
    expect(loginErrorMessage("<script>alert(1)</script>")).toBeNull();
    expect(loginErrorMessage("constructor")).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
  });
});

describe("destinationAfterPassword", () => {
  it("sender partnere til portalen og alle andre til dashboardet", () => {
    expect(destinationAfterPassword(["partner"])).toBe("/partner");
    expect(destinationAfterPassword(["lead_partner"])).toBe("/partner");
    expect(destinationAfterPassword(["ejer"])).toBe("/dashboard");
    expect(destinationAfterPassword(["admin"])).toBe("/dashboard");
    expect(destinationAfterPassword([])).toBe("/dashboard");
  });
});

describe("validateNewPassword", () => {
  it("kræver samme minimumslængde som signup", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(validateNewPassword("1234567", "1234567")).toMatch(/for kort/);
    expect(validateNewPassword("12345678", "12345678")).toBeNull();
  });

  it("kræver at de to felter er ens", () => {
    expect(validateNewPassword("12345678", "12345679")).toMatch(/ikke ens/);
  });
});
