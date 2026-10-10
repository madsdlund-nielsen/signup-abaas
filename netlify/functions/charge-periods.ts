/**
 * Netlify scheduled function (B-19, ADR 0056): kalder dagligt den beskyttede route handler
 * `/api/cron/charge-periods`, som opretter periode-opkrævninger og melder abonnementsprisen
 * til betalingsleverandøren. Selve logikken bor i appen (testbar, bag FLAG_PAYMENTS) — denne
 * fil er kun uret. Cron er verificeret i fase 0 (ADR 0012); dette er den første scheduled function.
 *
 * Tidspunktet er UTC og dagligt, fordi perioder regnes i hele kalenderdøgn og kørslen er
 * idempotent: det er en teknisk takt, ikke en forretningssats. Netlify kører scheduled
 * functions på den publicerede deploy.
 *
 * Aldrig uden hemmelighed: uden CRON_SECRET kalder funktionen intet (routen ville alligevel svare 503).
 */

interface ScheduleContext {
  site?: { url?: string };
}

export default async function handler(_request: Request, context: ScheduleContext): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const baseUrl = context.site?.url ?? process.env.URL;
  if (!secret || !baseUrl) {
    console.error("[charge-periods] CRON_SECRET eller site-URL mangler — kører ikke.");
    return new Response("Ikke konfigureret.", { status: 503 });
  }

  const response = await fetch(`${baseUrl}/api/cron/charge-periods`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
  const body = await response.text();
  console.info(`[charge-periods] HTTP ${response.status}: ${body.slice(0, 500)}`);
  return new Response(body, { status: response.status });
}

export const config = {
  schedule: "0 3 * * *",
};
