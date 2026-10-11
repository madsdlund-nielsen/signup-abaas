import { Field } from "@/components/Field";
import { PrimaryButton } from "@/components/PrimaryButton";
import { NOT_INCLUDED } from "@/server/admin/subject-access";
import type { LegalDocument } from "@/server/admin/legal";

/**
 * Juridisk download-interface (fase 5.5, ADR 0053). Ren præsentation af fire ting:
 * indsigtsudtræk, samtykkelog (hullet), dokumenter og sletteflow.
 *
 * Interfacet bygges, ikke indholdet. Et dokument der ikke findes, står som "Ikke udarbejdet"
 * — aldrig som et link til noget tomt.
 */

/** Formularen POST'er til route handleren; e-mailen kommer aldrig i URL'en. */
export function SubjectAccessForm({ error }: { error: string | null }) {
  return (
    <div className="stack">
      <p className="eyebrow">Indsigtsudtræk (GDPR art. 15)</p>
      <p className="body">
        Indtast e-mailadressen på den person der har bedt om indsigt. Du får en JSON-fil med alt vi har om
        vedkommende i Supabase: profil, roller, quizsvar, board, møder, noter, vurderinger og
        medlemskab/træk. Hentningen logges som en handling, ikke med persondata.
      </p>
      {error ? (
        <p className="form__notice" role="alert">
          {error}
        </p>
      ) : null}
      <form className="form measure" method="post" action="/api/admin/indsigt">
        <Field name="email" label="E-mail" type="email" required autoComplete="off" />
        <PrimaryButton type="submit">Hent udtræk</PrimaryButton>
      </form>
      <details>
        <summary className="form__alt">Hvad udtrækket ikke indeholder</summary>
        <ul className="summary-actions">
          {NOT_INCLUDED.map((line) => (
            <li key={line} className="body">
              {line}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Samtykkelog. Der findes ingen samtykketabel — cookie-samtykke er en typet kerne
 * (`src/server/consent`) og en cookie i browseren, hverken bannerets valg eller et tidspunkt
 * gemmes. Samtykke til optagelse, AI og SMS er kontraktens (ADR 0065) og logges ikke. Skærmen siger det højt, i stedet for at tilbyde en tom CSV.
 */
export function ConsentLogGap() {
  return (
    <div className="stack">
      <p className="eyebrow">Samtykkelog</p>
      <p className="empty">
        Ingen samtykkelog at eksportere. Cookie-samtykket gemmes kun som en cookie i personens egen
        browser (opt-in, kun &quot;nødvendig&quot; er aktiv som standard) — der er hverken en tabel eller et
        bevis for hvem der har sagt ja til hvad og hvornår. Samtykke til optagelse, AI-behandling og SMS er
        en del af kontrakten og registreres ikke pr. person (ADR 0065). Det er et hul for cookies, ikke en
        tom eksport.
      </p>
    </div>
  );
}

export function LegalDocumentTable({ documents }: { documents: readonly LegalDocument[] }) {
  return (
    <div className="stack">
      <p className="eyebrow">Dokumenter</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Dokument</th>
              <th className="table__head">Status</th>
              <th className="table__head">Sti i repoet</th>
              <th className="table__head">Note</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.key} className="table__row">
                <td className="table__cell">{doc.title}</td>
                <td className="table__cell">{doc.state === "mangler" ? "Ikke udarbejdet" : "I repoet"}</td>
                <td className="table__cell">{doc.repoPath ?? "—"}</td>
                <td className="table__cell">{doc.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sletning er destruktiv og har sin egen skive — her henvises kun til flowet. */
export function ErasureReference() {
  return (
    <div className="stack">
      <p className="eyebrow">Sletning</p>
      <p className="body">
        Sletteflowet er beskrevet i <code>docs/gdpr/sletteflow.md</code>. Der findes endnu ingen
        admin-sletteaction: sletning er destruktiv, rører flere databehandlere og afhænger af
        opbevaringspligt (bogføring, betalingsdata) som ejer/jura skal afklare. Den bygges som sin egen
        skive.
      </p>
    </div>
  );
}
