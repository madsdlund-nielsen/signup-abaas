import { describe, expect, it } from "vitest";
import {
  NOT_INCLUDED,
  composeSubjectAccessExport,
  exportFileName,
  normaliseEmail,
  type RawSubjectData,
} from "@/server/admin/subject-access";

/**
 * Indsigtsudtrækkets sammensætning (fase 5.5, ADR 0053): ren funktion over rå rækker.
 * Alle data nedenfor er opfundne testpersoner.
 */

const META = { generatedAt: "2026-10-10T12:00:00.000Z" };

function emptyRaw(overrides: Partial<RawSubjectData> = {}): RawSubjectData {
  return {
    user: { id: "u1", email: "test@example.invalid", created_at: "2026-01-01T00:00:00Z" },
    roles: [],
    ownedBoards: [],
    partnerProfile: null,
    memberBoards: [],
    boardPartners: [],
    partnerNames: [],
    competenceTags: [],
    partnerTagLinks: [],
    memberships: [],
    charges: [],
    meetings: [],
    meetingPartners: [],
    meetingNotes: [],
    prepNotes: [],
    agendaItems: [],
    ratingsGiven: [],
    quizAnswers: [],
    quizOptions: [],
    quizQuestions: [],
    boardChanges: [],
    meetingSummaries: [],
    notificationDeliveries: [],
    ratingLinks: [],
    ...overrides,
  };
}

const ownerRaw = emptyRaw({
  user: {
    id: "u1",
    email: "test@example.invalid",
    created_at: "2026-01-01T00:00:00Z",
    display_name: "[DEMO] Eva Ejer",
    phone_e164: "+4500000000",
    time_zone: "America/Nuuk",
    sms_opt_in: true,
    sms_opt_in_at: "2026-02-01T10:00:00Z",
  },
  roles: [{ role: "ejer" }],
  ownedBoards: [{ id: "b1", owner_id: "u1", name: "Testboard", created_at: "2026-02-01T00:00:00Z" }],
  boardPartners: [{ board_id: "b1", partner_id: "p1", is_lead: true }],
  partnerNames: [{ id: "p1", name: "Partner Et" }],
  memberships: [
    {
      id: "ms1",
      board_id: "b1",
      frequency_weeks: 4,
      status: "aktiv",
      provider: "alunta",
      provider_customer_ref: "REF-1",
      card_status: "registreret",
      created_at: "2026-02-02T00:00:00Z",
    },
  ],
  charges: [
    {
      id: "c1",
      meeting_id: "m1",
      membership_id: "ms1",
      amount_minor: 100,
      currency: "DKK",
      status: "fejlet",
      failure_reason: "declined",
      provider_charge_ref: null,
      provider_invoice_ref: null,
      created_at: "2026-03-01T00:00:00Z",
    },
  ],
  meetings: [
    {
      id: "m1",
      board_id: "b1",
      provider: "calcom",
      provider_booking_uid: "uid-1",
      starts_at: "2026-03-01T09:00:00Z",
      duration_minutes: 60,
      prep_minutes: 15,
      status: "afholdt",
      video_join_url: null,
      created_at: "2026-02-20T00:00:00Z",
    },
  ],
  meetingPartners: [
    { meeting_id: "m1", partner_profile_id: "p1", registered_status: "afholdt", registered_at: null },
  ],
  meetingNotes: [
    { id: "n1", meeting_id: "m1", partner_profile_id: "p1", body: "Notetekst", created_at: "2026-03-02T00:00:00Z" },
  ],
  agendaItems: [
    { id: "a2", meeting_id: "m1", kind: "spoergsmaal", body: "Andet", sort_order: 2 },
    { id: "a1", meeting_id: "m1", kind: "dagsorden", body: "Først", sort_order: 1 },
  ],
  quizAnswers: [{ quiz_option_id: "o1", free_text: null, created_at: "2026-01-02T00:00:00Z" }],
  quizOptions: [{ id: "o1", quiz_question_id: "q1", label: "Vækst" }],
  quizQuestions: [{ id: "q1", prompt: "Hvad vil du?" }],
  ratingsGiven: [
    {
      id: "r1",
      meeting_id: "m1",
      rater_user_id: "u1",
      rater_partner_profile_id: null,
      subject_partner_profile_id: "p1",
      score: 4,
      comment: "God",
      created_at: "2026-03-03T00:00:00Z",
    },
  ],
});

describe("composeSubjectAccessExport — ejer", () => {
  const doc = composeSubjectAccessExport(ownerRaw, META) as Record<string, any>;

  it("mærker udtrækket og identificerer personen", () => {
    expect(doc.udtraek).toMatchObject({ genereret: META.generatedAt, version: 1 });
    expect(doc.person).toMatchObject({ id: "u1", email: "test@example.invalid", oprettet: "2026-01-01T00:00:00Z" });
    expect(doc.roller).toEqual(["ejer"]);
  });

  it("tager kontoprofilen med: navn, telefon, tidszone og SMS-samtykke med tidspunkt (ADR 0061)", () => {
    expect(doc.person).toEqual({
      id: "u1",
      email: "test@example.invalid",
      oprettet: "2026-01-01T00:00:00Z",
      navn: "[DEMO] Eva Ejer",
      telefon: "+4500000000",
      tidszone: "America/Nuuk",
      sms_samtykke: { givet: true, tidspunkt: "2026-02-01T10:00:00Z" },
    });
  });

  it("en konto uden profil viser tomme felter og intet samtykke — nøglerne findes, så det ses at der er spurgt", () => {
    const bare = composeSubjectAccessExport(emptyRaw(), META) as Record<string, any>;
    expect(bare.person).toMatchObject({
      navn: null,
      telefon: null,
      tidszone: null,
      sms_samtykke: { givet: false, tidspunkt: null },
    });
  });

  it("samler board, rådgivere, medlemskab, træk og møder ét sted", () => {
    const board = doc.ejer.boards[0];
    expect(board.navn).toBe("Testboard");
    expect(board.raadgivere).toEqual([{ navn: "Partner Et", er_lead: true }]);
    expect(board.medlemskab).toMatchObject({ frekvens_uger: 4, kortstatus: "registreret" });
    expect(board.betalingstraek).toHaveLength(1);
    expect(board.betalingstraek[0]).toMatchObject({ status: "fejlet", fejlaarsag: "declined" });
    expect(board.moeder[0].noter[0]).toEqual({
      forfatter: "Partner Et",
      tekst: "Notetekst",
      oprettet: "2026-03-02T00:00:00Z",
    });
  });

  it("sorterer dagsordenen efter rækkefølge", () => {
    const agenda = doc.ejer.boards[0].moeder[0].dagsorden;
    expect(agenda.map((a: { tekst: string }) => a.tekst)).toEqual(["Først", "Andet"]);
  });

  it("slår quizsvar op til spørgsmål og svar", () => {
    expect(doc.ejer.quizsvar).toEqual([
      { spoergsmaal: "Hvad vil du?", svar: "Vækst", fritekst: null, besvaret: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("tager afgivne vurderinger med, med partnerens navn", () => {
    expect(doc.ejer.vurderinger_afgivet).toEqual([
      { moede_id: "m1", om_partner: "Partner Et", score: 4, kommentar: "God", afgivet: "2026-03-03T00:00:00Z" },
    ]);
  });

  it("har intet partner-afsnit når personen ikke er partner", () => {
    expect(doc.partner).toBeNull();
  });

  it("siger højt at der ikke findes en samtykkelog, og hvad udtrækket ikke dækker", () => {
    expect(doc.samtykke.registreret).toBe(false);
    expect(doc.samtykke.note).toMatch(/cookie/);
    expect(doc.afgraensning.ikke_inkluderet).toEqual([...NOT_INCLUDED]);
    expect(NOT_INCLUDED.length).toBeGreaterThan(0);
  });
});

describe("composeSubjectAccessExport — partner", () => {
  const raw = emptyRaw({
    user: { id: "u2", email: "partner@example.invalid", created_at: "2026-01-01T00:00:00Z" },
    roles: [{ role: "partner" }],
    partnerProfile: { id: "p1", name: "Partner Et", title: "Rådgiver", is_internal: true },
    memberBoards: [{ id: "b9", name: "Andet board" }],
    boardPartners: [{ board_id: "b9", partner_id: "p1", is_lead: true }],
    competenceTags: [
      { id: "t1", label: "Salg" },
      { id: "t2", label: "Finans" },
    ],
    partnerTagLinks: [{ partner_profile_id: "p1", competence_tag_id: "t1" }],
    meetings: [
      {
        id: "m9",
        board_id: "b9",
        provider: "calcom",
        provider_booking_uid: null,
        starts_at: "2026-04-01T09:00:00Z",
        duration_minutes: 60,
        prep_minutes: 15,
        status: "afholdt",
        video_join_url: null,
        created_at: "2026-03-20T00:00:00Z",
      },
    ],
    meetingPartners: [
      { meeting_id: "m9", partner_profile_id: "p1", registered_status: null, registered_at: null },
      // En anden partners række må ikke ende i dette udtræk:
      { meeting_id: "m9", partner_profile_id: "p2", registered_status: "afholdt", registered_at: null },
    ],
    meetingNotes: [
      { id: "n1", meeting_id: "m9", partner_profile_id: "p1", body: "Min note", created_at: "2026-04-02T00:00:00Z" },
      { id: "n2", meeting_id: "m9", partner_profile_id: "p2", body: "Andens note", created_at: "2026-04-02T00:00:00Z" },
    ],
    prepNotes: [
      { id: "pn1", meeting_id: "m9", partner_profile_id: "p1", body: "Forb.", created_at: "2026-03-30T00:00:00Z", updated_at: "2026-03-31T00:00:00Z" },
    ],
  });
  const doc = composeSubjectAccessExport(raw, META) as Record<string, any>;

  it("viser profil og kun egne kompetence-tags", () => {
    expect(doc.partner.profil).toMatchObject({ id: "p1", navn: "Partner Et", titel: "Rådgiver" });
    expect(doc.partner.kompetence_tags).toEqual(["Salg"]);
  });

  it("viser kun egne mødedeltagelser og egne noter", () => {
    expect(doc.partner.moeder).toEqual([
      {
        moede_id: "m9",
        starter: "2026-04-01T09:00:00Z",
        moede_status: "afholdt",
        registreret_status: null,
        registreret: null,
      },
    ]);
    expect(doc.partner.moedenoter_skrevet.map((n: { tekst: string }) => n.tekst)).toEqual(["Min note"]);
    expect(doc.partner.forberedelsesnoter_skrevet).toHaveLength(1);
    expect(JSON.stringify(doc)).not.toContain("Andens note");
  });

  it("markerer lead-rollen på boardet", () => {
    expect(doc.partner.boards).toEqual([{ id: "b9", navn: "Andet board", er_lead: true }]);
  });

  it("har intet ejer-afsnit når personen ikke er ejer", () => {
    expect(doc.ejer).toBeNull();
  });
});

describe("composeSubjectAccessExport — revisionsspor, resuméer, udsendelser og links (B-65)", () => {
  const change = (over: Partial<RawSubjectData["boardChanges"][number]>) => ({
    id: "bc",
    board_id: "b1",
    actor_id: "u1",
    actor_role: "ejer",
    action: "tilfoej",
    partner_id: "p1",
    replaced_partner_id: null,
    calcom_sync: "opdateret",
    created_at: "2026-02-03T00:00:00Z",
    ...over,
  });
  const raw = emptyRaw({
    ...ownerRaw,
    partnerNames: [
      { id: "p1", name: "Partner Et" },
      { id: "p2", name: "Partner To" },
    ],
    boardChanges: [
      change({ id: "bc2", actor_id: "admin-9", actor_role: "admin", action: "udskift", replaced_partner_id: "p2", created_at: "2026-02-05T00:00:00Z" }),
      change({ id: "bc1" }),
    ],
    meetingSummaries: [
      { id: "s1", meeting_id: "m1", status: "klar", summary: "Resumé", action_items: ["Ring"], provider: "demo", model: "m", generated_at: "2026-03-02T00:00:00Z", created_at: "2026-03-02T00:00:00Z" },
    ],
    notificationDeliveries: [
      { id: "nd1", type_key: "moede-bekraeftet", channel: "email", related_id: "m1", status: "sendt", provider_ref: "DEMO-1", created_at: "2026-02-21T00:00:00Z" },
    ],
    ratingLinks: [
      { id: "rl1", meeting_id: "m1", rater_user_id: "u1", rater_partner_profile_id: null, expires_at: "2026-03-10T00:00:00Z", used_at: null, created_at: "2026-03-02T00:00:00Z" },
    ],
  });
  const doc = composeSubjectAccessExport(raw, META) as Record<string, any>;

  it("ejerens board bærer alle ændringer, ældste først — med rolle, men aldrig en andens aktør-id", () => {
    const changes = doc.ejer.boards[0].aendringer;
    expect(changes.map((c: { handling: string }) => c.handling)).toEqual(["tilfoej", "udskift"]);
    expect(changes[0]).toMatchObject({ udfoert_af_rolle: "ejer", udfoert_af_dig: true, partner: "Partner Et" });
    expect(changes[1]).toMatchObject({
      udfoert_af_rolle: "admin",
      udfoert_af_dig: false,
      partner: "Partner Et",
      udskiftet_partner: "Partner To",
      calcom_synkronisering: "opdateret",
    });
    expect(JSON.stringify(doc)).not.toContain("admin-9");
  });

  it("de ændringer personen selv har udført står under board_aendringer_udfoert", () => {
    expect(doc.board_aendringer_udfoert).toHaveLength(1);
    expect(doc.board_aendringer_udfoert[0]).toMatchObject({ board_id: "b1", handling: "tilfoej", udfoert_af_dig: true });
  });

  it("en bruger uden ejer-/partnerrolle (fx admin) får stadig sine udførte ændringer", () => {
    const adminDoc = composeSubjectAccessExport(
      emptyRaw({
        user: { id: "admin-9", email: "admin@example.invalid", created_at: "2026-01-01T00:00:00Z" },
        boardChanges: raw.boardChanges,
        partnerNames: raw.partnerNames,
      }),
      META,
    ) as Record<string, any>;
    expect(adminDoc.ejer).toBeNull();
    expect(adminDoc.board_aendringer_udfoert.map((c: { handling: string }) => c.handling)).toEqual(["udskift"]);
  });

  it("en partner ser ændringer der handler om vedkommende (tilføjet eller udskiftet), uden aktør-id", () => {
    const partnerDoc = composeSubjectAccessExport(
      emptyRaw({
        user: { id: "u2", email: "partner@example.invalid", created_at: "2026-01-01T00:00:00Z" },
        partnerProfile: { id: "p2", name: "Partner To" },
        boardChanges: raw.boardChanges,
        partnerNames: raw.partnerNames,
      }),
      META,
    ) as Record<string, any>;
    expect(partnerDoc.partner.board_aendringer_om_dig).toHaveLength(1);
    expect(partnerDoc.partner.board_aendringer_om_dig[0]).toMatchObject({ handling: "udskift", udfoert_af_rolle: "admin" });
    expect(JSON.stringify(partnerDoc)).not.toContain("admin-9");
  });

  it("AI-resuméet står på mødet, og et møde uden resumé er null", () => {
    expect(doc.ejer.boards[0].moeder[0].resume).toEqual({
      status: "klar",
      resume: "Resumé",
      handlingspunkter: ["Ring"],
      udbyder: "demo",
      model: "m",
      genereret: "2026-03-02T00:00:00Z",
    });
    const without = composeSubjectAccessExport({ ...raw, meetingSummaries: [] }, META) as Record<string, any>;
    expect(without.ejer.boards[0].moeder[0].resume).toBeNull();
  });

  it("udsendte beskeder og vurderingslinks er med — kun metadata, aldrig et token eller en tekst", () => {
    expect(doc.beskeder_sendt_til_dig).toEqual([
      { type: "moede-bekraeftet", kanal: "email", status: "sendt", relateret_id: "m1", udbyder_reference: "DEMO-1", oprettet: "2026-02-21T00:00:00Z" },
    ]);
    expect(doc.vurderingslinks).toEqual([
      { moede_id: "m1", som: "ejer", udloeber: "2026-03-10T00:00:00Z", brugt: null, oprettet: "2026-03-02T00:00:00Z" },
    ]);
  });

  it("afgrænsningen nævner det der stadig ikke er med: andre aktørers identitet, transskripter og beskedtekster", () => {
    const text = (doc.afgraensning.ikke_inkluderet as string[]).join("\n");
    expect(text).toMatch(/Andre aktørers identitet/);
    expect(text).toMatch(/Transskripter/);
    expect(text).toMatch(/Teksten i udsendte beskeder/);
    expect(text).not.toMatch(/AI-resuméer og transskripter — er endnu ikke gemt/);
  });

  it("en person uden noget af det giver tomme lister, ikke manglende nøgler", () => {
    const bare = composeSubjectAccessExport(emptyRaw(), META) as Record<string, any>;
    expect(bare.board_aendringer_udfoert).toEqual([]);
    expect(bare.beskeder_sendt_til_dig).toEqual([]);
    expect(bare.vurderingslinks).toEqual([]);
  });
});

describe("composeSubjectAccessExport — tom person", () => {
  it("er gyldigt: en bruger uden data giver tomme afsnit, ikke en fejl", () => {
    const doc = composeSubjectAccessExport(emptyRaw(), META) as Record<string, unknown>;
    expect(doc.ejer).toBeNull();
    expect(doc.partner).toBeNull();
    expect(doc.roller).toEqual([]);
  });

  it("ejer-rollen alene giver et (tomt) ejer-afsnit, så modtageren ser at der er spurgt", () => {
    const doc = composeSubjectAccessExport(emptyRaw({ roles: [{ role: "ejer" }] }), META) as Record<string, any>;
    expect(doc.ejer.boards).toEqual([]);
    expect(doc.ejer.quizsvar).toEqual([]);
  });
});

describe("normaliseEmail og exportFileName", () => {
  it("trimmer og sænker bogstaver", () => {
    expect(normaliseEmail("  Test@Example.INVALID ")).toBe("test@example.invalid");
  });

  it("afviser tomt, uden snabel-a og urimeligt langt", () => {
    expect(normaliseEmail("")).toBeNull();
    expect(normaliseEmail("ikke en mail")).toBeNull();
    expect(normaliseEmail("a@b")).toBeNull();
    expect(normaliseEmail(`${"a".repeat(250)}@x.dk`)).toBeNull();
  });

  it("navngiver filen efter dato — aldrig efter personen", () => {
    expect(exportFileName("2026-10-10T12:00:00.000Z")).toBe("indsigtsudtraek-2026-10-10.json");
  });
});
