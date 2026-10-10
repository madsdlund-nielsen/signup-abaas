import { describe, expect, it } from "vitest";
import { ProviderError } from "@/lib/errors";
import {
  BACKOFF_BASE_MS,
  MAX_ATTEMPTS,
  idempotencyKey,
  sendNotification,
} from "@/server/notifications/engine";
import { STALE_CLAIM_MS } from "@/server/notifications/store";
import { makeDeps } from "./support/notification-fakes";

/**
 * Notifikationsmotoren (fase 4.5, ADR 0057) mod in-memory-lager og scriptede afsendere.
 * Motorens regler testes her: ingen tekst uden live skabelon, render-problemer sender ikke,
 * idempotens, retry/backoff, endelige fejl, og at loggen aldrig bærer en adresse.
 */
const OWNER = "00000000-0000-0000-0000-00000000000a";
const MEETING = "00000000-0000-0000-0000-0000000f0001";
const ADDRESS = "modtager-test@example.invalid";

function input(overrides: Partial<Parameters<typeof sendNotification>[0]> = {}) {
  return {
    type: "meeting-changed",
    recipientUserId: OWNER,
    relatedId: MEETING,
    variables: {
      aendring: "aflyst",
      moede_tidspunkt: "[DEMO] tidspunkt",
      board_navn: "[DEMO] board",
      link: "https://demo.invalid/moeder/DEMO-1",
    },
    ...overrides,
  };
}

function setup() {
  const ctx = makeDeps();
  ctx.store.addresses.set(OWNER, { email: ADDRESS, sms: "+4500000000" });
  return ctx;
}

describe("sendNotification — ingen live skabelon, ingen tekst", () => {
  it("logger 'fejlet: ingen live skabelon' og sender ingenting", async () => {
    const { deps, store, email, captured } = setup();
    const [outcome] = await sendNotification(input(), deps);

    expect(outcome).toMatchObject({ channel: "email", status: "fejlet", reason: "ingen live skabelon" });
    expect(email.sent).toEqual([]);
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]).toMatchObject({
      status: "fejlet",
      attempt: 0,
      error: "ingen live skabelon",
      templateId: null,
    });
    // En konfigurationsmangel er ikke en driftsfejl — den støjer ikke i analytics.
    expect(captured).toEqual([]);
  });

  it("sender så snart en live skabelon findes — rækken der aldrig nåede ledningen tages op igen", async () => {
    const { deps, store, email } = setup();
    await sendNotification(input(), deps);
    const template = store.setLive("email", "[DEMO] {{board_navn}} er {{aendring}}");

    const [outcome] = await sendNotification(input(), deps);
    expect(outcome).toMatchObject({ status: "sendt" });
    expect(email.sent).toHaveLength(1);
    expect(store.deliveries).toHaveLength(1); // samme række, ikke en ny
    expect(store.deliveries[0]).toMatchObject({ status: "sendt", attempt: 1, templateId: template.id });
  });
});

describe("sendNotification — afsendelse", () => {
  it("renderer den live skabelon, slår adressen op og sender via porten", async () => {
    const { deps, store, email } = setup();
    const template = store.setLive("email", "[DEMO] {{board_navn}} er {{aendring}}\n\n{{link}}", "[DEMO] {{aendring}}");

    const [outcome] = await sendNotification(input(), deps);

    expect(outcome).toMatchObject({ channel: "email", status: "sendt" });
    expect(email.sent).toHaveLength(1);
    const message = email.sent[0]!;
    expect(message.to).toBe(ADDRESS);
    expect(message.subject).toBe("[DEMO] aflyst");
    expect(message.body).toBe("[DEMO] [DEMO] board er aflyst\n\nhttps://demo.invalid/moeder/DEMO-1");
    expect(message.html).toContain('<a href="https://demo.invalid/moeder/DEMO-1">');
    expect(message.idempotencyKey).toBe(
      idempotencyKey("meeting-changed", MEETING, OWNER, "email"),
    );
    expect(store.deliveries[0]).toMatchObject({
      status: "sendt",
      attempt: 1,
      providerRef: "RESEND-REF-1",
      templateId: template.id,
      error: null,
    });
  });

  it("loggen indeholder en bruger-reference — aldrig adressen", async () => {
    const { deps, store } = setup();
    store.setLive("email", "[DEMO] tekst");
    await sendNotification(input(), deps);
    expect(JSON.stringify(store.deliveries)).not.toContain(ADDRESS);
    expect(JSON.stringify(store.deliveries)).not.toContain("example.invalid");
  });

  it("sender på alle typens kanaler, og en kanal uden adresse fejler for sig selv", async () => {
    const { deps, store, email, sms } = setup();
    store.addresses.set(OWNER, { email: ADDRESS }); // intet telefonnummer
    store.setLive("email", "[DEMO] mail");
    store.setLive("sms", "[DEMO] sms");

    const outcomes = await sendNotification(input({ type: "meeting-reminder" }), deps);

    expect(outcomes.map((o) => [o.channel, o.status])).toEqual([
      ["email", "sendt"],
      ["sms", "fejlet"],
    ]);
    expect(email.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(0);
    expect(store.deliveries.find((d) => d.channel === "sms")?.error).toMatch(/ingen sms-adresse/);
  });

  it("channels begrænser til de ønskede kanaler", async () => {
    const { deps, store, sms } = setup();
    store.setLive("email", "[DEMO] mail");
    store.setLive("sms", "[DEMO] sms");
    const outcomes = await sendNotification(input({ type: "meeting-reminder", channels: ["sms"] }), deps);
    expect(outcomes.map((o) => o.channel)).toEqual(["sms"]);
    expect(sms.sent[0]?.message).toBe("[DEMO] sms");
  });

  it("afviser en ukendt beskedtype", async () => {
    const { deps } = setup();
    await expect(sendNotification(input({ type: "findes-ikke" }), deps)).rejects.toThrow(/Ukendt notifikationstype/);
  });

  it("statussen følger adapteren: stub og demo kaldes aldrig 'sendt'", async () => {
    const stub = makeDeps({ emailName: "stub" });
    stub.store.addresses.set(OWNER, { email: ADDRESS });
    stub.store.setLive("email", "[DEMO] tekst");
    expect((await sendNotification(input(), stub.deps))[0]).toMatchObject({ status: "stub" });

    const demo = makeDeps({ emailName: "demo" });
    demo.store.addresses.set(OWNER, { email: ADDRESS });
    demo.store.setLive("email", "[DEMO] tekst");
    expect((await sendNotification(input(), demo.deps))[0]).toMatchObject({ status: "demo" });
  });
});

describe("sendNotification — render-problemer sender aldrig", () => {
  it("en ukendt variabel i den live skabelon giver fejlet — intet halvt udfyldt", async () => {
    const { deps, store, email } = setup();
    store.setLive("email", "Kære {{ejer_navn}}");
    const [outcome] = await sendNotification(input(), deps);
    expect(outcome).toMatchObject({
      status: "fejlet",
      reason: expect.stringMatching(/«ejer_navn» findes ikke/),
    });
    expect(email.sent).toEqual([]);
  });

  it("en variabel uden værdi giver fejlet (fx når appens URL ikke er sat)", async () => {
    const { deps, store, email } = setup();
    store.setLive("email", "Se {{link}}");
    const [outcome] = await sendNotification(
      input({ variables: { aendring: "aflyst", board_navn: "x", moede_tidspunkt: "y", link: undefined } }),
      deps,
    );
    expect(outcome).toMatchObject({
      status: "fejlet",
      reason: expect.stringMatching(/«link» har ingen værdi/),
    });
    expect(email.sent).toEqual([]);
  });
});

describe("sendNotification — idempotens", () => {
  it("samme besked til samme modtager sendes aldrig to gange", async () => {
    const { deps, store, email } = setup();
    store.setLive("email", "[DEMO] tekst");
    await sendNotification(input(), deps);
    const [second] = await sendNotification(input(), deps);

    expect(second).toEqual({ channel: "email", status: "duplikat", existingStatus: "sendt" });
    expect(email.sent).toHaveLength(1);
    expect(store.deliveries).toHaveLength(1);
  });

  it("en diskriminator giver en ny lovlig udsendelse (fx en anden flytning af samme møde)", async () => {
    const { deps, store, email } = setup();
    store.setLive("email", "[DEMO] tekst");
    await sendNotification(input({ discriminator: "flyttet:t1" }), deps);
    await sendNotification(input({ discriminator: "flyttet:t2" }), deps);
    await sendNotification(input({ discriminator: "flyttet:t2" }), deps);
    expect(email.sent).toHaveLength(2);
  });

  it("to samtidige kald sender kun én gang (claim'en er låsen)", async () => {
    const { deps, store, email } = setup();
    store.setLive("email", "[DEMO] tekst");
    const results = await Promise.all([sendNotification(input(), deps), sendNotification(input(), deps)]);
    expect(email.sent).toHaveLength(1);
    expect(results.flat().map((o) => o.status).sort()).toEqual(["duplikat", "sendt"]);
  });

  it("en række der HAR nået ledningen overtages aldrig — heller ikke efter en fejl", async () => {
    const { deps, store, email } = setup();
    store.setLive("email", "[DEMO] tekst");
    email.outcomes.push(new ProviderError("Resend", "send", 400, "afvist", false));
    await sendNotification(input(), deps);
    const [second] = await sendNotification(input(), deps);
    expect(second).toMatchObject({ status: "duplikat", existingStatus: "fejlet" });
    expect(email.sent).toHaveLength(1);
  });

  it("et forladt claim uden forsøg overtages efter fristen — men ikke før", async () => {
    const { deps, store, email, clock } = setup();
    store.setLive("email", "[DEMO] tekst");
    // Et claim der aldrig blev ført til ende (kørslen døde).
    await store.claimDelivery({
      typeKey: "meeting-changed",
      channel: "email",
      recipientUserId: OWNER,
      relatedId: MEETING,
      idempotencyKey: idempotencyKey("meeting-changed", MEETING, OWNER, "email"),
      now: clock.now,
    });

    const [early] = await sendNotification(input(), deps);
    expect(early).toMatchObject({ status: "duplikat", existingStatus: "afventer" });

    clock.now = new Date(clock.now.getTime() + STALE_CLAIM_MS + 1000);
    const [late] = await sendNotification(input(), deps);
    expect(late).toMatchObject({ status: "sendt" });
    expect(email.sent).toHaveLength(1);
  });
});

describe("sendNotification — retry og fejlrapportering", () => {
  it("forbigående fejl prøves igen med fordoblet ventetid, og lykkes til sidst", async () => {
    const { deps, store, email, sleeps, captured } = setup();
    store.setLive("email", "[DEMO] tekst");
    email.outcomes.push(
      new ProviderError("Resend", "send", 503, "nede", true),
      new ProviderError("Resend", "send", null, "", true),
    );

    const [outcome] = await sendNotification(input(), deps);

    expect(outcome).toMatchObject({ status: "sendt" });
    expect(email.sent).toHaveLength(3);
    expect(sleeps).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS * 2]);
    expect(store.deliveries[0]).toMatchObject({ status: "sendt", attempt: 3 });
    expect(captured).toEqual([]); // en fejl der blev rettet undervejs rapporteres ikke
  });

  it(`opgiver efter ${MAX_ATTEMPTS} forsøg, logger fejlet og rapporterer til analytics`, async () => {
    const { deps, store, email, sleeps, captured } = setup();
    store.setLive("email", "[DEMO] tekst");
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      email.outcomes.push(new ProviderError("Resend", "send", 503, "nede", true));
    }

    const [outcome] = await sendNotification(input(), deps);

    expect(outcome).toMatchObject({ status: "fejlet" });
    expect(email.sent).toHaveLength(MAX_ATTEMPTS);
    expect(sleeps).toHaveLength(MAX_ATTEMPTS - 1); // ingen ventetid efter det sidste forsøg
    expect(store.deliveries[0]).toMatchObject({ status: "fejlet", attempt: MAX_ATTEMPTS });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.context).toEqual({
      source: "notifications",
      type: "meeting-changed",
      channel: "email",
      attempts: MAX_ATTEMPTS,
      deliveryId: store.deliveries[0]!.id,
    });
  });

  it("en endelig afvisning (4xx) prøves ikke igen", async () => {
    const { deps, store, email, sleeps } = setup();
    store.setLive("email", "[DEMO] tekst");
    email.outcomes.push(new ProviderError("Resend", "send", 422, "ugyldig adresse", false));

    const [outcome] = await sendNotification(input(), deps);

    expect(outcome).toMatchObject({ status: "fejlet" });
    expect(email.sent).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(store.deliveries[0]).toMatchObject({ status: "fejlet", attempt: 1 });
  });

  it("en ukendt fejl behandles som endelig (ikke blindt gentaget)", async () => {
    const { deps, store, email } = setup();
    store.setLive("email", "[DEMO] tekst");
    email.outcomes.push(new TypeError("programmeringsfejl"));
    await sendNotification(input(), deps);
    expect(email.sent).toHaveLength(1);
    expect(store.deliveries[0]?.status).toBe("fejlet");
  });

  it("fejltekster i log og analytics skrubbes for adresser", async () => {
    const { deps, store, email, captured } = setup();
    store.setLive("email", "[DEMO] tekst");
    email.outcomes.push(
      new ProviderError("Resend", "send", 422, `The 'to' address ${ADDRESS} is invalid (+45 12 34 56 78)`, false),
    );

    await sendNotification(input(), deps);

    const logged = store.deliveries[0]!.error ?? "";
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain("12 34 56");
    expect(logged).toContain("[fjernet]");
    expect(JSON.stringify(captured.map((c) => [String(c.error), c.context]))).not.toContain(ADDRESS);
  });

  it("analytics-porten der selv fejler vælter ikke udsendelsen", async () => {
    const { deps, store, email } = setup();
    deps.analytics.captureException = async () => {
      throw new Error("PostHog nede");
    };
    store.setLive("email", "[DEMO] tekst");
    email.outcomes.push(new ProviderError("Resend", "send", 422, "afvist", false));
    await expect(sendNotification(input(), deps)).resolves.toHaveLength(1);
  });
});
