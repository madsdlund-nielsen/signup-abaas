import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";
import { TemplateEditor } from "@/components/TemplateEditor";

import { getNotificationType, listNotificationChannels } from "@/server/notifications";
import { PREVIEW_EXAMPLES } from "@/server/notifications/examples";
import {
  discardTemplateDraft,
  publishTemplate,
  saveTemplateDraft,
} from "@/server/notifications/template-actions";
import { groupByChannel } from "@/server/notifications/template-state";
import { listTemplateVersions } from "@/server/notifications/templates";

export const metadata: Metadata = { title: "Skabeloner — Notifikationer — Admin" };
export const dynamic = "force-dynamic";

const CHANNEL_LABELS = { email: "E-mail", sms: "SMS" } as const;

/**
 * Skabelon-editor for én beskedtype (fase 4.6, ADR 0057). Rolle-guarden ligger i
 * /admin/layout.tsx; skrivning sker i server-actions bag requireRole('admin') og RLS (0021)
 * lader kun admin læse skabelonerne.
 *
 * Eksplicitte krav: live preview mens man skriver, og en tydelig markering af hvad der er
 * LIVE og hvad der kun er udkast (se TemplateEditor).
 */
export default async function AdminNotificationTemplatePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type: typeKey } = await params;
  const type = getNotificationType(typeKey);
  if (!type) notFound();

  const versions = await listTemplateVersions(type.key);
  const channelStates = groupByChannel(versions, type.channels);
  const adapters = listNotificationChannels();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · <Link href="/admin/notifikationer">Notifikationer</Link> ·{" "}
            {type.label}
          </>
        }
        title={type.label}
        lead={`${type.trigger}. Modtagere: ${type.recipients.toLowerCase()}. Tidspunkt: ${type.timing ?? "ikke fastlagt (ejerens beslutning)"}.`}
      />
      <PageBody>
        <p className="form__notice" role="status">
          Kun den LIVE tekst bruges ved udsendelse. Et udkast påvirker ingenting, før det er
          publiceret — og en publiceret version kan aldrig ændres bagefter, kun afløses af en ny.
        </p>

        {adapters
          .filter((adapter) => type.channels.includes(adapter.key) && adapter.state !== "live")
          .map((adapter) => (
            <p className="form__notice" role="status" key={adapter.key}>
              {adapter.label}-kanalen er {adapter.state === "demo" ? "i demo" : "en stub"} i dag:
              en publiceret skabelon bliver renderet og logget, men{" "}
              {adapter.state === "demo" ? "kun [DEMO]-kvitteret" : "ikke sendt"} til nogen. Låses op af:{" "}
              {adapter.unlockedBy}.
            </p>
          ))}

        <TemplateEditor
          typeKey={type.key}
          channels={channelStates.map((state) => ({ label: CHANNEL_LABELS[state.channel], state }))}
          variables={type.variables}
          examples={PREVIEW_EXAMPLES}
          actions={{ save: saveTemplateDraft, publish: publishTemplate, discard: discardTemplateDraft }}
        />
      </PageBody>
    </>
  );
}
