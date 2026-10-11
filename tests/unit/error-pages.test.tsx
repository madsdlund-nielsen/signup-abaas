import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import NotFound from "@/app/not-found";
import GlobalError from "@/app/global-error";
import RouteError from "@/app/error";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * Fejlsiderne (fase 6.2, ADR 0070). Token-klasser og ingen inline-styles som alle andre
 * komponenter — og to ting der er specifikke for fejl: ingen stacktrace/fejlbesked i UI'et,
 * og altid en vej videre (hjem, og "Prøv igen" hvor et nyt forsøg giver mening).
 */
function expectTokenOnly(container: Element) {
  expect(container.querySelectorAll("[style]")).toHaveLength(0);
}

describe("ErrorPage", () => {
  it("bygger på det eksisterende charcoal hero-bånd, med eyebrow, tynd h1 og lead", () => {
    const { container } = render(
      <ErrorPage eyebrow="404" title="Titel" actions={<a href="/test">Hjem</a>}>
        Brødtekst
      </ErrorPage>,
    );
    expect(container.querySelector("main#main")).not.toBeNull();
    expect(container.querySelector("section")?.className).toBe("band band--charcoal band--hero");
    expect(container.querySelector("p.eyebrow")?.textContent).toBe("404");
    expect(container.querySelector("h1")?.className).toBe("heading-1 heading--on-dark measure-wide");
    expect(container.querySelector("p.lead")?.textContent).toBe("Brødtekst");
    expectTokenOnly(container);
  });

  it("viser fejlreferencen kun når den findes", () => {
    const { container, rerender } = render(
      <ErrorPage eyebrow="x" title="y" actions={null}>
        z
      </ErrorPage>,
    );
    expect(container.textContent).not.toMatch(/Fejlreference/);
    rerender(
      <ErrorPage eyebrow="x" title="y" reference="abc123" actions={null}>
        z
      </ErrorPage>,
    );
    expect(container.textContent).toMatch(/Fejlreference: abc123/);
  });
});

describe("not-found", () => {
  it("er roligt, på dansk, og linker hjem", () => {
    const { container, getByRole } = render(<NotFound />);
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Siden findes ikke.");
    expect(getByRole("link", { name: "Til forsiden" }).getAttribute("href")).toBe("/");
    expect(container.textContent).not.toMatch(/stack|undefined|Error:/i);
    expectTokenOnly(container);
  });
});

describe("error (rutefejl)", () => {
  it("viser aldrig fejlbeskeden eller stacktracen — men en reference (digest) til support", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("password=hemmelig postgres://bruger@host"), {
      digest: "d1g3st",
    });
    error.stack = "Error: password=hemmelig\n    at hemmeligFunktion (/srv/app/secret.ts:1:1)";
    const { container } = render(<RouteError error={error} retry={vi.fn()} />);
    expect(container.textContent).not.toMatch(/hemmelig|postgres|secret\.ts|at /);
    expect(container.textContent).toMatch(/Fejlreference: d1g3st/);
    expectTokenOnly(container);
  });

  it("'Prøv igen' kalder retry, og der er et link hjem", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const { getByRole } = render(<RouteError error={new Error("x")} retry={retry} />);
    fireEvent.click(getByRole("button", { name: "Prøv igen" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(getByRole("link", { name: "Til forsiden" }).getAttribute("href")).toBe("/");
  });

  it("logger fejlen i konsollen (så den ikke forsvinder) i stedet for at vise den", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("intern");
    render(<RouteError error={error} retry={vi.fn()} />);
    expect(spy).toHaveBeenCalledWith(error);
  });
});

describe("global-error", () => {
  it("bringer sit eget <html lang=da>/<body>, har titel, 'Prøv igen' og en hård link hjem", () => {
    const html = renderToStaticMarkup(
      <GlobalError error={Object.assign(new Error("intern"), { digest: "g1" })} retry={() => {}} />,
    );
    expect(html).toMatch(/^<html lang="da">/);
    expect(html).toContain("<body>");
    expect(html).toContain("<title>Noget gik galt");
    expect(html).toContain("Prøv igen");
    expect(html).toContain('<a class="btn-ghost" href="/">Til forsiden</a>');
    expect(html).toContain("Fejlreference: g1");
    expect(html).not.toContain("intern");
    expect(html).not.toContain("style=");
  });
});
