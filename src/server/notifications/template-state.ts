/**
 * Ren tilstandslogik for skabelon-versioner (fase 4.6, ADR 0057): hvad er live, hvad er
 * udkast, og afviger de? Ingen Supabase her — den bruges af både serversiderne og editorens
 * klientkomponent, så «LIVE»-markeringen kan ikke komme til at betyde noget forskelligt to steder.
 */

import type { NotificationChannelKey } from "./catalog";

export type TemplateStatus = "udkast" | "live" | "arkiveret";

export interface TemplateVersion {
  id: string;
  typeKey: string;
  channel: NotificationChannelKey;
  version: number;
  status: TemplateStatus;
  subject: string | null;
  body: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelTemplateState {
  channel: NotificationChannelKey;
  live: TemplateVersion | null;
  draft: TemplateVersion | null;
  /** Alle versioner, nyeste først. */
  history: TemplateVersion[];
}

/** Samler versionerne for én beskedtype pr. kanal. Kanaler uden versioner får en tom tilstand. */
export function groupByChannel(
  versions: readonly TemplateVersion[],
  channels: readonly NotificationChannelKey[],
): ChannelTemplateState[] {
  return channels.map((channel) => {
    const own = versions.filter((v) => v.channel === channel).sort((a, b) => b.version - a.version);
    return {
      channel,
      live: own.find((v) => v.status === "live") ?? null,
      draft: own.find((v) => v.status === "udkast") ?? null,
      history: own,
    };
  });
}

/** Er teksten i udkastet en anden end den live? Uden live er ethvert udkast «anderledes». */
export function differsFromLive(
  content: { subject: string | null; body: string },
  live: Pick<TemplateVersion, "subject" | "body"> | null,
): boolean {
  if (!live) return true;
  return (content.subject ?? "") !== (live.subject ?? "") || content.body !== live.body;
}

/**
 * Markeringen admin ser pr. kanal — det eksplicitte krav i fase 4.6 er at ingen skal være i tvivl
 * om hvad der er i produktion:
 *   - `ingen-live`    : der er ingen live skabelon — kanalen sender intet for denne type
 *   - `live`          : der er en live version og intet afvigende udkast
 *   - `live-med-udkast`: der er en live version OG et udkast der afviger fra den
 */
export type ChannelBadge = "ingen-live" | "live" | "live-med-udkast";

export function channelBadge(state: ChannelTemplateState): ChannelBadge {
  if (!state.live) return "ingen-live";
  if (state.draft && differsFromLive(state.draft, state.live)) return "live-med-udkast";
  return "live";
}

/** Oversigt til beskedlisten: pr. type og kanal, hvad der er live. */
export type TemplateSummary = Record<string, Partial<Record<NotificationChannelKey, ChannelTemplateState>>>;

export function summarize(versions: readonly TemplateVersion[]): TemplateSummary {
  const result: TemplateSummary = {};
  const typeKeys = [...new Set(versions.map((v) => v.typeKey))];
  for (const typeKey of typeKeys) {
    const own = versions.filter((v) => v.typeKey === typeKey);
    const channels = [...new Set(own.map((v) => v.channel))];
    const grouped = groupByChannel(own, channels);
    result[typeKey] = Object.fromEntries(grouped.map((state) => [state.channel, state]));
  }
  return result;
}
