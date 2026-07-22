import { describe, expect, it } from "vitest";
import { translateAuthError } from "@/server/auth/error-messages";

describe("translateAuthError", () => {
  it("rate limit → dansk vent-besked", () => {
    expect(translateAuthError("Email rate limit exceeded")).toMatch(/for mange forsøg/i);
  });

  it("allerede registreret → henvis til login", () => {
    expect(translateAuthError("User already registered")).toMatch(/allerede registreret/i);
  });

  it("forkerte loginoplysninger → dansk", () => {
    expect(translateAuthError("Invalid login credentials")).toMatch(/forkert e-mail/i);
  });

  it("for kort adgangskode → dansk", () => {
    expect(translateAuthError("Password should be at least 6 characters")).toMatch(/for kort/i);
  });

  it("ukendt fejl → generisk dansk besked (lækker ikke den rå engelske tekst)", () => {
    const out = translateAuthError("Some unexpected internal error xyz");
    expect(out).toMatch(/noget gik galt/i);
    expect(out).not.toContain("xyz");
  });
});
