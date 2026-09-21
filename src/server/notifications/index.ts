/**
 * Notifikationsoversigt (fase 4.5/4.6, bygget skærm-først — ADR 0042).
 *
 * Skærmen før motoren: admin kan se hvilke beskeder platformen skylder at sende, ad hvilken
 * kanal, og præcis hvor langt hver kanal er fra at kunne sende noget. Der udsendes intet
 * herfra — modulet læser tilstand, det ændrer den ikke.
 *
 * Kanaltilstanden spørges hos adapteren selv (`sender.name`), ikke ved at læse
 * leverandørens env-nøgler en gang til. Nøglenavnene bor ét sted, i `src/lib/<vendor>/`,
 * og et skift dér må ikke kunne få denne skærm til at lyve. Samme greb som fase 4.4's
 * opsummering (`src/server/summaries/`).
 *
 * Katalogets fire typer er fase 4's minimumskrav (`docs/fase-4.md`, DoD), ikke et forslag
 * herfra. At de står i kode og ikke i en tabel er bevidst og midlertidigt — se ADR 0048:
 * "skabeloner som data" handler om skabelon-TEKSTEN, og den er netop det der endnu ikke
 * findes. Når 4.6 giver skabelonerne deres tabel, flytter kataloget med.
 *
 * Synlige huller frem for gæt (docs/stub-politik.md): en kanal uden rigtig adapter kaldes
 * en stub, ikke "klar", og et udsendelsestidspunkt der ikke er besluttet, vises som
 * ikke fastlagt frem for at få et tal.
 */

import { createEmailSender } from "@/lib/email";
import { createSmsSender } from "@/lib/sms";
import { isEnabled, type FeatureFlag } from "@/server/flags";

export type NotificationChannelKey = "email" | "sms";

export interface NotificationChannel {
  key: NotificationChannelKey;
  label: string;
  vendor: string;
  flag: FeatureFlag;
  /** "live" = rigtig adapter bag porten. "stub" = logger og resolver, sender intet. */
  state: "live" | "stub";
  flagEnabled: boolean;
  /** Hvad der mangler, når tilstanden er stub. */
  unlockedBy: string;
}

export interface NotificationType {
  key: string;
  label: string;
  /** Hvad der udløser beskeden. */
  trigger: string;
  recipients: string;
  channels: readonly NotificationChannelKey[];
  /**
   * Hvornår beskeden sendes efter udløseren. `null` = ikke fastlagt; det er en
   * ejer-beslutning, ikke en teknisk detalje, og bliver ikke gættet her.
   */
  timing: string | null;
}

export interface NotificationOverviewState {
  channels: readonly NotificationChannel[];
  types: readonly NotificationType[];
  /** Sand når mindst én kanal kan sende rigtigt. Styrer skærmens forbehold. */
  anyChannelLive: boolean;
}

/**
 * Fase 4's minimumsdækning (`docs/fase-4.md`, DoD). Kanalvalget følger den låste stak i
 * CLAUDE.md: Resend bærer transaktionsmails, inMobile bruges til "rating/påmindelser" —
 * derfor SMS netop på påmindelse og ratinganmodning, ikke på de øvrige.
 *
 * TODO(ejer): udsendelsestidspunkter for påmindelse og ratinganmodning. Påmindelsen hænger
 * desuden sammen med ændre-/aflyse-vinduet (byggespec §12 pkt. 4), som er uafklaret — en
 * påmindelse der lander efter fristen for at flytte, er værdiløs.
 */
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  {
    key: "meeting-reminder",
    label: "Mødepåmindelse",
    trigger: "Et kommende møde nærmer sig",
    recipients: "Ejer og boardets partnere",
    channels: ["email", "sms"],
    timing: null,
  },
  {
    key: "meeting-changed",
    label: "Aflysning eller flytning",
    trigger: "Mødet aflyses eller flyttes",
    recipients: "Ejer og boardets partnere",
    channels: ["email"],
    timing: "Straks ved ændringen",
  },
  {
    key: "rating-request",
    label: "Ratinganmodning",
    trigger: "Mødet er registreret som afholdt",
    recipients: "Mødets deltagere",
    channels: ["email", "sms"],
    timing: null,
  },
  {
    key: "payment-failed",
    label: "Fejlet betaling",
    trigger: "Alunta melder et mislykket træk",
    recipients: "Ejer",
    channels: ["email"],
    timing: "Straks ved fejlet træk",
  },
] as const;

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
      state: email.name === "stub" ? "stub" : "live",
      flagEnabled: isEnabled("email", env),
      unlockedBy: "Resend-konto, nøgle og FLAG_EMAIL",
    },
    {
      key: "sms",
      label: "SMS",
      vendor: "inMobile (DK)",
      flag: "sms",
      state: sms.name === "stub" ? "stub" : "live",
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
