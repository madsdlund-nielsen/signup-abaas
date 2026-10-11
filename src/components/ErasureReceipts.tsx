import { StatusBadge, type StatusBadgeTone } from "@/components/StatusBadge";
import type { ErasureOutcome, ErasureReceiptView, SystemResult, SystemStatus } from "@/server/erasure/execute";
import type { ErasureReceiptRow } from "@/server/erasure/receipts";

/**
 * Kvitteringer for sletninger (GDPR art. 17, ADR 0068). Ren præsentation: data kommer som props, så
 * komponenterne kan testes uden Supabase. Kvitteringen indeholder ingen persondata — kun systemer,
 * udfald og et pseudonymt id-hash. Al styling via token-klasser. Hvert mærke gentager sin tilstand som
 * TEKST; farven er forstærkning, ikke den eneste bærer.
 */

export const STATUS_LABEL: Record<SystemStatus, string> = {
  slettet: "Slettet",
  intet_at_slette: "Intet at slette",
  fejlet: "Fejlet",
  ikke_konfigureret: "Ikke konfigureret",
  manuel: "Manuelt",
  udsat: "Udsat",
};

const STATUS_TONE: Record<SystemStatus, StatusBadgeTone> = {
  slettet: "archived",
  intet_at_slette: "archived",
  fejlet: "draft",
  ikke_konfigureret: "none",
  manuel: "draft",
  udsat: "none",
};

export const OUTCOME_LABEL: Record<ErasureOutcome, string> = {
  gennemfoert: "Gennemført",
  delvist: "Delvist — kan genkøres",
};

export function formatReceiptTime(iso: string): string {
  return new Date(iso).toLocaleString("da-DK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Copenhagen",
  });
}

function SystemsTable({ systems }: { systems: readonly SystemResult[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="table__head">System</th>
            <th className="table__head">Udfald</th>
            <th className="table__head">Note</th>
          </tr>
        </thead>
        <tbody>
          {systems.map((s) => (
            <tr key={s.system} className="table__row">
              <td className="table__cell">{s.label}</td>
              <td className="table__cell">
                <StatusBadge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatusBadge>
              </td>
              <td className="table__cell">{s.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MissingNote({ missing, labels }: { missing: readonly string[]; labels: Map<string, string> }) {
  if (missing.length === 0) return null;
  return (
    <p className="form__notice" role="alert">
      Mangler at blive slettet automatisk: {missing.map((m) => labels.get(m) ?? m).join(", ")}. Se noterne
      ovenfor — det er et synligt hul, ikke en gennemført sletning.
    </p>
  );
}

/** Kvitteringen lige efter en sletning. */
export function ErasureReceiptPanel({ receipt }: { receipt: ErasureReceiptView }) {
  const labels = new Map(receipt.systems.map((s) => [s.system, s.label]));
  return (
    <div className="panel panel--flat stack" role="status">
      <p className="eyebrow">Kvittering</p>
      <p className="factline">
        <span>{formatReceiptTime(receipt.executedAt)}</span>
        <span>{OUTCOME_LABEL[receipt.outcome]}</span>
      </p>
      <p className="body">
        {receipt.outcome === "gennemfoert"
          ? "Personens data i Supabase og login-kontoen er slettet. Kvitteringen indeholder ingen persondata."
          : "Supabase-dataene er slettet, men kontoen står blankeret tilbage (kun e-mail), fordi en behandler fejlede. Slå personen op igen og kør sletningen om."}
      </p>
      <SystemsTable systems={receipt.systems} />
      <MissingNote missing={receipt.missing} labels={labels} />
      {!receipt.receiptSaved ? (
        <p className="form__notice" role="alert">
          Kvitteringen kunne ikke gemmes i listen nedenfor (se serverloggen). Sletningen er sket — gem
          denne oversigt.
        </p>
      ) : null}
    </div>
  );
}

/** Listen over seneste kvitteringer. `receipts === null` = kunne ikke læses (ikke «ingen»). */
export function ErasureReceiptList({ receipts }: { receipts: readonly ErasureReceiptRow[] | null }) {
  if (receipts === null) {
    return (
      <p className="empty">
        Kvitteringerne kunne ikke læses (Supabase er ikke konfigureret, eller læsningen fejlede). Det er ikke
        det samme som «ingen sletninger».
      </p>
    );
  }
  if (receipts.length === 0) {
    return <p className="empty">Ingen sletninger endnu.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="table__head">Tidspunkt</th>
            <th className="table__head">Person (id-hash)</th>
            <th className="table__head">Udfald</th>
            <th className="table__head">Mangler</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => {
            const labels = new Map(r.systems.map((s) => [s.system, s.label]));
            return (
              <tr key={r.id} className="table__row">
                <td className="table__cell">{formatReceiptTime(r.executedAt)}</td>
                <td className="table__cell">
                  <code>{r.subjectRef}</code>
                </td>
                <td className="table__cell">
                  <StatusBadge tone={r.outcome === "gennemfoert" ? "archived" : "draft"}>
                    {OUTCOME_LABEL[r.outcome]}
                  </StatusBadge>
                </td>
                <td className="table__cell">
                  {r.missing.length === 0 ? "—" : r.missing.map((m) => labels.get(m) ?? m).join(", ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
