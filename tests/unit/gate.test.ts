import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/gate/password";
import { signToken, verifyToken } from "@/server/gate/token";
import { isGateActive, readGateConfig } from "@/server/gate";

describe("gate-adgangskode (scrypt)", () => {
  it("hash roundtrip: korrekt kode verificerer, forkert fejler", () => {
    const stored = hashPassword("hemmelig-kode");
    expect(verifyPassword("hemmelig-kode", stored)).toBe(true);
    expect(verifyPassword("forkert", stored)).toBe(false);
  });

  it("malformet hash → false (ingen crash)", () => {
    expect(verifyPassword("x", "ingen-kolon")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });
});

describe("gate-token (HMAC, edge-sikker)", () => {
  it("signeret token verificerer med samme secret", async () => {
    const token = await signToken("secret-abc");
    expect(await verifyToken(token, "secret-abc")).toBe(true);
  });

  it("forkert secret eller ugyldigt token → false", async () => {
    const token = await signToken("secret-abc");
    expect(await verifyToken(token, "andet-secret")).toBe(false);
    expect(await verifyToken("00", "secret-abc")).toBe(false);
  });
});

describe("gate-config", () => {
  it("aktiv kun når enabled + hash + secret alle er sat", () => {
    expect(isGateActive(readGateConfig({}))).toBe(false);
    expect(isGateActive(readGateConfig({ APP_GATE_ENABLED: "true" }))).toBe(false);
    expect(
      isGateActive(
        readGateConfig({
          APP_GATE_ENABLED: "true",
          APP_GATE_PASSWORD_HASH: "aa:bb",
          APP_GATE_COOKIE_SECRET: "s3cret",
        }),
      ),
    ).toBe(true);
  });
});
