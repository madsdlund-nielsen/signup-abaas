/**
 * Notifikationskataloget (fase 4.5/4.6, ADR 0048 + 0057): HVILKE beskeder platformen skylder
 * at sende, til hvem, ad hvilke kanaler — og hvilke variabler en skabelon må bruge.
 *
 * Kataloget bor i kode og ikke i en tabel, fordi hver post er bundet til kode: en udløser der
 * sender beskeden, og et sæt variabler den udløser kan levere. En række i en tabel kunne
 * love en besked ingen kode sender. Det der ER data — selve emnelinjen og brødteksten — bor i
 * `notification_template` (migration 0021). Filen er ren (ingen env, ingen Supabase), så den
 * kan bruges overalt, også af skabelon-editorens preview.
 *
 * Ingen skabelontekst her, heller ikke som placeholder (ADR 0048, docs/stub-politik.md).
 */

export type NotificationChannelKey = "email" | "sms";

/** En flettevariabel en skabelon må bruge: `{{key}}`. Nøglen er små bogstaver, tal og _. */
export interface NotificationVariable {
  key: string;
  /** Hvad værdien er, til admin i editoren. */
  label: string;
}

/**
 * Hvornår en planlagt besked sendes i forhold til mødet. Maskinlæsbar modpart til
 * `NotificationType.timing` (som er teksten admin ser). Begge er `null`, indtil ejeren har
 * besluttet det — så sender planlæggeren ingenting.
 */
export interface NotificationSchedule {
  /**
   * Påmindelse: minutter FØR mødestart beskeden sendes. Ratinganmodning: minutter EFTER
   * mødets slut.
   */
  offsetMinutes: number;
  /**
   * Kun ratinganmodning: hvor langt tilbage en kørsel må lede efter møder den er kommet for
   * sent til, så et nyligt afholdt møde ikke går glip af anmodningen hvis en kørsel udeblev —
   * men historiske møder ikke pludselig får en anmodning den dag udsendelsen tændes.
   */
  catchUpMinutes?: number;
}

export interface NotificationType {
  key: string;
  label: string;
  /** Hvad der udløser beskeden. */
  trigger: string;
  recipients: string;
  channels: readonly NotificationChannelKey[];
  /**
   * Hvornår beskeden sendes efter udløseren, som tekst til admin. `null` = ikke fastlagt; det
   * er en ejer-beslutning, ikke en teknisk detalje, og bliver ikke gættet her.
   */
  timing: string | null;
  /**
   * Maskinlæsbar tid for de planlagte beskeder (påmindelse, ratinganmodning). `null` så længe
   * `timing` er `null`; de to sættes sammen (tests/integration/notifications.test.ts vogter det).
   * Hændelsesdrevne beskeder (aflysning, fejlet betaling) har ingen tidsplan.
   */
  schedule: NotificationSchedule | null;
  /** De variabler en skabelon til denne type må bruge — og som koden der sender den leverer. */
  variables: readonly NotificationVariable[];
}

const BOARD_NAVN: NotificationVariable = { key: "board_navn", label: "Boardets navn" };
/**
 * Modtagerens navn = kontoens visningsnavn (`app_user.display_name`, `/konto`, ADR 0061). Motoren
 * leverer den selv pr. modtager — kalderne sender den ikke. Har modtageren intet navn, findes
 * værdien ikke, og en skabelon der bruger den bliver en `fejlet` udsendelse (ADR 0057 pkt. 3:
 * aldrig et stille tomt felt, aldrig et opfundet navn). Partnernes katalognavn
 * (`partner_profile.name`) er et andet felt og bruges ikke her.
 */
const MODTAGER_NAVN: NotificationVariable = {
  key: "modtager_navn",
  label: "Modtagerens navn (kontoens navn) — mangler modtageren et, fejler udsendelsen",
};
const MOEDE_TIDSPUNKT: NotificationVariable = {
  key: "moede_tidspunkt",
  label: "Mødets tidspunkt (dansk tid)",
};

/**
 * Fase 4's minimumsdækning (`docs/fase-4.md`, DoD). Kanalvalget følger den låste stak i
 * CLAUDE.md: Resend bærer transaktionsmails, inMobile bruges til "rating/påmindelser" —
 * derfor SMS netop på påmindelse og ratinganmodning, ikke på de øvrige.
 *
 * `modtager_navn` kom med kontoprofilen (ADR 0061): navnet findes kun hos dem der har angivet et
 * på `/konto`, så en skabelon der bruger det fejler for de øvrige — den afvejning er admins,
 * og editoren siger det på variablen.
 *
 * TODO(ejer): udsendelsestidspunkter for påmindelse og ratinganmodning (`timing` + `schedule`).
 * Påmindelsen hænger desuden sammen med ændre-/aflyse-vinduet (byggespec §12 pkt. 4), som er
 * uafklaret — en påmindelse der lander efter fristen for at flytte, er værdiløs.
 */
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  {
    key: "meeting-reminder",
    label: "Mødepåmindelse",
    trigger: "Et kommende møde nærmer sig",
    recipients: "Ejer og boardets partnere",
    channels: ["email", "sms"],
    timing: null,
    schedule: null,
    variables: [
      MODTAGER_NAVN,
      MOEDE_TIDSPUNKT,
      BOARD_NAVN,
      { key: "link", label: "Link til mødet i platformen" },
    ],
  },
  {
    key: "meeting-changed",
    label: "Aflysning eller flytning",
    trigger: "Mødet aflyses eller flyttes",
    recipients: "Ejer og boardets partnere",
    channels: ["email"],
    timing: "Straks ved ændringen",
    schedule: null,
    variables: [
      MODTAGER_NAVN,
      { key: "aendring", label: "Hvad der skete: «aflyst» eller «flyttet»" },
      { ...MOEDE_TIDSPUNKT, label: "Mødets tidspunkt (dansk tid) — det nye ved flytning" },
      BOARD_NAVN,
      { key: "link", label: "Link til mødet i platformen" },
    ],
  },
  {
    key: "rating-request",
    label: "Ratinganmodning",
    trigger: "Mødet er registreret som afholdt",
    recipients: "Mødets deltagere",
    channels: ["email", "sms"],
    timing: null,
    schedule: null,
    variables: [
      MODTAGER_NAVN,
      MOEDE_TIDSPUNKT,
      BOARD_NAVN,
      { key: "link", label: "Personligt engangslink til at vurdere mødet uden login (ellers link til mødet)" },
    ],
  },
  {
    key: "payment-failed",
    label: "Fejlet betaling",
    trigger: "Alunta melder et mislykket træk",
    recipients: "Ejer",
    channels: ["email"],
    timing: "Straks ved fejlet træk",
    schedule: null,
    variables: [MODTAGER_NAVN, BOARD_NAVN, { key: "link", label: "Link til betalingssiden" }],
  },
] as const;

export function getNotificationType(key: string): NotificationType | undefined {
  return NOTIFICATION_TYPES.find((type) => type.key === key);
}

/** Variabelnøglerne en type tillader — til validering og rendering. */
export function allowedVariableKeys(type: NotificationType): readonly string[] {
  return type.variables.map((variable) => variable.key);
}
