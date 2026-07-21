/**
 * Session-refresh-proxy (fase 1.1, ADR 0014). Next 16-konventionen `proxy` (afløser
 * `middleware`). Holder Supabase-auth-cookies friske på hver request (kanonisk
 * @supabase/ssr-mønster). Bruger kun URL + anon-nøgle — ingen service-role på edge.
 * No-op når Supabase ikke er konfigureret (kontofri CI/dev).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isSupabaseBrowserConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";

export async function proxy(request: NextRequest) {
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
  // Kør på alle ruter undtagen statiske assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
