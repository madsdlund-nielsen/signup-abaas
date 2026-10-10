/**
 * CSV-eksport af honoraropgørelsen (Fase 5.2, ADR 0051). Ren eksportgrænseflade — INGEN
 * bogføringsintegration: e-conomic vs. Dinero er uafklaret, og `src/lib/accounting/` forbliver
 * på stub. En fil er det bogholderen kan arbejde videre med uanset hvilket system der vælges.
 *
 * Route handlers ligger UDEN for /admin/layout.tsx's rolle-guard, så admin-tjekket sker her,
 * server-side, før noget læses. RLS er andet lag: viewen `partner_fee_line` giver kun admin
 * andres rækker, så selv et glippet tjek her ville ikke lække en andens honorar.
 *
 * Query: ?maaned=ÅÅÅÅ-MM (ugyldig eller manglende → indeværende måned) og valgfri
 * ?partner=<partner_profile_id>. Beløb er rå øre — ingen momsberegning (TODO(ejer): moms).
 */

import { getCurrentUser } from "@/server/auth";
import { REGISTERED_STATUS_LABEL, listFeeLines, resolvePeriod } from "@/server/fees";
import { toCsv } from "@/server/fees/csv";

export const dynamic = "force-dynamic";

const HEADER = [
  "maaned",
  "partner_id",
  "partner",
  "moede_id",
  "moede_start",
  "moede_status",
  "registrering",
  "grundlag_minutter",
  "status",
  "beloeb_oere",
  "valuta",
  "moms",
  "regel_version",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Ikke logget ind.", { status: 401 });
  if (!user.roles.includes("admin")) return new Response("Adgang nægtet.", { status: 403 });

  const url = new URL(request.url);
  const requested = url.searchParams.get("maaned");
  const period = resolvePeriod(requested);
  const partner = url.searchParams.get("partner") || undefined;
  if (partner && !UUID.test(partner)) return new Response("Ugyldigt partner-id.", { status: 400 });

  const lines = await listFeeLines({ from: period.from, to: period.to, partnerId: partner });

  const rows = lines.map((line) => {
    const { result } = line;
    const beregnet = result.kind === "beregnet";
    return [
      period.month,
      line.partnerProfileId,
      line.partnerName,
      line.meetingId,
      line.startsAt,
      line.meetingStatus,
      line.registeredStatus ? REGISTERED_STATUS_LABEL[line.registeredStatus] : "",
      line.durationMinutes + line.prepMinutes,
      result.kind,
      beregnet ? result.amountMinor : "",
      beregnet ? result.currency : "",
      beregnet ? result.vatMode : "",
      beregnet || result.kind === "afventer_regel" ? result.ruleVersion : "",
    ];
  });

  // UTF-8 BOM, så Excel læser æ/ø/å rigtigt.
  const body = "\uFEFF" + toCsv(HEADER, rows);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="honorar-${period.month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
