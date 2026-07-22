import { describe, expect, it } from "vitest";
import { slugify } from "@/server/tags/slug";

describe("slugify", () => {
  it("translittererer danske tegn (æ/ø/å)", () => {
    expect(slugify("Økonomi og nøgletal")).toBe("oekonomi-og-noegletal");
    expect(slugify("Håndværk på ærø")).toBe("haandvaerk-paa-aeroe");
  });

  it("erstatter komma/skråstreg/mellemrum med bindestreg og trimmer kanterne", () => {
    expect(slugify("Skalering, funding og exit")).toBe("skalering-funding-og-exit");
    expect(slugify("Udland/nye markeder")).toBe("udland-nye-markeder");
    expect(slugify("  Tech, automatisering og AI  ")).toBe("tech-automatisering-og-ai");
  });
});
