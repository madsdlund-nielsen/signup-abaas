import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

/**
 * Proxyens matcher (ADR 0049). Den afgør hvad der overhovedet rammer adgangsporten og
 * sessionsopfriskningen — og dermed også hvad der IKKE må ramme dem.
 *
 * Den vigtigste linje her er webhook-linjen: adgangsporten omdirigerer alt undtagen /gate,
 * så hvis /api igen kom med i matcheren, ville Cal.com's og Alunta's callbacks blive sendt
 * til en adgangskodeskærm i det øjeblik porten blev slået til. Den fejl er tavs i test_mode
 * og dyr i produktion, så den låses fast her.
 */
function matches(pathname: string): boolean {
  const pattern = config.matcher[0];
  if (pattern === undefined) throw new Error("matcher mangler");
  return new RegExp(`^${pattern}$`).test(pathname);
}

describe("proxy-matcher", () => {
  it("kører IKKE på webhook-endpoints — porten må aldrig omdirigere en maskine", () => {
    expect(matches("/api/webhooks/calcom")).toBe(false);
    expect(matches("/api/webhooks/alunta")).toBe(false);
  });

  it("kører på app-ruter, så adgangsport og sessionsopfriskning stadig dækker dem", () => {
    for (const path of ["/", "/login", "/signup", "/dashboard", "/admin/notifikationer", "/moeder"]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("lader ikke en præfiks-rute slippe uden om adgangsporten", () => {
    // `api` uden skråstreg ville også ekskludere /apifoo og lignende. Porten skal dække
    // enhver rute vi ikke bevidst har undtaget, så det er et hul værd at holde lukket.
    expect(matches("/apifoo")).toBe(true);
    expect(matches("/api-noget")).toBe(true);
  });

  it("kører ikke på statiske assets", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/brand/abu-mark-01-small-navy-on-light.svg")).toBe(false);
  });
});
