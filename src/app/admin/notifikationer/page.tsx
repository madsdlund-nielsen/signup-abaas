import Link from "next/link";
import type { Metadata } from "next";

import { NotificationOverview } from "@/components/NotificationOverview";
import { PageBody, PageHeader } from "@/components/PageHeader";

import { getNotificationOverview } from "@/server/notifications";
import { listRecentDeliveries, listTemplateVersions, summarize } from "@/server/notifications/templates";

export const metadata: Metadata = { title: "Notifikationer — Admin" };
export const dynamic = "force-dynamic";

/**
 * Admin-oversigt over notifikationer (fase 4.5/4.6, ADR 0048 + 0057). Rolle-guarden ligger i
 * /admin/layout.tsx. Siden læser kun: den viser hvad der vil blive sendt, hvilke skabeloner
 * der er LIVE, og de seneste udsendelser. Skabelonerne redigeres på /admin/notifikationer/[type].
 *
 * Der er bevidst ingen send-knap: udsendelserne udløses af hændelser (aflysning) og af en
 * planlagt kørsel, som endnu ikke er tændt (tidspunkterne er ejerens, ADR 0048).
 */
export default async function AdminNotificationsPage() {
  const state = getNotificationOverview();
  const [versions, deliveries] = await Promise.all([listTemplateVersions(), listRecentDeliveries()]);
  const templates = summarize(versions);
  const anyLive = versions.some((version) => version.status === "live");

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Notifikationer
          </>
        }
        title="Notifikationer"
        lead="De beskeder platformen skylder at sende omkring et møde — hvad der er live, og hvor langt hver kanal er fra at kunne sende dem."
      />
      <PageBody>
        {!anyLive ? (
          <p className="form__notice" role="status">
            Ingen skabeloner er live endnu. Uden en live skabelon sender motoren ingenting — den
            logger «fejlet: ingen live skabelon» og opfinder aldrig en tekst. Skriv og publicér
            skabelonerne under «Redigér skabeloner».
          </p>
        ) : null}

        <NotificationOverview state={state} templates={templates} deliveries={deliveries} />
      </PageBody>
    </>
  );
}
