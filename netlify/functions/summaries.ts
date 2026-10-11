/**
 * Netlify scheduled function (B-45, ADR 0059): kalder den beskyttede route handler
 * `/api/cron/summaries`, som genererer AI-opsummeringer af afholdte møder i baggrunden. Selve
 * logikken bor i appen (testbar, bag FLAG_AIFOLLOWUP) — denne fil er kun uret, som
 * `charge-periods.ts` (ADR 0056).
 *
 * Hvert 15. minut: en teknisk takt, ikke en forretningssats. Et møde skal have sit resumé kort
 * efter afholdelsen uden at ejeren venter et døgn, og kørslen er idempotent og no-op'er når der
 * intet er at gøre — så en tæt takt koster ingenting. Samme kadence giver også mangler_*-rækker
 * en rimelig chance for at blive samlet op når samtykke/optagelse dukker op.
 *
 * Aldrig uden hemmelighed: uden CRON_SECRET kalder funktionen intet (routen ville alligevel svare 503).
 *
 * TODO(mads): en scheduled function har kort kørselstid på Netlify. Routen behandler få møder pr.
 * kald (DEFAULT_BATCH_LIMIT), men en rigtig 75-minutters transskription kan tage minutter —
 * verificér platformens grænse for Next-routens funktionstid med en rigtig nøgle. Fallback:
 * en Netlify Background Function (15 min) der kalder samme generator.
 */

interface ScheduleContext {
  site?: { url?: string };
}

export default async function handler(_request: Request, context: ScheduleContext): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const baseUrl = context.site?.url ?? process.env.URL;
  if (!secret || !baseUrl) {
    console.error("[summaries] CRON_SECRET eller site-URL mangler — kører ikke.");
    return new Response("Ikke konfigureret.", { status: 503 });
  }

  const response = await fetch(`${baseUrl}/api/cron/summaries`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
  const body = await response.text();
  console.info(`[summaries] HTTP ${response.status}: ${body.slice(0, 500)}`);
  return new Response(body, { status: response.status });
}

export const config = {
  schedule: "*/15 * * * *",
};
