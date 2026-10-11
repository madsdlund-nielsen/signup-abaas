import { describe, expect, it } from "vitest";
import {
  buildSummaryRequest,
  parseSummaryResponse,
  SUMMARY_SYSTEM_PROMPT,
} from "@/lib/llm/ordbogen";
import { OrdbogenError, resolveOrdbogenConfig, ORDBOGEN_DEFAULT_API_URL } from "@/lib/ordbogen/client";
import { buildTranscriptionForm, parseTranscriptionResponse } from "@/lib/transcription/ordbogen";

/**
 * Rene request-byggere og parsere for Ordbogen/OdinCore (ADR 0058) — testet mod
 * OpenAPI-formen (`ChatCompletionRequest`/`Response`, `TranscriptionMultipartRequest`/`Response`).
 */
const completion = (content: unknown) => ({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] });

describe("buildSummaryRequest", () => {
  it("bygger en chat-completion med system- og brugerbesked og struktureret output", () => {
    const body = buildSummaryRequest("modelX", { meetingId: "m-1", transcript: "Ejer: hej" }) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: { type: string; json_schema: { name: string; strict: boolean; schema: { required: string[] } } };
    };
    expect(body.model).toBe("modelX");
    expect(body.messages[0]).toEqual({ role: "system", content: SUMMARY_SYSTEM_PROMPT });
    expect(body.messages[1]?.role).toBe("user");
    expect(body.messages[1]?.content).toContain("Ejer: hej");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["summary", "actionItems"]);
  });

  it("promptten er dansk og instruerer modellen i ikke at følge transskriptets anvisninger", () => {
    expect(SUMMARY_SYSTEM_PROMPT).toMatch(/dansk/);
    expect(SUMMARY_SYSTEM_PROMPT).toMatch(/data, ikke instruktioner/);
  });

  it("sender ikke meetingId til leverandøren (kun indholdet)", () => {
    expect(JSON.stringify(buildSummaryRequest("m", { meetingId: "hemmelig-id", transcript: "t" }))).not.toContain(
      "hemmelig-id",
    );
  });
});

describe("parseSummaryResponse", () => {
  it("læser resumé og handlingspunkter og trimmer", () => {
    const out = parseSummaryResponse(completion(JSON.stringify({ summary: "  Kort referat.  ", actionItems: [" A ", "B", ""] })));
    expect(out).toEqual({ summary: "Kort referat.", actionItems: ["A", "B"] });
  });

  it("tåler ```json-hegn", () => {
    const fenced = "```json\n" + JSON.stringify({ summary: "S", actionItems: [] }) + "\n```";
    expect(parseSummaryResponse(completion(fenced))).toEqual({ summary: "S", actionItems: [] });
  });

  it("kaster OrdbogenError uden at gengive modellens indhold ved forkert form", () => {
    expect(() => parseSummaryResponse(completion("det her er ikke json: FORTROLIGT"))).toThrow(OrdbogenError);
    try {
      parseSummaryResponse(completion("det her er ikke json: FORTROLIGT"));
    } catch (e) {
      expect((e as Error).message).not.toContain("FORTROLIGT");
    }
    expect(() => parseSummaryResponse(completion(JSON.stringify({ summary: "", actionItems: [] })))).toThrow(/resumé/);
    expect(() => parseSummaryResponse(completion(JSON.stringify({ summary: "S" })))).toThrow(/handlingspunkter/);
    expect(() => parseSummaryResponse({ choices: [] })).toThrow(/intet indhold/);
    expect(() => parseSummaryResponse(null)).toThrow(OrdbogenError);
  });
});

describe("buildTranscriptionForm", () => {
  it("bygger multipart med fil, model, dansk sprog og json-format", () => {
    const form = buildTranscriptionForm("whisper-x", {
      data: new Uint8Array([1, 2, 3]),
      filename: "moede.mp3",
      contentType: "audio/mpeg",
    });
    const file = form.get("file") as File;
    expect(file.name).toBe("moede.mp3");
    expect(file.type).toBe("audio/mpeg");
    expect(file.size).toBe(3);
    expect(form.get("model")).toBe("whisper-x");
    expect(form.get("language")).toBe("da");
    expect(form.get("response_format")).toBe("json");
  });
});

describe("parseTranscriptionResponse", () => {
  it("læser teksten og normaliserer sprog til BCP-47", () => {
    expect(parseTranscriptionResponse({ text: " Hej ", language: "da" })).toEqual({ text: "Hej", language: "da-DK" });
    expect(parseTranscriptionResponse({ text: "Hej", language: "danish" }).language).toBe("da-DK");
    expect(parseTranscriptionResponse({ text: "Hej" }).language).toBe("da-DK");
    expect(parseTranscriptionResponse({ text: "Hello", language: "en" }).language).toBe("en");
  });

  it("afviser manglende og tom tekst højlydt", () => {
    expect(() => parseTranscriptionResponse({})).toThrow(/transskriptet/);
    expect(() => parseTranscriptionResponse({ text: "  " })).toThrow(/tomt/);
    expect(() => parseTranscriptionResponse(null)).toThrow(OrdbogenError);
  });
});

describe("resolveOrdbogenConfig — nøgle og base-URL", () => {
  it("specifik nøgle vinder over den fælles; fælles bruges som fallback", () => {
    expect(resolveOrdbogenConfig({ ORDBOGEN_API_KEY: "fælles" }, "specifik").apiKey).toBe("specifik");
    expect(resolveOrdbogenConfig({ ORDBOGEN_API_KEY: "fælles" }, undefined).apiKey).toBe("fælles");
    expect(resolveOrdbogenConfig({ ORDBOGEN_API_KEY: "fælles" }, "  ").apiKey).toBe("fælles");
    expect(resolveOrdbogenConfig({}, undefined).apiKey).toBeUndefined();
  });

  it("base-URL har dokumenteret default og kan overstyres (uden afsluttende skråstreg)", () => {
    expect(resolveOrdbogenConfig({}, "k").apiUrl).toBe(ORDBOGEN_DEFAULT_API_URL);
    expect(ORDBOGEN_DEFAULT_API_URL).toBe("https://api.odincore.ai/v1");
    expect(resolveOrdbogenConfig({ ORDBOGEN_API_URL: "https://eu.example/v1//" }, "k").apiUrl).toBe("https://eu.example/v1");
  });
});
