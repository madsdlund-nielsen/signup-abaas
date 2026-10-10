/**
 * Notifikationsoversigt (fase 4.5/4.6, bygget skærm-først — ADR 0042, udvidet i ADR 0057).
 *
 * Skærmen viser hvilke beskeder platformen skylder at sende, ad hvilken kanal, og præcis hvor
 * langt hver kanal er fra at kunne sende noget. Modulet læser tilstand, det ændrer den ikke;
 * redigering af skabeloner ligger i `./template-actions`, afsendelse i `./engine`.
 *
 * Kanaltilstanden spørges hos adapteren selv (`sender.name`), ikke ved at læse
 * leverandørens env-nøgler en gang til. Nøglenavnene bor ét sted, i `src/lib/<vendor>/`,
 * og et skift dér må ikke kunne få denne skærm til at lyve. Samme greb som fase 4.4's
 * opsummering (`src/server/summaries/`).
 *
 * Kataloget (`./catalog`) står i kode — ADR 0048, bekræftet i ADR 0057: det er bundet til de
 * udløsere og variabler koden leverer. Det der er data er skabelon-TEKSTEN (tabellen
 * `notification_template`, `./templates`).
 *
 * Synlige huller frem for gæt (docs/stub-politik.md): en kanal uden rigtig adapter kaldes
 * en stub, ikke "klar", og et udsendelsestidspunkt der ikke er besluttet, vises som
 * ikke fastlagt frem for at få et tal.
 */

import { createEmailSender } from "@/lib/email";
import { createSmsSender } from "@/lib/sms";
import { isEnabled, type FeatureFlag } from "@/server/flags";

import { NOTIFICATION_TYPES, type NotificationChannelKey, type NotificationType } from "./catalog";

export * from "./catalog";

export interface NotificationChannel {
  key: NotificationChannelKey;
  label: string;
  vendor: string;
  flag: FeatureFlag;
  /**
   * "live" = rigtig adapter bag porten. "demo" = dummy der logger `[DEMO]` og kvitterer med et
   * falsk id, men ikke når nogen. "stub" = logger og resolver, sender intet.
   */
  state: "live" | "demo" | "stub";
  flagEnabled: boolean;
  /** Hvad der mangler, når tilstanden er stub. */
  unlockedBy: string;
}

export interface NotificationOverviewState {
  channels: readonly NotificationChannel[];
  types: readonly NotificationType[];
  /** Sand når mindst én kanal kan sende rigtigt. Styrer skærmens forbehold. */
  anyChannelLive: boolean;
}

function channelState(adapterName: string): NotificationChannel["state"] {
  if (adapterName === "stub") return "stub";
  return adapterName === "demo" ? "demo" : "live";
}

export function listNotificationChannels(
  env: Record<string, string | undefined> = process.env,
): readonly NotificationChannel[] {
  const email = createEmailSender(env);
  const sms = createSmsSender(env);

  return [
    {
      key: "email",
      label: "E-mail",
      vendor: "Resend (EU, Dublin)",
      flag: "email",
      state: channelState(email.name),
      flagEnabled: isEnabled("email", env),
      unlockedBy: "Resend-konto, nøgle og FLAG_EMAIL",
    },
    {
      key: "sms",
      label: "SMS",
      vendor: "inMobile (DK)",
      flag: "sms",
      state: channelState(sms.name),
      flagEnabled: isEnabled("sms", env),
      unlockedBy: "inMobile-konto, nøgle og FLAG_SMS",
    },
  ];
}

export function getNotificationOverview(
  env: Record<string, string | undefined> = process.env,
): NotificationOverviewState {
  const channels = listNotificationChannels(env);
  return {
    channels,
    types: NOTIFICATION_TYPES,
    anyChannelLive: channels.some((c) => c.state === "live"),
  };
}
