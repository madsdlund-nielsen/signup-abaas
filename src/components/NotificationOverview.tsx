import Link from "next/link";

import { StatusBadge } from "@/components/StatusBadge";
import type {
  NotificationChannel,
  NotificationChannelKey,
  NotificationOverviewState,
} from "@/server/notifications";
import type { DeliveryLogEntry } from "@/server/notifications/templates";
import { channelBadge, type TemplateSummary } from "@/server/notifications/template-state";

const CHANNEL_LABELS: Record<NotificationChannelKey, string> = {
  email: "E-mail",
  sms: "SMS",
};

function channelList(keys: readonly NotificationChannelKey[]): string {
  return keys.map((key) => CHANNEL_LABELS[key]).join(" · ");
}

/** Én linje om hvad kanalen kan i dag — og hvis den ikke kan noget, hvorfor ikke. */
function channelStatus(channel: NotificationChannel): string {
  if (channel.state === "live") return "Sender";
  if (channel.state === "demo") {
    return "Demo — logger [DEMO] og kvitterer med et falsk id, men sender ikke til nogen";
  }
  return channel.flagEnabled
    ? `Sender ikke — nøgler mangler. Låses op af: ${channel.unlockedBy}`
    : `Sender ikke — ${channel.unlockedBy}`;
}

const STATUS_LABELS: Record<DeliveryLogEntry["status"], string> = {
  afventer: "Afventer",
  sendt: "Sendt",
  fejlet: "Fejlet",
  stub: "Stub (intet sendt)",
  demo: "Demo (intet sendt)",
};

const LOG_TIME = new Intl.DateTimeFormat("da-DK", {
  timeZone: "Europe/Copenhagen",
  dateStyle: "short",
  timeStyle: "short",
});

/** Skabelonstatus for én kanal på én type — det admin ser i beskedlisten. */
function TemplateCell({
  type,
  templates,
}: {
  type: NotificationOverviewState["types"][number];
  templates: TemplateSummary;
}) {
  return (
    <div className="badge-list">
      {type.channels.map((key) => {
        const state = templates[type.key]?.[key];
        const badge = state ? channelBadge(state) : "ingen-live";
        return (
          <div className="badge-list__item" key={key}>
            <span>{CHANNEL_LABELS[key]}</span>
            {badge === "ingen-live" ? (
              <StatusBadge tone="none">Ingen live</StatusBadge>
            ) : (
              <StatusBadge tone="live">Live · v{state?.live?.version}</StatusBadge>
            )}
            {badge === "live-med-udkast" ? (
              <StatusBadge tone="draft">Udkast afviger</StatusBadge>
            ) : state?.draft && badge === "ingen-live" ? (
              <StatusBadge tone="draft">Udkast</StatusBadge>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Notifikationsoversigten (fase 4.5/4.6). Ren præsentation: kanalernes faktiske tilstand,
 * de beskeder platformen skylder at sende, hvad der er LIVE pr. besked og kanal (når
 * skabeloner er indlæst), og de seneste udsendelser.
 *
 * Skærmen lover ikke mere end den kan holde: så længe en kanal er en stub, siger den
 * "sender ikke", og et udsendelsestidspunkt der ikke er besluttet, står som ikke fastlagt.
 */
export function NotificationOverview({
  state,
  templates,
  deliveries,
}: {
  state: NotificationOverviewState;
  /** Udeladt = skabeloner ikke indlæst; så vises hverken skabelonkolonne eller redigeringslink. */
  templates?: TemplateSummary;
  /** Udeladt = loggen ikke indlæst; en tom liste er «intet sendt endnu». */
  deliveries?: readonly DeliveryLogEntry[];
}) {
  const typeLabel = (key: string) => state.types.find((type) => type.key === key)?.label ?? key;

  return (
    <div className="stack">
      <p className="eyebrow">Kanaler</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Kanal</th>
              <th className="table__head">Leverandør</th>
              <th className="table__head">Tilstand</th>
            </tr>
          </thead>
          <tbody>
            {state.channels.map((channel) => (
              <tr key={channel.key} className="table__row">
                <td className="table__cell">{channel.label}</td>
                <td className="table__cell">{channel.vendor}</td>
                <td className="table__cell">{channelStatus(channel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!state.anyChannelLive ? (
        <p className="empty">
          Ingen kanal kan sende endnu. Listen nedenfor er derfor hvad platformen vil sende,
          ikke hvad den har sendt.
        </p>
      ) : null}

      <p className="eyebrow">Beskeder</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Besked</th>
              <th className="table__head">Udløses af</th>
              <th className="table__head">Tidspunkt</th>
              <th className="table__head">Modtagere</th>
              <th className="table__head">Kanal</th>
              {templates ? <th className="table__head">Skabelon</th> : null}
              {templates ? <th className="table__head">Handling</th> : null}
            </tr>
          </thead>
          <tbody>
            {state.types.map((type) => (
              <tr key={type.key} className="table__row">
                <td className="table__cell">{type.label}</td>
                <td className="table__cell">{type.trigger}</td>
                <td className="table__cell">{type.timing ?? "Ikke fastlagt"}</td>
                <td className="table__cell">{type.recipients}</td>
                <td className="table__cell">{channelList(type.channels)}</td>
                {templates ? (
                  <td className="table__cell">
                    <TemplateCell type={type} templates={templates} />
                  </td>
                ) : null}
                {templates ? (
                  <td className="table__cell">
                    <Link href={`/admin/notifikationer/${type.key}`}>Redigér skabeloner</Link>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deliveries ? (
        <>
          <p className="eyebrow">Seneste udsendelser</p>
          {deliveries.length === 0 ? (
            <p className="empty">Der er ikke sendt eller forsøgt sendt noget endnu.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="table__head">Tidspunkt</th>
                    <th className="table__head">Besked</th>
                    <th className="table__head">Kanal</th>
                    <th className="table__head">Status</th>
                    <th className="table__head">Forsøg</th>
                    <th className="table__head">Skabelon</th>
                    <th className="table__head">Fejl</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id} className="table__row">
                      <td className="table__cell">{LOG_TIME.format(new Date(delivery.createdAt))}</td>
                      <td className="table__cell">{typeLabel(delivery.typeKey)}</td>
                      <td className="table__cell">{CHANNEL_LABELS[delivery.channel]}</td>
                      <td className="table__cell">{STATUS_LABELS[delivery.status]}</td>
                      <td className="table__cell table__cell--num">{delivery.attempt}</td>
                      <td className="table__cell">
                        {delivery.templateVersion ? `v${delivery.templateVersion}` : "—"}
                      </td>
                      <td className="table__cell">{delivery.error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
