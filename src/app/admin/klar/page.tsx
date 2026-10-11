import Link from "next/link";
import type { Metadata } from "next";

import { formatTimestamp } from "@/components/OpsOverview";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Readiness } from "@/components/Readiness";

import { getReadiness } from "@/server/admin";

export const metadata: Metadata = { title: "Klar til launch — Admin" };
export const dynamic = "force-dynamic";

/**
 * Go-live-tjekliste (fase 6.4, ADR 0069). Rolle-guarden ligger i /admin/layout.tsx, og
 * `getReadiness` kræver admin igen. Siden er passiv: den aflæser den KØRENDE konfiguration
 * (hvad der faktisk er rigtigt, demo eller stub i dette miljø) og viser hvad der står mellem os
 * og launch. Kommandolinjeversionen er `npm run launch:check`, som også tæller repoets TODO'er,
 * stub-register, backlog og ADR-indeks.
 */
export default async function AdminReadinessPage() {
  const report = await getReadiness();
  const now = new Date();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Klar til launch
          </>
        }
        title="Klar til launch"
        lead="Hvad der står mellem os og launch, aflæst af den konfiguration der kører her. Grønt betyder bevidst klar, ikke bare at intet er gået i stykker."
      />
      <PageBody>
        <p className="factline">
          <span>Opgjort {formatTimestamp(now.toISOString())}</span>
          <span>{report.summary.ready ? "Intet blokerer" : `${report.summary.totalBlockers} blokerer`}</span>
        </p>
        <Readiness report={report} />
      </PageBody>
    </>
  );
}
