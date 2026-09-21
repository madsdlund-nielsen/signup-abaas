import Link from "next/link";
import type { Metadata } from "next";

import { NotificationOverview } from "@/components/NotificationOverview";
import { PageBody, PageHeader } from "@/components/PageHeader";

import { getNotificationOverview } from "@/server/notifications";

export const metadata: Metadata = { title: "Notifikationer — Admin" };
export const dynamic = "force-dynamic";

/**
 * Admin-oversigt over notifikationer (fase 4.5/4.6, bygget skærm-først — ADR 0042).
 * Rolle-guarden ligger i /admin/layout.tsx.
 *
 * Siden er passiv med vilje: den viser hvad der vil blive sendt og hvor langt kanalerne er,
 * men har ingen send-knap. Der er endnu ingen motor at trykke på, og en knap der ikke gør
 * noget er værre end ingen knap.
 */
export default async function AdminNotificationsPage() {
  const state = getNotificationOverview();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Notifikationer
          </>
        }
        title="Notifikationer"
        lead="De beskeder platformen skylder at sende omkring et møde — og hvor langt hver kanal er fra at kunne sende dem."
      />
      <PageBody>
        <NotificationOverview state={state} />

        <p className="form__notice" role="status">
          Skabelonerne er ikke skrevet endnu. Redigering med live preview og en synlig
          markering af hvad der er live, bygges sammen med motoren (fase 4.6) — indtil da
          findes der hverken skabelontekst eller udsendelseslog at vise.
        </p>
      </PageBody>
    </>
  );
}
