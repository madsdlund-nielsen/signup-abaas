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
 *   - Samtykke: der findes ingen samtykketabel — kun en cookie i browseren. SMS-samtykket er
 *     undtagelsen: det er en kolonne på brugeren (0024) og står under `person`.
 */

export interface AppUserRow {
  id: string;
  email: string;
  created_at: string;
  /** Kontoprofilen (0024, ADR 0061). Valgfrie i typen, så ældre rækkeformer stadig kan sammensættes. */
  display_name?: string | null;
  phone_e164?: string | null;
  time_zone?: string | null;
  sms_opt_in?: boolean | null;
  sms_opt_in_at?: string | null;
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
  "AI-resuméer og transskripter — er endnu ikke gemt som data.",
  "Samtykkelog — der findes ingen samtykketabel; cookie-samtykke registreres kun i personens egen browser. SMS-samtykket (tilstand + tidspunkt) er med under `person`, men uden historik over tidligere valg.",
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
      })),
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
      // Kontoprofilen (`/konto`, ADR 0061). SMS-samtykket er personens eget valg og hører med.
      navn: raw.user.display_name ?? null,
      telefon: raw.user.phone_e164 ?? null,
      tidszone: raw.user.time_zone ?? null,
      sms_samtykke: {
        givet: raw.user.sms_opt_in ?? false,
        tidspunkt: raw.user.sms_opt_in_at ?? null,
      },
    },
    roller: raw.roles.map((r) => r.role).sort(),
    ejer: hasOwnerData ? ownerSection(raw) : null,
    partner: partnerSection(raw),
    samtykke: {
      registreret: false,
      note: "Der findes ingen samtykketabel. Samtykke til cookies gemmes kun som en cookie i personens egen browser og kan ikke udtrækkes herfra. SMS-samtykket står under `person.sms_samtykke`.",
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
