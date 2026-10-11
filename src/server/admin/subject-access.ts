/**
 * Indsigtsudtræk (GDPR art. 15) — sammensætning (fase 5.5, ADR 0053).
 *
 * Ren funktion over rå rækker: ingen I/O, ingen Supabase. Indsamlingen (hvilke tabeller der
 * spørges, og med hvilke nøgler) ligger i `./subject-collect.ts`; her bliver rækkerne til ét
 * læsbart JSON-dokument om én person. Opdelingen gør sammensætningen testbar uden database
 * og lader udtrækkets FORM ændre sig uden at røre forespørgslerne.
 *
 * Afgrænsning (se ADR 0053 — hvad der IKKE er med står også i selve udtrækket, under
 * `afgraensning`, så modtageren ikke kan tro at det er udtømmende):
 *   - Kun data i Supabase (sandhedskilden). Data hos databehandlere er ikke med.
 *   - Vurderinger OM en partner (modtagne) er ikke med: afgiverens fortrolighed mod
 *     indsigtsretten er en jura-afvejning, ikke et teknisk valg. TODO(ejer): jura.
 *   - Partnernes private forberedelsesnoter er kun med for forfatteren selv.
 *   - Honorar findes endnu ikke som data (fase 5.1).
 *   - Revisionssporet for boardets sammensætning (`board_change`, 0025) er med for den der har
 *     UDFØRT ændringen (aktør-id), for ejeren af boardet og for den partner ændringen handler om.
 *     Andre aktørers id'er udleveres ikke — kun deres rolle (ejer/admin). Ingen navne/e-mails
 *     findes i sporet; partnernes navne slås op som i resten af udtrækket.
 *   - Samtykke: der findes ingen samtykketabel — kun en cookie i browseren (analytics). Samtykke
 *     til optagelse, AI og SMS er en del af kontrakten og registreres ikke pr. person (ADR 0065).
 */

export interface AppUserRow {
  id: string;
  email: string;
  created_at: string;
  /** Kontoprofilen (0024, ADR 0061). Valgfrie i typen, så ældre rækkeformer stadig kan sammensættes. */
  display_name?: string | null;
  phone_e164?: string | null;
  time_zone?: string | null;
}

export interface RoleRow {
  role: string;
}

export interface BoardRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}

export interface BoardPartnerRow {
  board_id: string;
  partner_id: string;
  is_lead: boolean;
}

/** Kun navnet bruges for andre end personen selv — se `partnerName`. */
export interface PartnerProfileRow {
  id: string;
  name: string;
  title?: string | null;
  is_internal?: boolean;
  languages?: string | null;
  personal_info?: string | null;
  short_bio?: string | null;
  long_bio?: string | null;
  photo_url?: string | null;
  app_user_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CompetenceTagRow {
  id: string;
  label: string;
}

export interface PartnerTagLinkRow {
  partner_profile_id: string;
  competence_tag_id: string;
}

export interface MembershipRow {
  id: string;
  board_id: string;
  frequency_weeks: number;
  status: string;
  provider: string;
  provider_customer_ref: string | null;
  card_status: string;
  created_at: string;
}

export interface ChargeRow {
  id: string;
  meeting_id: string;
  membership_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  failure_reason: string | null;
  provider_charge_ref: string | null;
  provider_invoice_ref: string | null;
  created_at: string;
}

export interface MeetingRow {
  id: string;
  board_id: string;
  provider: string;
  provider_booking_uid: string | null;
  starts_at: string;
  duration_minutes: number;
  prep_minutes: number;
  status: string;
  video_join_url: string | null;
  created_at: string;
}

export interface MeetingPartnerRow {
  meeting_id: string;
  partner_profile_id: string;
  registered_status: string | null;
  registered_at: string | null;
}

export interface MeetingNoteRow {
  id: string;
  meeting_id: string;
  partner_profile_id: string;
  body: string;
  created_at: string;
}

export interface PrepNoteRow {
  id: string;
  meeting_id: string;
  partner_profile_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface AgendaItemRow {
  id: string;
  meeting_id: string;
  kind: string;
  body: string;
  sort_order: number;
}

export interface RatingRow {
  id: string;
  meeting_id: string;
  rater_user_id: string | null;
  rater_partner_profile_id: string | null;
  subject_partner_profile_id: string | null;
  score: number;
  comment: string | null;
  created_at: string;
}

/** Revisionssporet for boardets sammensætning (0025, ADR 0062). Ingen persondata ud over id'er. */
export interface BoardChangeRecord {
  id: string;
  board_id: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  partner_id: string | null;
  replaced_partner_id: string | null;
  calcom_sync: string;
  created_at: string;
}

/** AI-resuméet som mødeartefakt (0022, ADR 0059). Det rå transskript gemmes ikke. */
export interface MeetingSummaryRow {
  id: string;
  meeting_id: string;
  status: string;
  summary: string | null;
  action_items: unknown;
  provider: string | null;
  model: string | null;
  generated_at: string | null;
  created_at: string;
}

/** Udsendelseslog (0021): at en besked blev sendt til personen — ikke teksten. */
export interface NotificationDeliveryRow {
  id: string;
  type_key: string;
  channel: string;
  related_id: string | null;
  status: string;
  provider_ref: string | null;
  created_at: string;
}

/** Engangslink til vurdering (0023). Selve tokenet gemmes aldrig. */
export interface RatingLinkRow {
  id: string;
  meeting_id: string;
  rater_user_id: string | null;
  rater_partner_profile_id: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface QuizAnswerRow {
  quiz_option_id: string;
  free_text: string | null;
  created_at: string;
}

export interface QuizOptionRow {
  id: string;
  quiz_question_id: string;
  label: string;
}

export interface QuizQuestionRow {
  id: string;
  prompt: string;
}

/** Alle rå rækker udtrækket kan hvile på. Tomme lister er gyldige — personen har bare intet dér. */
export interface RawSubjectData {
  user: AppUserRow;
  roles: RoleRow[];
  /** Boards personen ejer. */
  ownedBoards: BoardRow[];
  /** Personens egen partner-profil (hvis rollen findes). */
  partnerProfile: PartnerProfileRow | null;
  /** Boards personen sidder på som partner (kun id/navn — ikke ejerens oplysninger). */
  memberBoards: Pick<BoardRow, "id" | "name">[];
  boardPartners: BoardPartnerRow[];
  /** Navne på alle partnere der optræder i `boardPartners` / mødedeltagelse. */
  partnerNames: Pick<PartnerProfileRow, "id" | "name">[];
  competenceTags: CompetenceTagRow[];
  partnerTagLinks: PartnerTagLinkRow[];
  memberships: MembershipRow[];
  charges: ChargeRow[];
  meetings: MeetingRow[];
  meetingPartners: MeetingPartnerRow[];
  meetingNotes: MeetingNoteRow[];
  prepNotes: PrepNoteRow[];
  agendaItems: AgendaItemRow[];
  /** Vurderinger personen selv har AFGIVET (som ejer eller som partner). */
  ratingsGiven: RatingRow[];
  quizAnswers: QuizAnswerRow[];
  quizOptions: QuizOptionRow[];
  quizQuestions: QuizQuestionRow[];
  /**
   * Revisionsrækker personen er knyttet til: udførte dem (aktør), ejer boardet de handler om, eller
   * er den partner ændringen berører. Slået sammen uden dubletter.
   */
  boardChanges: BoardChangeRecord[];
  /** Resuméer af møderne på ejerens boards. */
  meetingSummaries: MeetingSummaryRow[];
  /** Beskeder sendt til personen. */
  notificationDeliveries: NotificationDeliveryRow[];
  /** Vurderingslinks udstedt til personen (som ejer eller som partner). */
  ratingLinks: RatingLinkRow[];
}

export const SUBJECT_ACCESS_EXPORT_VERSION = 1;

/**
 * Hvad udtrækket bevidst IKKE indeholder. Teksterne indgår i selve JSON'en, så et udtræk
 * aldrig kan læses som "alt vi har om dig" — det er "alt i Supabase, minus det her".
 */
export const NOT_INCLUDED: readonly string[] = [
  "Data hos databehandlere (Cal.com, Alunta, QuickPay, Nets, Resend, inMobile, PostHog, Ordbogen m.fl.) — se docs/gdpr/leverandoer-register.md. Referencerne til dem (fx kundenummer) er med, men indholdet hentes ikke.",
  "Supabase Auth-kontoen (adgangskode-hash, login-tidspunkter, sessioner) — ligger uden for forretningsdatabasen.",
  "Vurderinger, andre har afgivet OM personen som partner — afgiverens fortrolighed skal afvejes mod indsigtsretten (afventer ejer/jura).",
  "Andre partneres private forberedelsesnoter.",
  "Honorar — er endnu ikke bygget som data (fase 5.1).",
  "Transskripter og lydoptagelser — det rå transskript gemmes ikke (dataminimering, ADR 0059); optagelsen ligger hos Cal.com. AI-resuméet af ejerens møder er med.",
  "Teksten i udsendte beskeder — udsendelsesloggen (type, kanal, status) er med, men selve teksten gemmes ikke.",
  "Andre aktørers identitet i revisionssporet for boardets sammensætning — kun deres rolle (ejer/admin) er med.",
  "Samtykkelog — der findes ingen samtykketabel; cookie-samtykke registreres kun i personens egen browser. Samtykke til optagelse, AI-behandling og SMS er en del af kontrakten og registreres ikke pr. person (ADR 0065).",
];

export interface SubjectAccessMeta {
  generatedAt: string;
}

type Json = Record<string, unknown>;

function partnerName(names: RawSubjectData["partnerNames"], id: string): string | null {
  return names.find((p) => p.id === id)?.name ?? null;
}

function byCreated<T extends { created_at: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** En revisionsrække uden aktør-id: rollen er med, identiteten kun hvis det er personen selv. */
function changeEntry(raw: RawSubjectData, c: BoardChangeRecord): Json {
  return {
    tidspunkt: c.created_at,
    handling: c.action,
    udfoert_af_rolle: c.actor_role,
    udfoert_af_dig: c.actor_id === raw.user.id,
    partner: c.partner_id ? partnerName(raw.partnerNames, c.partner_id) : null,
    udskiftet_partner: c.replaced_partner_id ? partnerName(raw.partnerNames, c.replaced_partner_id) : null,
    calcom_synkronisering: c.calcom_sync,
  };
}

function summaryEntry(row: MeetingSummaryRow | undefined): Json | null {
  if (!row) return null;
  return {
    status: row.status,
    resume: row.summary,
    handlingspunkter: row.action_items,
    udbyder: row.provider,
    model: row.model,
    genereret: row.generated_at,
  };
}

function ownerSection(raw: RawSubjectData): Json {
  const boards = raw.ownedBoards.map((board) => {
    const membership = raw.memberships.find((m) => m.board_id === board.id) ?? null;
    const meetings = raw.meetings
      .filter((m) => m.board_id === board.id)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

    return {
      id: board.id,
      navn: board.name,
      oprettet: board.created_at,
      raadgivere: raw.boardPartners
        .filter((bp) => bp.board_id === board.id)
        .map((bp) => ({ navn: partnerName(raw.partnerNames, bp.partner_id), er_lead: bp.is_lead })),
      medlemskab: membership && {
        id: membership.id,
        frekvens_uger: membership.frequency_weeks,
        status: membership.status,
        kortstatus: membership.card_status,
        udbyder: membership.provider,
        udbyder_kundereference: membership.provider_customer_ref,
        oprettet: membership.created_at,
      },
      betalingstraek: membership
        ? byCreated(raw.charges.filter((c) => c.membership_id === membership.id)).map((c) => ({
            id: c.id,
            moede_id: c.meeting_id,
            beloeb_minor: c.amount_minor,
            valuta: c.currency,
            status: c.status,
            fejlaarsag: c.failure_reason,
            udbyder_reference: c.provider_charge_ref,
            udbyder_faktura: c.provider_invoice_ref,
            oprettet: c.created_at,
          }))
        : [],
      moeder: meetings.map((m) => ({
        id: m.id,
        status: m.status,
        starter: m.starts_at,
        varighed_min: m.duration_minutes,
        forberedelse_min: m.prep_minutes,
        udbyder: m.provider,
        booking_reference: m.provider_booking_uid,
        videolink: m.video_join_url,
        deltagere: raw.meetingPartners
          .filter((mp) => mp.meeting_id === m.id)
          .map((mp) => ({ navn: partnerName(raw.partnerNames, mp.partner_profile_id) })),
        // Mødenoter er skrevet AF partnere om mødet; ejeren kan læse dem (0012-RLS).
        noter: byCreated(raw.meetingNotes.filter((n) => n.meeting_id === m.id)).map((n) => ({
          forfatter: partnerName(raw.partnerNames, n.partner_profile_id),
          tekst: n.body,
          oprettet: n.created_at,
        })),
        dagsorden: raw.agendaItems
          .filter((a) => a.meeting_id === m.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((a) => ({ type: a.kind, tekst: a.body })),
        resume: summaryEntry(raw.meetingSummaries.find((x) => x.meeting_id === m.id)),
      })),
      // Alle ændringer af boardets sammensætning — også dem admin har udført på ejerens vegne.
      aendringer: byCreated(raw.boardChanges.filter((c) => c.board_id === board.id)).map((c) =>
        changeEntry(raw, c),
      ),
    };
  });

  const optionById = new Map(raw.quizOptions.map((o) => [o.id, o]));
  const questionById = new Map(raw.quizQuestions.map((q) => [q.id, q]));

  return {
    boards,
    quizsvar: byCreated(raw.quizAnswers).map((a) => {
      const option = optionById.get(a.quiz_option_id);
      const question = option ? questionById.get(option.quiz_question_id) : undefined;
      return {
        spoergsmaal: question?.prompt ?? null,
        svar: option?.label ?? null,
        fritekst: a.free_text,
        besvaret: a.created_at,
      };
    }),
    vurderinger_afgivet: ratingList(raw, (r) => r.rater_user_id === raw.user.id),
  };
}

function ratingList(raw: RawSubjectData, mine: (r: RatingRow) => boolean): Json[] {
  return byCreated(raw.ratingsGiven.filter(mine)).map((r) => ({
    moede_id: r.meeting_id,
    om_partner: r.subject_partner_profile_id
      ? partnerName(raw.partnerNames, r.subject_partner_profile_id)
      : null,
    score: r.score,
    kommentar: r.comment,
    afgivet: r.created_at,
  }));
}

function partnerSection(raw: RawSubjectData): Json | null {
  const profile = raw.partnerProfile;
  if (!profile) return null;

  const tagIds = new Set(
    raw.partnerTagLinks.filter((l) => l.partner_profile_id === profile.id).map((l) => l.competence_tag_id),
  );
  const meetingById = new Map(raw.meetings.map((m) => [m.id, m]));

  return {
    profil: {
      id: profile.id,
      navn: profile.name,
      titel: profile.title ?? null,
      intern: profile.is_internal ?? null,
      sprog: profile.languages ?? null,
      personlig_info: profile.personal_info ?? null,
      kort_bio: profile.short_bio ?? null,
      lang_bio: profile.long_bio ?? null,
      billede: profile.photo_url ?? null,
      oprettet: profile.created_at ?? null,
      opdateret: profile.updated_at ?? null,
    },
    kompetence_tags: raw.competenceTags.filter((t) => tagIds.has(t.id)).map((t) => t.label),
    boards: raw.memberBoards.map((b) => ({
      id: b.id,
      navn: b.name,
      er_lead: raw.boardPartners.some(
        (bp) => bp.board_id === b.id && bp.partner_id === profile.id && bp.is_lead,
      ),
    })),
    moeder: raw.meetingPartners
      .filter((mp) => mp.partner_profile_id === profile.id)
      .map((mp) => {
        const meeting = meetingById.get(mp.meeting_id);
        return {
          moede_id: mp.meeting_id,
          starter: meeting?.starts_at ?? null,
          moede_status: meeting?.status ?? null,
          registreret_status: mp.registered_status,
          registreret: mp.registered_at,
        };
      }),
    moedenoter_skrevet: byCreated(raw.meetingNotes.filter((n) => n.partner_profile_id === profile.id)).map(
      (n) => ({ moede_id: n.meeting_id, tekst: n.body, oprettet: n.created_at }),
    ),
    forberedelsesnoter_skrevet: byCreated(
      raw.prepNotes.filter((n) => n.partner_profile_id === profile.id),
    ).map((n) => ({ moede_id: n.meeting_id, tekst: n.body, oprettet: n.created_at, opdateret: n.updated_at })),
    vurderinger_afgivet: ratingList(raw, (r) => r.rater_partner_profile_id === profile.id),
    // Ændringer af et board der handler om partneren selv (tilføjet, fjernet, udskiftet, lead).
    board_aendringer_om_dig: byCreated(
      raw.boardChanges.filter((c) => c.partner_id === profile.id || c.replaced_partner_id === profile.id),
    ).map((c) => ({ board_id: c.board_id, ...changeEntry(raw, c) })),
  };
}

/**
 * Sæt de rå rækker sammen til udtrækket. Rolle-afsnittene er `null` når personen ikke har
 * dem — udtrækket siger så eksplicit "ingen data her" frem for at udelade nøglen, så en
 * modtager kan se at der er spurgt.
 */
export function composeSubjectAccessExport(raw: RawSubjectData, meta: SubjectAccessMeta): Json {
  const hasOwnerData =
    raw.roles.some((r) => r.role === "ejer") ||
    raw.ownedBoards.length > 0 ||
    raw.quizAnswers.length > 0 ||
    raw.ratingsGiven.some((r) => r.rater_user_id === raw.user.id);

  return {
    udtraek: {
      type: "Indsigt, GDPR art. 15",
      version: SUBJECT_ACCESS_EXPORT_VERSION,
      genereret: meta.generatedAt,
    },
    person: {
      id: raw.user.id,
      email: raw.user.email,
      oprettet: raw.user.created_at,
      // Kontoprofilen (`/konto`, ADR 0061). Samtykke til SMS er en del af kontrakten (ADR 0065).
      navn: raw.user.display_name ?? null,
      telefon: raw.user.phone_e164 ?? null,
      tidszone: raw.user.time_zone ?? null,
    },
    roller: raw.roles.map((r) => r.role).sort(),
    ejer: hasOwnerData ? ownerSection(raw) : null,
    partner: partnerSection(raw),
    // Tværgående: gælder uanset rolle (en admin har ingen ejer-/partnerprofil, men udfører ændringer).
    board_aendringer_udfoert: byCreated(raw.boardChanges.filter((c) => c.actor_id === raw.user.id)).map(
      (c) => ({ board_id: c.board_id, ...changeEntry(raw, c) }),
    ),
    beskeder_sendt_til_dig: byCreated(raw.notificationDeliveries).map((n) => ({
      type: n.type_key,
      kanal: n.channel,
      status: n.status,
      relateret_id: n.related_id,
      udbyder_reference: n.provider_ref,
      oprettet: n.created_at,
    })),
    vurderingslinks: byCreated(raw.ratingLinks).map((l) => ({
      moede_id: l.meeting_id,
      som: l.rater_user_id === raw.user.id ? "ejer" : "partner",
      udloeber: l.expires_at,
      brugt: l.used_at,
      oprettet: l.created_at,
    })),
    samtykke: {
      registreret: false,
      note: "Der findes ingen samtykketabel. Samtykke til cookies gemmes kun som en cookie i personens egen browser og kan ikke udtrækkes herfra. Samtykke til optagelse, AI-behandling og SMS er en del af kontrakten og registreres ikke pr. person (ADR 0065).",
    },
    afgraensning: { ikke_inkluderet: [...NOT_INCLUDED] },
  };
}

/** Navnet på download-filen. Indeholder bevidst hverken e-mail eller navn. */
export function exportFileName(generatedAt: string): string {
  return `indsigtsudtraek-${generatedAt.slice(0, 10)}.json`;
}

/** Enkel e-mail-normalisering: Supabase Auth gemmer adressen med små bogstaver. */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
