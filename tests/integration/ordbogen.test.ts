import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmProvider } from "@/lib/llm";
import { RecordingConsentMissingError, MissingRecordingError } from "@/lib/errors";
import { OrdbogenError } from "@/lib/ordbogen/client";
import { createTranscriptionProvider } from "@/lib/transcription";
import { getMeetingSummary } from "@/server/summaries";

/**
 * Ordbogen/OdinCore-adapterne (ADR 0024 + 0058) mod en mocket `fetch` — ingen netværk.
 * Dækker adapter-valg (nøgle + flag, demo, stub), request-mapping, fejl, timeout og —
 * vigtigst — at samtykke til optagelse fejler LUKKET uden at lyden forlader os.
 */
const KEY = "test-nøgle";
const llmEnv = { FLAG_AIFOLLOWUP: "true", ORDBOGEN_API_KEY: KEY };
const trEnv = { FLAG_TRANSCRIPTION: "true", ORDBOGEN_API_KEY: KEY };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const completion = (content: string) => ({ choices: [{ message: { role: "assistant", content } }] });

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => impl(String(url), init ?? {}));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("adapter-valg", () => {
  it("flag + fælles nøgle vælger Ordbogen-adapterne", () => {
    expect(createLlmProvider(llmEnv).name).toBe("ordbogen");
    expect(createTranscriptionProvider(trEnv).name).toBe("ordbogen");
  });

  it("de specifikke nøgler virker alene", () => {
    expect(createLlmProvider({ FLAG_AIFOLLOWUP: "true", LLM_API_KEY: "k" }).name).toBe("ordbogen");
    expect(createTranscriptionProvider({ FLAG_TRANSCRIPTION: "true", TRANSCRIPTION_API_KEY: "k" }).name).toBe("ordbogen");
  });

  it("uden flag: stub (selv med nøgle); uden nøgle: stub", () => {
    expect(createLlmProvider({ ORDBOGEN_API_KEY: KEY }).name).toBe("stub");
    expect(createTranscriptionProvider({ ORDBOGEN_API_KEY: KEY }).name).toBe("stub");
    expect(createLlmProvider({ FLAG_AIFOLLOWUP: "true" }).name).toBe("stub");
    expect(createTranscriptionProvider({ FLAG_TRANSCRIPTION: "true" }).name).toBe("stub");
  });

  it("demo vælges kun når nøglen mangler — rigtig nøgle vinder altid (ADR 0041)", () => {
    expect(createLlmProvider({ FLAG_DEMO: "true" }).name).toBe("demo");
    expect(createTranscriptionProvider({ FLAG_DEMO: "true" }).name).toBe("demo");
    expect(createLlmProvider({ ...llmEnv, FLAG_DEMO: "true" }).name).toBe("ordbogen");
    expect(createTranscriptionProvider({ ...trEnv, FLAG_DEMO: "true" }).name).toBe("ordbogen");
  });
});

describe("OrdbogenLlmProvider", () => {
  it("kalder chat/completions med Bearer-nøgle og mapper svaret", async () => {
    const fetchMock = mockFetch(() =>
      json(completion(JSON.stringify({ summary: "Referat.", actionItems: ["Ring til revisor"] }))),
    );
    const result = await createLlmProvider(llmEnv).summarizeMeeting({ meetingId: "m-1", transcript: "Ejer: hej" });
    expect(result).toEqual({ summary: "Referat.", actionItems: ["Ring til revisor"] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.odincore.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("odin-2");
    expect(body.messages[1].content).toContain("Ejer: hej");
  });

  it("respekterer ORDBOGEN_API_URL og ORDBOGEN_LLM_MODEL", async () => {
    const fetchMock = mockFetch(() => json(completion(JSON.stringify({ summary: "S", actionItems: [] }))));
    await createLlmProvider({
      ...llmEnv,
      ORDBOGEN_API_URL: "https://eu.example.test/v1/",
      ORDBOGEN_LLM_MODEL: "odin-x",
    }).summarizeMeeting({ meetingId: "m", transcript: "t" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu.example.test/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("odin-x");
  });

  it("tomt transskript kalder ikke leverandøren", async () => {
    const fetchMock = mockFetch(() => json({}));
    await expect(createLlmProvider(llmEnv).summarizeMeeting({ meetingId: "m", transcript: "  " })).rejects.toThrow(
      /tomt/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, /ugyldig eller mangler/],
    [403, /ikke adgang/],
    [429, /Rate limit eller budget/],
    [400, /afviste/],
    [500, /intern fejl/],
  ])("HTTP %i giver en tydelig dansk fejl", async (status, pattern) => {
    mockFetch(() => json({ error: { type: "invalid_request", code: "bad", message: "Noget gik galt", param: null } }, status));
    const err = await createLlmProvider(llmEnv)
      .summarizeMeeting({ meetingId: "m", transcript: "HEMMELIGT TRANSSKRIPT" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrdbogenError);
    expect((err as OrdbogenError).status).toBe(status);
    expect((err as Error).message).toMatch(pattern);
    expect((err as Error).message).toContain("Noget gik galt");
    expect((err as Error).message).not.toContain("HEMMELIGT");
    expect((err as Error).message).not.toContain(KEY);
  });

  it("timeout giver en tydelig fejl", async () => {
    mockFetch(() => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    await expect(createLlmProvider(llmEnv).summarizeMeeting({ meetingId: "m", transcript: "t" })).rejects.toThrow(
      /tidsfristen på 120 sekunder/,
    );
  });

  it("netværksfejl giver en tydelig fejl uden at lække detaljer", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed: ECONNRESET 10.0.0.1");
    });
    const err = await createLlmProvider(llmEnv)
      .summarizeMeeting({ meetingId: "m", transcript: "t" })
      .catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/netværksfejl/);
    expect((err as Error).message).not.toContain("10.0.0.1");
  });

  it("ugyldigt svar (ikke JSON) giver en tydelig fejl", async () => {
    mockFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    await expect(createLlmProvider(llmEnv).summarizeMeeting({ meetingId: "m", transcript: "t" })).rejects.toThrow(
      /ikke gyldig JSON/,
    );
  });

  it("nægter at sende nøglen over http (undtagen localhost)", async () => {
    const fetchMock = mockFetch(() => json(completion(JSON.stringify({ summary: "S", actionItems: [] }))));
    await expect(
      createLlmProvider({ ...llmEnv, ORDBOGEN_API_URL: "http://api.example.test/v1" }).summarizeMeeting({
        meetingId: "m",
        transcript: "t",
      }),
    ).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
    await createLlmProvider({ ...llmEnv, ORDBOGEN_API_URL: "http://localhost:8080/v1" }).summarizeMeeting({
      meetingId: "m",
      transcript: "t",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OrdbogenTranscriptionProvider", () => {
  const audio = { data: new Uint8Array([1, 2, 3, 4]), filename: "moede.webm", contentType: "audio/webm" };
  const consent = { meetingId: "m-1", registeredAt: "2026-10-10T08:00:00Z" };

  it("sender multipart til audio/transcriptions og mapper svaret", async () => {
    const fetchMock = mockFetch(() => json({ text: "Ejer: Tak fordi I kunne.", language: "da", duration: 12 }));
    const out = await createTranscriptionProvider(trEnv).transcribe({
      meetingId: "m-1",
      audioRef: "ref",
      consent,
      audio,
    });
    expect(out).toEqual({ text: "Ejer: Tak fordi I kunne.", language: "da-DK" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.odincore.ai/v1/audio/transcriptions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    // Content-Type udelades, så fetch selv sætter multipart-grænsen.
    expect(headers).not.toHaveProperty("Content-Type");
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("da");
    expect((form.get("file") as File).name).toBe("moede.webm");
  });

  it("🔴 uden registreret samtykke: fejler lukket og lyden forlader aldrig os", async () => {
    const fetchMock = mockFetch(() => json({ text: "x" }));
    const provider = createTranscriptionProvider(trEnv);
    await expect(provider.transcribe({ meetingId: "m-1", audioRef: "r", audio })).rejects.toBeInstanceOf(
      RecordingConsentMissingError,
    );
    await expect(provider.transcribe({ meetingId: "m-1", audioRef: "r", audio })).rejects.toThrow(
      /Samtykke til mødeoptagelse er ikke registreret/,
    );
    // Samtykke for et ANDET møde er ikke samtykke til dette.
    await expect(
      provider.transcribe({ meetingId: "m-1", audioRef: "r", audio, consent: { ...consent, meetingId: "m-2" } }),
    ).rejects.toBeInstanceOf(RecordingConsentMissingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("med samtykke men uden lyd: tydelig fejl, intet kald", async () => {
    const fetchMock = mockFetch(() => json({ text: "x" }));
    const provider = createTranscriptionProvider(trEnv);
    await expect(provider.transcribe({ meetingId: "m-1", audioRef: "r", consent })).rejects.toBeInstanceOf(
      MissingRecordingError,
    );
    await expect(
      provider.transcribe({ meetingId: "m-1", audioRef: "r", consent, audio: { ...audio, data: new Uint8Array() } }),
    ).rejects.toBeInstanceOf(MissingRecordingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("timeout og HTTP-fejl er tydelige", async () => {
    const provider = createTranscriptionProvider(trEnv);
    mockFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(provider.transcribe({ meetingId: "m-1", audioRef: "r", consent, audio })).rejects.toThrow(
      /tidsfristen på 600 sekunder/,
    );
    mockFetch(() => json({ error: { type: "rate_limit", code: null, message: "for mange", param: null } }, 429));
    await expect(provider.transcribe({ meetingId: "m-1", audioRef: "r", consent, audio })).rejects.toThrow(/Rate limit/);
  });

  it("tomt transskript fra leverandøren er en fejl, ikke et tomt resultat", async () => {
    mockFetch(() => json({ text: "" }));
    await expect(
      createTranscriptionProvider(trEnv).transcribe({ meetingId: "m-1", audioRef: "r", consent, audio }),
    ).rejects.toThrow(/tomt/);
  });
});

describe("getMeetingSummary med rigtige Ordbogen-adaptere", () => {
  it("🔴 uden samtykke-mekanisme: AI-opfølgning er utilgængelig med samtykke-årsag, og intet sendes", async () => {
    const fetchMock = mockFetch(() => json({}));
    const state = await getMeetingSummary("m-1", { ...llmEnv, ...trEnv });
    expect(state.kind).toBe("unavailable");
    if (state.kind !== "unavailable") return;
    expect(state.reason).toMatch(/Samtykke til mødeoptagelse er ikke registreret/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("demo-tilstand er uændret: [DEMO]-opsummering uden samtykke (der er ingen optagelse)", async () => {
    const fetchMock = mockFetch(() => json({}));
    const state = await getMeetingSummary("m-1", { FLAG_DEMO: "true" });
    expect(state.kind).toBe("ready");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
