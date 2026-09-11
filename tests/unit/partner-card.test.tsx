import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { PartnerCard, type PartnerCardPartner } from "@/components/PartnerCard";

/**
 * Profilkortet i board-anbefalingen (fase 1.6). Token-reglen fra tests/CLAUDE.md har én
 * dokumenteret undtagelse her: `photoUrl` er datadrevet indhold og sættes som inline
 * background-image, samme præcedens som `Card`. Testene vogter derfor at det er den
 * ENESTE inline-style — og at lead-markeringen bliver bag sit flag, da tildelingsreglerne
 * er uafklarede.
 */
const partner: PartnerCardPartner = {
  id: "p1",
  name: "Mette Hansen",
  title: "CFO",
  photoUrl: null,
  shortBio: "20 år i vækstvirksomheder.",
  competenceTagIds: ["t1", "t2"],
};

const tagLabels = new Map([
  ["t1", "Økonomistyring"],
  ["t2", "Exit"],
]);

describe("PartnerCard", () => {
  it("renderer navn, titel og bio i token-klasser", () => {
    const { getByRole, container } = render(
      <PartnerCard partner={partner} tagLabels={tagLabels} wantedTagIds={[]} />,
    );
    expect(getByRole("heading", { level: 3, name: "Mette Hansen" }).className).toBe(
      "heading-3 heading--on-light",
    );
    expect(container.querySelector("article")?.className).toBe("partner-card");
    expect(container.querySelector("article")?.getAttribute("style")).toBeNull();
  });

  it("sætter kun inline-style på media-feltet, og kun når der er et foto", () => {
    const uden = render(
      <PartnerCard partner={partner} tagLabels={tagLabels} wantedTagIds={[]} />,
    );
    expect(uden.container.querySelector(".partner-card__media")?.getAttribute("style")).toBeNull();

    const med = render(
      <PartnerCard
        partner={{ ...partner, photoUrl: "https://example.test/m.jpg" }}
        tagLabels={tagLabels}
        wantedTagIds={[]}
      />,
    );
    const media = med.container.querySelector(".partner-card__media");
    expect(media?.getAttribute("style")).toContain("https://example.test/m.jpg");
  });

  it("fremhæver kun de tags ejeren har ønsket", () => {
    const { container } = render(
      <PartnerCard partner={partner} tagLabels={tagLabels} wantedTagIds={["t2"]} />,
    );
    const tags = [...container.querySelectorAll(".partner-tag")];
    expect(tags.map((li) => li.textContent)).toEqual(["Økonomistyring", "Exit"]);
    expect(tags[0]?.className).toBe("partner-tag");
    expect(tags[1]?.className).toBe("partner-tag partner-tag--match");
  });

  it("falder tilbage til en synlig tekst når et tag-id mangler en label", () => {
    const { container } = render(
      <PartnerCard partner={partner} tagLabels={new Map()} wantedTagIds={[]} />,
    );
    const tags = [...container.querySelectorAll(".partner-tag")];
    expect(tags.map((li) => li.textContent)).toEqual([
      "Ukendt kompetence",
      "Ukendt kompetence",
    ]);
  });

  it("udelader tag-listen, titel og bio når de er tomme", () => {
    const { container } = render(
      <PartnerCard
        partner={{ ...partner, title: null, shortBio: null, competenceTagIds: [] }}
        tagLabels={tagLabels}
        wantedTagIds={[]}
      />,
    );
    expect(container.querySelector(".partner-card__tags")).toBeNull();
    expect(container.querySelector("p.body")).toBeNull();
  });

  it("viser først lead-markeringen når flaget er slået til", () => {
    const skjult = render(
      <PartnerCard partner={partner} tagLabels={tagLabels} wantedTagIds={[]} isLead />,
    );
    expect(skjult.container.querySelector(".partner-card__lead")).toBeNull();

    const vist = render(
      <PartnerCard partner={partner} tagLabels={tagLabels} wantedTagIds={[]} isLead showLead />,
    );
    expect(vist.container.querySelector(".partner-card__lead")?.textContent).toBe("Lead-partner");
  });

  it("renderer fodsloten kun når der er children", () => {
    const uden = render(
      <PartnerCard partner={partner} tagLabels={tagLabels} wantedTagIds={[]} />,
    );
    expect(uden.container.querySelector(".partner-card__footer")).toBeNull();

    const med = render(
      <PartnerCard partner={partner} tagLabels={tagLabels} wantedTagIds={[]}>
        <button>Udskift</button>
      </PartnerCard>,
    );
    expect(med.container.querySelector(".partner-card__footer")).not.toBeNull();
  });
});
