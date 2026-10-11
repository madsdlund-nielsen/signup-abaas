/**
 * Bekræftelsesrute for links i Supabase Auths mails (B-70, ADR 0073): invitation, nulstilling af
 * adgangskode, bekræftelse af ny e-mail/tilmelding. Mailskabelonerne peger HER
 * (`{{ .SiteURL }}/auth/confirm?token_hash=…&type=…`) i stedet for på Supabases egen verify-endpoint,
 * som afleverer tokens i URL-fragmentet — og det kan en server aldrig læse.
 *
 * Alt sker på serveren: `verifyOtp` indløser engangstokenet, den eksisterende SSR-klient sætter
 * session-cookies, og brugeren sendes videre. Ingen browser-Supabase-klient (og dermed intet
 * Supabase-domæne i CSP's `connect-src`, ADR 0070).
 *
 * Fejl er rolige: ét generisk `/login?fejl=ugyldigt-link` uanset om tokenet er brugt, udløbet
 * eller opfundet — ruten er ikke et orakel for hvad der findes.
 */

import { NextResponse, type NextRequest } from "next/server";

import { parseConfirmRequest, safeInternalPath } from "@/server/auth/confirm";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export const dynamic = "force-dynamic";

function redirectTo(request: NextRequest, path: string): NextResponse {
  // Forsvar i dybden: stien er allerede valideret, men et svar må aldrig forlade vores egen origin.
  const url = new URL(path, request.nextUrl.origin);
  const target = url.origin === request.nextUrl.origin ? url : new URL("/login", request.nextUrl.origin);
  const response = NextResponse.redirect(target);
  // Linket bærer et engangstoken: det må hverken caches eller sendes videre som referrer.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function loginWithError(request: NextRequest, code: string): NextResponse {
  return redirectTo(request, safeInternalPath(`/login?fejl=${code}`) ?? "/login");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = parseConfirmRequest(request.nextUrl.searchParams);
  if (!parsed.ok) return loginWithError(request, "ugyldigt-link");

  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return loginWithError(request, "ikke-konfigureret");

  const supabase = await createServerSupabase(config);
  const { error } = await supabase.auth.verifyOtp({ type: parsed.type, token_hash: parsed.tokenHash });
  if (error) {
    // Den rå årsag logges (aldrig tokenet); brugeren får den generiske besked.
    console.error(`[auth] verifyOtp (${parsed.type}) fejlede: ${error.message}`);
    return loginWithError(request, "ugyldigt-link");
  }

  return redirectTo(request, parsed.next);
}
