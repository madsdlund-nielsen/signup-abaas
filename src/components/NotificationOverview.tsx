import type {
  NotificationChannel,
  NotificationChannelKey,
  NotificationOverviewState,
} from "@/server/notifications";

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
  return channel.flagEnabled
    ? `Sender ikke — nøgler mangler. Låses op af: ${channel.unlockedBy}`
    : `Sender ikke — ${channel.unlockedBy}`;
}

/**
 * Notifikationsoversigten (fase 4.5/4.6, skærm-først). Ren præsentation: kanalernes
 * faktiske tilstand og de beskeder platformen skylder at sende. Redaktionel som resten
 * af admin-fladen — tabeller og tekst, ingen bokse og ingen badges.
 *
 * Skærmen lover ikke mere end den kan holde: så længe en kanal er en stub, siger den
 * "sender ikke", og et udsendelsestidspunkt der ikke er besluttet, står som ikke fastlagt.
 */
export function NotificationOverview({ state }: { state: NotificationOverviewState }) {
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
