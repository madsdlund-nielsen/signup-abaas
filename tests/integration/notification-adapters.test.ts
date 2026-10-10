import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/lib/errors";
import { createEmailSender } from "@/lib/email";
import { buildResendBody, RESEND_ENDPOINT } from "@/lib/email/resend";
import { createSmsSender } from "@/lib/sms";
import {
  buildInMobileBody,
  INMOBILE_ENDPOINT,
  inMobileAuthHeader,
  toInMobileNumber,
} from "@/lib/sms/inmobile";

/**
 * Resend- og inMobile-adaptere (fase 4.5, ADR 0057) mod en MOCKET fetch — intet net, ingen
 * konti. Det her låser adapternes kontrakt (hvad der sendes, hvordan fejl klassificeres), ikke
 * leverandørernes faktiske opførsel: Resend-formen er dokumenteret, inMobile-formen er bygget
 * efter bedste forståelse og skal verificeres live (TODO(mads), se inmobile.ts).
 */
const emailEnv = {
  FLAG_EMAIL: "true",
  RESEND_API_KEY: "test-nøgle",
  RESEND_FROM_ADDRESS: "ABaaS <noreply@example.invalid>",
};
const smsEnv = { FLAG_SMS: "true", INMOBILE_API_KEY: "test-nøgle", INMOBILE_SENDER: "ABaaS" };

function mockFetch(response: Response | Error) {
  const fn = vi.fn(async (..._args: Parameters<typeof fetch>) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Resend-adapteren", () => {
  it("vælges kun med både flag og nøgler", () => {
    expect(createEmailSender(emailEnv).name).toBe("resend");
    expect(createEmailSender({ ...emailEnv, FLAG_EMAIL: undefined }).name).toBe("stub");
    expect(createEmailSender({ ...emailEnv, RESEND_FROM_ADDRESS: undefined }).name).toBe("stub");
  });

  it("POST'er {from,to,subject,text,html} til /emails med Bearer-nøgle og idempotensnøgle", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "re_123" }));
    const receipt = await createEmailSender(emailEnv).send({
      to: "modtager@example.invalid",
      subject: "[DEMO] Emne",
      body: "[DEMO] tekst",
      html: "<p>[DEMO] tekst</p>",
      idempotencyKey: "meeting-changed:m1:u1:email:aflyst:t1",
    });

    expect(receipt).toEqual({ reference: "re_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(RESEND_ENDPOINT);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-nøgle");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe("meeting-changed:m1:u1:email:aflyst:t1");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "ABaaS <noreply@example.invalid>",
      to: ["modtager@example.invalid"],
      subject: "[DEMO] Emne",
      text: "[DEMO] tekst",
      html: "<p>[DEMO] tekst</p>",
    });
  });

  it("udelader html og idempotensnøgle når de ikke er givet", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "re_1" }));
    await createEmailSender(emailEnv).send({ to: "a@example.invalid", subject: "s", body: "b" });
    const init = fetchMock.mock.calls[0]![1];
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("html");
    expect(init?.headers as Record<string, string>).not.toHaveProperty("Idempotency-Key");
  });

  it("kvitterer uden reference hvis svaret ikke har et id (aldrig en fejl af et uventet svar)", async () => {
    mockFetch(jsonResponse({}));
    const receipt = await createEmailSender(emailEnv).send({ to: "a@example.invalid", subject: "s", body: "b" });
    expect(receipt.reference).toBeNull();
  });

  it.each([429, 500, 503])("HTTP %i er en forbigående (retryable) fejl", async (status) => {
    mockFetch(new Response("midlertidigt", { status }));
    const error = await createEmailSender(emailEnv)
      .send({ to: "a@example.invalid", subject: "s", body: "b" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ vendor: "Resend", status, retryable: true });
  });

  it.each([400, 401, 403, 422])("HTTP %i er en endelig fejl — at prøve igen ændrer intet", async (status) => {
    mockFetch(new Response("afvist", { status }));
    const error = await createEmailSender(emailEnv)
      .send({ to: "a@example.invalid", subject: "s", body: "b" })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status, retryable: false });
  });

  it("en netværksfejl er forbigående og afslører ikke modtageren", async () => {
    mockFetch(new TypeError("fetch failed for modtager@example.invalid"));
    const error = (await createEmailSender(emailEnv)
      .send({ to: "modtager@example.invalid", subject: "s", body: "b" })
      .catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(true);
    expect(error.status).toBeNull();
    expect(error.message).not.toContain("modtager@example.invalid");
  });

  it("buildResendBody er ren", () => {
    expect(buildResendBody({ fromAddress: "x@example.invalid" }, { to: "y@example.invalid", subject: "s", body: "b" }))
      .toEqual({ from: "x@example.invalid", to: ["y@example.invalid"], subject: "s", text: "b" });
  });
});

describe("inMobile-adapteren", () => {
  it("vælges kun med både flag og nøgler", () => {
    expect(createSmsSender(smsEnv).name).toBe("inmobile");
    expect(createSmsSender({ ...smsEnv, FLAG_SMS: undefined }).name).toBe("stub");
    expect(createSmsSender({ ...smsEnv, INMOBILE_SENDER: undefined }).name).toBe("stub");
  });

  it("POST'er {messages:[{to,text,from,messageId}]} med Basic-auth (nøglen som adgangskode)", async () => {
    const fetchMock = mockFetch(jsonResponse({ results: [{ messageId: "im_1" }] }));
    const receipt = await createSmsSender(smsEnv).send({
      to: "+4500000000",
      message: "[DEMO] sms",
      idempotencyKey: "meeting-reminder:m1:u1:sms:starter:t1",
    });

    expect(receipt).toEqual({ reference: "im_1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(INMOBILE_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(inMobileAuthHeader("test-nøgle"));
    expect(Buffer.from(inMobileAuthHeader("test-nøgle").replace("Basic ", ""), "base64").toString()).toBe(
      ":test-nøgle",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [
        {
          to: "4500000000",
          text: "[DEMO] sms",
          from: "ABaaS",
          messageId: "meeting-reminder:m1:u1:sms:starter:t1",
        },
      ],
    });
  });

  it("falder tilbage til vores egen reference når svaret ikke har et besked-id", async () => {
    mockFetch(jsonResponse({}));
    const receipt = await createSmsSender(smsEnv).send({ to: "+4500000000", message: "m", idempotencyKey: "nøgle" });
    expect(receipt.reference).toBe("nøgle");
  });

  it("klassificerer fejl som Resend: 5xx/429/netværk forbigående, 4xx endelig", async () => {
    mockFetch(new Response("nede", { status: 503 }));
    expect(
      await createSmsSender(smsEnv).send({ to: "+4500000000", message: "m" }).catch((e: unknown) => e),
    ).toMatchObject({ vendor: "inMobile", retryable: true });

    mockFetch(new Response("ugyldigt nummer", { status: 400 }));
    expect(
      await createSmsSender(smsEnv).send({ to: "+4500000000", message: "m" }).catch((e: unknown) => e),
    ).toMatchObject({ status: 400, retryable: false });

    mockFetch(new TypeError("fetch failed"));
    expect(
      await createSmsSender(smsEnv).send({ to: "+4500000000", message: "m" }).catch((e: unknown) => e),
    ).toMatchObject({ status: null, retryable: true });
  });

  it("toInMobileNumber fjerner + og 00", () => {
    expect(toInMobileNumber("+4500000000")).toBe("4500000000");
    expect(toInMobileNumber("004500000000")).toBe("4500000000");
  });

  it("buildInMobileBody kapper messageId til 50 tegn", () => {
    const body = buildInMobileBody({ sender: "ABaaS" }, { to: "+4500000000", message: "m", idempotencyKey: "x".repeat(80) });
    expect(body.messages[0]?.messageId).toHaveLength(50);
  });
});
