import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { LinkLookup } from "@/server/ratings/link-service";

/**
 * Siden /vurdering/[token] (B-21, ADR 0060): hvad modtageren ser i hver tilstand. Opslaget
 * mockes — selve token-logikken er testet i rating-link.test.ts og integrationstestene; her
 * vogtes (a) at kun et gyldigt link viser formularen, (b) at "ugyldigt" ikke røber noget, og
 * (c) at siden følger designreglerne (token-klasser, ingen inline-styles).
 */
const state = vi.hoisted(() => ({
  lookup: { status: "ugyldigt" } as LinkLookup,
  fail: false,
  deps: {} as object | null,
}));

vi.mock("@/server/ratings/link-service", () => ({
  LINK_COMMENT_MAX: 2000,
  createRatingLinkDeps: () => state.deps,
  lookupRatingLink: async () => {
    if (state.fail) throw new Error("basen er nede: anna@firma.dk");
    return state.lookup;
  },
}));
vi.mock("@/server/ratings/link-actions", () => ({
  redeemRatingLink: async () => ({}),
}));

const { default: RatingLinkPage, metadata } = await import("@/app/vurdering/[token]/page");

const TOKEN = `${"a".repeat(32)}.${"b".repeat(64)}`;

async function renderPage() {
  const element = await RatingLinkPage({ params: Promise.resolve({ token: TOKEN }) });
  return render(element);
}

describe("/vurdering/[token]", () => {
  it("et gyldigt link viser mødets tidspunkt, boardnavn og en vurderingsformular med skjult token", async () => {
    state.fail = false;
    state.deps = {};
    state.lookup = {
      status: "gyldig",
      id: "x",
      meeting: { startsAt: "2026-10-13T08:00:00Z", boardName: "[DEMO] Testboard" },
    };
    const { container, getByRole, getByLabelText } = await renderPage();

    expect(getByRole("heading", { level: 1 }).textContent).toBe("Hvordan var mødet?");
    expect(container.querySelector(".lead")?.textContent).toContain("[DEMO] Testboard");
    expect(container.querySelector(".lead")?.textContent).toContain("kl. 10.00"); // dansk tid
    expect((container.querySelector('input[name="token"]') as HTMLInputElement).value).toBe(TOKEN);

    const select = getByLabelText("Mødet samlet set") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "1", "2", "3", "4", "5"]);
    expect(select.required).toBe(true);
    expect((getByLabelText("Kommentar (valgfri)") as HTMLTextAreaElement).maxLength).toBe(2000);
    expect(getByRole("button", { name: "Send vurdering" })).not.toBeNull();
  });

  it("brugt: takker og viser ingen formular", async () => {
    state.fail = false;
    state.lookup = { status: "brugt" };
    const { container, getByRole } = await renderPage();
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Tak for din vurdering");
    expect(container.querySelector("form")).toBeNull();
  });

  it("udløbet: henviser til login og viser ingen formular", async () => {
    state.lookup = { status: "udloebet" };
    const { container, getByRole } = await renderPage();
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Linket er udløbet");
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it("ugyldigt (forfalsket, ukendt, slået fra): samme rolige besked, intet om hvorfor", async () => {
    state.lookup = { status: "ugyldigt" };
    const first = await renderPage();
    const html = first.container.innerHTML;
    expect(first.getByRole("heading", { level: 1 }).textContent).toBe("Linket kan ikke bruges");
    expect(first.container.querySelector("form")).toBeNull();
    first.unmount();

    // Uden Supabase-konfiguration (deps = null) er svaret identisk — funktionen er slået fra.
    state.deps = null;
    const second = await renderPage();
    expect(second.container.innerHTML).toBe(html);
  });

  it("en utilgængelig base giver en generisk besked uden fejltekst eller persondata", async () => {
    state.deps = {};
    state.fail = true;
    const { container } = await renderPage();
    expect(container.textContent).toContain("kan ikke åbnes lige nu");
    expect(container.textContent).not.toContain("firma.dk");
    expect(container.querySelector("form")).toBeNull();
  });

  it("følger designreglerne: token-klasser, ingen inline-styles", async () => {
    state.fail = false;
    state.deps = {};
    state.lookup = { status: "gyldig", id: "x", meeting: { startsAt: "2026-10-13T08:00:00Z", boardName: "x" } };
    const { container } = await renderPage();
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.querySelector("section.pagehead")).not.toBeNull();
    expect(container.querySelector("main.pagebody")).not.toBeNull();
  });

  it("er ikke indekserbar og sender ingen referrer (tokenet ligger i URL'en)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});
