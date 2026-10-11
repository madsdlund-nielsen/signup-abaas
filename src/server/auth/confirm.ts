/**
 * Ren logik bag bekræftelsesruten `/auth/confirm` (B-70, ADR 0073): parsing og validering af
 * linkets parametre, den lukkede liste over fejlkoder til `/login?fejl=…`, og hvilken sti en
 * type lander på. Ingen SDK, ingen next/headers — enhedstestet i tests/unit/auth-confirm.test.ts.
 *
 * Ruten er en åben indgang (linket kommer fra en mail), så ALT i URL'en behandles som input:
 *   - `type` skal være en af de fire kendte OTP-typer (ellers afvises linket),
 *   - `token_hash` skal være til stede og af rimelig størrelse,
 *   - `next` accepteres KUN som en relativ sti på vores eget domæne — aldrig en åben redirect.
 */

import type { EmailOtpType } from "@supabase/supabase-js";

/** De typer vi lader `verifyOtp` indløse. `magiclink`/`email` bruges ikke af appen og afvises. */
export const CONFIRM_TYPES = ["invite", "recovery", "signup", "email_change"] as const satisfies readonly EmailOtpType[];
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

/**
 * Hvor en bekræftet bruger lander, når linket ikke selv bærer en gyldig `next`. Invitation og
 * nulstilling ender på «sæt adgangskode» — en bruger uden adgangskode må aldrig lande på et
 * dashboard uden vej tilbage.
 */
const DEFAULT_DESTINATION: Record<ConfirmType, string> = {
  invite: "/konto/adgangskode",
  recovery: "/konto/adgangskode",
  signup: "/dashboard",
  email_change: "/konto",
};

/** Fejlkoder i `/login?fejl=<kode>`. Koden slås op her — den rå parameter gengives aldrig. */
export const LOGIN_ERRORS = {
  "ugyldigt-link": "Linket er ugyldigt eller udløbet. Bed om et nyt link, eller log ind med din adgangskode.",
  "ikke-konfigureret": "Login er ikke konfigureret endnu (afventer Supabase-projekt).",
  "ny-adgangskode": "Din session er udløbet. Bed om et nyt link til at vælge adgangskode.",
} as const;
export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

/** Dansk tekst til en `fejl`-parameter, eller null hvis koden er ukendt (så vises intet). */
export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code || !Object.hasOwn(LOGIN_ERRORS, code)) return null;
  return LOGIN_ERRORS[code as LoginErrorCode];
}

const MAX_TOKEN_HASH_LENGTH = 512;
const MAX_NEXT_LENGTH = 512;
const INTERNAL_ORIGIN = "http://internal.invalid";

/**
 * Returnerer en sikker intern sti (`/sti?query`) eller null. Afviser alt der kan forlade
 * domænet: absolutte URL'er, `//host` (protokol-relative), `/\host` (browsere læser `\` som `/`),
 * kontroltegn (en tabulator midt i `/\t/host` fjernes af URL-parseren og giver `//host`), og
 * alt der ikke starter med en enkelt `/`. Hash droppes.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NEXT_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;

  let parsed: URL;
  try {
    parsed = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== INTERNAL_ORIGIN) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export type ConfirmRequest =
  | { ok: true; tokenHash: string; type: ConfirmType; next: string }
  | { ok: false; reason: "mangler-token" | "ukendt-type" };

export function isConfirmType(value: string | null | undefined): value is ConfirmType {
  return typeof value === "string" && (CONFIRM_TYPES as readonly string[]).includes(value);
}

export function parseConfirmRequest(params: URLSearchParams): ConfirmRequest {
  const tokenHash = params.get("token_hash");
  if (!tokenHash || tokenHash.length > MAX_TOKEN_HASH_LENGTH) return { ok: false, reason: "mangler-token" };

  const type = params.get("type");
  if (!isConfirmType(type)) return { ok: false, reason: "ukendt-type" };

  return {
    ok: true,
    tokenHash,
    type,
    next: safeInternalPath(params.get("next")) ?? DEFAULT_DESTINATION[type],
  };
}

/** Hvor en bruger sendes efter at have valgt adgangskode: partnere til portalen, alle andre til dashboardet. */
export function destinationAfterPassword(roles: readonly string[]): string {
  return roles.includes("partner") || roles.includes("lead_partner") ? "/partner" : "/dashboard";
}
