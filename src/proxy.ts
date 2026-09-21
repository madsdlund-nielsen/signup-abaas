/**
 * Session-refresh-proxy (fase 1.1, ADR 0014). Next 16-konventionen `proxy` (afløser
 * `middleware`). Holder Supabase-auth-cookies friske på hver request (kanonisk
 * @supabase/ssr-mønster). Bruger kun URL + anon-nøgle — ingen service-role på edge.
 * No-op når Supabase ikke er konfigureret (kontofri CI/dev).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isSupabaseBrowserConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { GATE_COOKIE, isGateActive, readGateConfig } from "@/server/gate";
import { verifyToken } from "@/server/gate/token";

export async function proxy(request: NextRequest) {
  // Adgangsport FØR alt andet (ADR 0020): uden en gyldig, signeret gate-cookie sendes enhver
  // request (også /login) til /gate. Selve /gate er undtaget. Edge-sikker verifikation (Web Crypto).
  const gate = readGateConfig();
  if (isGateActive(gate) && request.nextUrl.pathname !== "/gate") {
    const token = request.cookies.get(GATE_COOKIE)?.value;
    const passed = token ? await verifyToken(token, gate.cookieSecret as string) : false;
    if (!passed) {
      const url = request.nextUrl.clone();
      url.pathname = "/gate";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  const config = readSupabaseAuthConfig();
  if (!isSupabaseBrowserConfigured(config)) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresher en evt. udløbet session; skriver nye cookies via setAll ovenfor.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Kør på alle ruter undtagen statiske assets OG /api.
  //
  // `api` er udeladt af to grunde, hvoraf den første er en fejl og ikke en optimering:
  // adgangsporten ovenfor omdirigerer ALT undtagen /gate, så med porten slået til ville
  // Cal.com's og Alunta's callbacks blive sendt til /gate og aldrig nå deres handler.
  // En maskine kan ikke taste en delt adgangskode. Webhooks bærer i forvejen deres eget
  // værn — HMAC-signatur før alt andet, fail-closed (ADR 0027/0029) — så porten og
  // sessionsopfriskningen har intet at bidrage med dér.
  // Dernæst: Next 16's egen vejledning (node_modules/next/dist/docs, guides/authentication)
  // udelader netop `api` i sit matcher-eksempel og advarer om at proxyen kører på hver
  // request, også prefetches, og derfor skal holdes billig.
  //
  // Bemærk skråstregen i `api/`. Vejledningens eksempel skriver `api` uden, men et bart
  // `api` rammer også ethvert PRÆFIKS — en fremtidig rute som /apifoo ville da slippe uden
  // om adgangsporten. Det er et hul, ikke en optimering, så mønsteret er snævret ind til
  // præcis det segment vi mener.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
