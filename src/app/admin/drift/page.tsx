import Link from "next/link";
import type { Metadata } from "next";

import { OpsOverview, formatTimestamp } from "@/components/OpsOverview";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { PostHogOpsSection } from "@/components/PostHogOps";

import { getIntegrationOverview, getOpsOverview, getPostHogOps } from "@/server/admin";

export const metadata: Metadata = { title: "Drift — Admin" };
export const dynamic = "force-dynamic";

/**
 * Admin-driftsoverblik (fase 5.4, bygget skærm-først — ADR 0042/0053). Rolle-guarden ligger i
 * /admin/layout.tsx; tallene læses via den authede klient, så RLS (admin-policies på
 * tabellerne) er andet lag. Siden er passiv med vilje: tal og status, ingen handlinger.
 *
 * Honorar (indeværende måned, pr. linjestatus) indgår fra ADR 0055. PostHog-driftstatus
 * (ADR 0066) læses server-side via læse-porten `ops-metrics`; TODO(mads): live nøgle
 * (POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID) — uden den viser sektionen "Ikke koblet på".
 */
export default async function AdminOpsPage() {
  // getPostHogOps kaster aldrig — en fejl hos PostHog vælter ikke siden (ADR 0066).
  const [ops, integrations, posthog] = await Promise.all([
    getOpsOverview(),
    getIntegrationOverview(),
    getPostHogOps(),
  ]);

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

        <PostHogOpsSection posthog={posthog} />
      </PageBody>
    </>
  );
}
