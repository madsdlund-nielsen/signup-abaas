/**
 * Indsigtsudtræk (GDPR art. 15) — fase 5.5, ADR 0053.
 *
 * POST med `email` i formularkroppen (aldrig i URL'en: adresser i query-strenge ender i
 * serverlogs og browserhistorik). Svarer med et JSON-dokument til download.
 *
 * Sikkerhed — rækkefølgen er bærende:
 *   - /api er UDE af proxyen (adgangsporten og sessionsopfriskningen kører ikke her), så
 *     denne handler bærer hele sit eget værn: bruger → admin-rolle → først DEREFTER
 *     service-role. Det ligger i `requestSubjectAccess`, ikke her.
 *   - Cross-site-anmodninger afvises (Sec-Fetch-Site). Supabase-cookies er SameSite=Lax, så
 *     en cross-site POST ville ikke bære sessionen alligevel; kontrollen er et ekstra lag.
 *   - Persondata logges ikke. Der logges kun at et udtræk blev kørt, og af hvilken admin.
 *   - `no-store`: udtrækket må aldrig caches.
 */

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { supabaseRowFetcher } from "@/server/admin/subject-collect";
import { requestSubjectAccess, type SubjectRequestFailure } from "@/server/admin/subject-request";

export const dynamic = "force-dynamic";

const STATUS: Record<SubjectRequestFailure | "ikke-konfigureret" | "intern-fejl" | "cross-site", number> = {
  "ikke-logget-ind": 401,
  "ikke-admin": 403,
  "cross-site": 403,
  "ugyldig-email": 400,
  "ikke-fundet": 404,
  "ikke-konfigureret": 503,
  "intern-fejl": 500,
};

type FailureCode = keyof typeof STATUS;

/** Formularen sender Accept: text/html → tilbage til siden med en kode. API-kald får JSON. */
function fail(request: Request, code: FailureCode): Response {
  const wantsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
  if (wantsHtml && code !== "ikke-logget-ind" && code !== "ikke-admin" && code !== "cross-site") {
    return NextResponse.redirect(new URL(`/admin/juridisk?fejl=${code}`, request.url), 303);
  }
  return NextResponse.json({ fejl: code }, { status: STATUS[code], headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return fail(request, "cross-site");

  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return fail(request, "ikke-konfigureret");

  let email = "";
  try {
    const form = await request.formData();
    email = String(form.get("email") ?? "");
  } catch {
    return fail(request, "ugyldig-email");
  }

  const user = await getCurrentUser();
  try {
    const result = await requestSubjectAccess({
      user,
      email,
      makeFetcher: () => supabaseRowFetcher(createServiceSupabase(config)),
    });
    if (!result.ok) return fail(request, result.code);

    console.info(`[juridisk] indsigtsudtræk kørt af admin ${user?.id ?? "ukendt"}`);
    return new Response(result.body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // Fejlbeskeden nævner tabel + databasefejl, aldrig filterværdier (e-mail, id'er).
    console.error(`[juridisk] indsigtsudtræk fejlede: ${e instanceof Error ? e.message : String(e)}`);
    return fail(request, "intern-fejl");
  }
}
