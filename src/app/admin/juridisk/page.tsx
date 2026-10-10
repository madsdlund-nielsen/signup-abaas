import Link from "next/link";
import type { Metadata } from "next";

import {
  ConsentLogGap,
  ErasureReference,
  LegalDocumentTable,
  SubjectAccessForm,
} from "@/components/LegalInterface";
import { PageBody, PageHeader } from "@/components/PageHeader";

import { LEGAL_DOCUMENTS, subjectAccessErrorMessage } from "@/server/admin/legal";

export const metadata: Metadata = { title: "Juridisk — Admin" };
export const dynamic = "force-dynamic";

/**
 * Juridisk download-interface (fase 5.5, byggespec §11, ADR 0053). Rolle-guarden ligger i
 * /admin/layout.tsx; selve udtrækket bærer sit eget admin-tjek i route handleren, fordi /api
 * ligger uden for proxyen.
 *
 * Interfacet bygges, ikke indholdet: ToS og honoraraftale er ejerens og står som
 * "Ikke udarbejdet". Siden læser ingen filer — docs/ bundles ikke på Netlify.
 */
export default async function AdminLegalPage({
  searchParams,
}: {
  searchParams: Promise<{ fejl?: string | string[] }>;
}) {
  const { fejl } = await searchParams;
  const code = Array.isArray(fejl) ? fejl[0] : fejl;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Juridisk
          </>
        }
        title="Juridisk"
        lead="Indsigtsudtræk, samtykke, dokumenter og sletning samlet ét sted. Interfacet er bygget; dokumenterne er ejerens at skrive."
      />
      <PageBody>
        <SubjectAccessForm error={subjectAccessErrorMessage(code)} />
        <section className="section-rule">
          <ConsentLogGap />
        </section>
        <section className="section-rule">
          <LegalDocumentTable documents={LEGAL_DOCUMENTS} />
        </section>
        <section className="section-rule">
          <ErasureReference />
        </section>
      </PageBody>
    </>
  );
}
