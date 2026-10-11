/**
 * Katalog over de juridiske dokumenter admin skal kunne finde (fase 5.5, ADR 0053).
 *
 * Interfacet bygges, ikke indholdet: ToS og honoraraftale er ejerens (CLAUDE.md, uafklarede
 * punkter), og de findes ikke. Katalogen siger det højt i stedet for at pege på en tom fil.
 * Dokumenter i repoet vises som STI — filerne bundles ikke på Netlify, så siden læser dem
 * ikke via fs og viser ikke deres indhold.
 */

export type LegalDocumentState = "mangler" | "i-repo";

export interface LegalDocument {
  key: string;
  title: string;
  state: LegalDocumentState;
  /** Sti i repoet (kun når state = i-repo). Vises som tekst, ikke som link. */
  repoPath?: string;
  /** Hvad der mangler / hvad dokumentet er. */
  note: string;
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    key: "tos",
    title: "Vilkår og betingelser (ToS)",
    state: "mangler",
    // TODO(ejer): ToS er ikke udarbejdet. Interfacet er bygget; indholdet er ejerens. Kontrakten
    // (ToS + honoraraftale) skal også dække samtykke til mødeoptagelse, AI-behandling og SMS —
    // platformen har ingen opt-in/out (Mads, 2026-10-11, ADR 0065).
    note: "Ikke udarbejdet — afventer ejer. Skal også dække samtykke til optagelse, AI-behandling og SMS (ADR 0065).",
  },
  {
    key: "partner-agreement",
    title: "Honoraraftale (partner)",
    state: "mangler",
    // TODO(ejer): honoraraftalen er ikke udarbejdet; hænger sammen med honorarsats/moms (§12).
    // Skal også dække partnerens samtykke til optagelse, AI-behandling og SMS (ADR 0065).
    note: "Ikke udarbejdet — afventer ejer. Skal også dække samtykke til optagelse, AI-behandling og SMS (ADR 0065).",
  },
  {
    key: "processor-register",
    title: "Leverandør-register (databehandlere)",
    state: "i-repo",
    repoPath: "docs/gdpr/leverandoer-register.md",
    note: "Hvilke persondata hver sub-processor behandler, region, EU-residens og DPA-status. Åbn filen i repoet.",
  },
  {
    key: "erasure-flow",
    title: "Sletteflow (data-subject erasure)",
    state: "i-repo",
    repoPath: "docs/gdpr/sletteflow.md",
    note: "Beskriver sletningen på tværs af Supabase og databehandlere (ADR 0068). Selve sletningen står på denne side; opbevaringspligt og slette-SLA afventer ejer/jura.",
  },
];

/** Fejlkoder fra indsigts-routen → tekst til siden. Koderne indeholder aldrig persondata. */
export const SUBJECT_ACCESS_ERRORS: Record<string, string> = {
  "ugyldig-email": "Det ligner ikke en e-mailadresse. Tjek stavningen og prøv igen.",
  "ikke-fundet": "Ingen konto har den e-mailadresse. Der er intet at udtrække fra Supabase.",
  "ikke-konfigureret": "Supabase er ikke konfigureret i dette miljø, så der kan ikke udtrækkes noget.",
  "intern-fejl": "Udtrækket fejlede. Se serverloggen — den indeholder ikke persondata.",
};

export function subjectAccessErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return SUBJECT_ACCESS_ERRORS[code] ?? "Udtrækket kunne ikke gennemføres.";
}
