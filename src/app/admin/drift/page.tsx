import Link from "next/link";
import type { Metadata } from "next";

import { OpsOverview, formatTimestamp } from "@/components/OpsOverview";
import { PageBody, PageHeader } from "@/components/PageHeader";

import { getIntegrationOverview, getOpsOverview } from "@/server/admin";

export const metadata: Metadata = { title: "Drift — Admin" };
export const dynamic = "force-dynamic";

/**
 * Admin-driftsoverblik (fase 5.4, bygget skærm-først — ADR 0042/0053). Rolle-guarden ligger i
 * /admin/layout.tsx; tallene læses via den authede klient, så RLS (admin-policies på
 * tabellerne) er andet lag. Siden er passiv med vilje: tal og status, ingen handlinger.
 *
 * Honorar (indeværende måned, pr. linjestatus) indgår fra ADR 0055; PostHog-driftstatus er
 * stadig TODO(mads) nedenfor.
 */
export default async function AdminOpsPage() {
  const [ops, integrations] = await Promise.all([getOpsOverview(), getIntegrationOverview()]);

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Drift
          </>
        }
        title="Driftsoverblik"
        lead="Hvad der kører, hvad der er koblet på, og hvor integrationerne står. Tal først — detaljerne ligger i de enkelte flader."
      />
      <PageBody>
        {ops ? (
          <p className="factline">
            <span>Opgjort {formatTimestamp(ops.generatedAt)}</span>
          </p>
        ) : null}

        <OpsOverview ops={ops} integrations={integrations} />

        <section className="stack section-rule">
          <p className="eyebrow">Fejl og ydelse (PostHog)</p>
          {/* TODO(mads): PostHog-driftstatus (fejlrate, seneste fejl) kræver en live projektnøgle
              og en query-adapter bag analytics-porten. Ingen tal før da — ingen falske. */}
          <p className="body">
            PostHog-driftstatus vises ikke endnu: den kræver en live projektnøgle, og analytics-porten
            er en stub. Indtil da kan fejl og ydelse ses direkte i{" "}
            <a href="https://eu.posthog.com" rel="noreferrer noopener" target="_blank">
              PostHog (EU)
            </a>
            .
          </p>
        </section>
      </PageBody>
    </>
  );
}
