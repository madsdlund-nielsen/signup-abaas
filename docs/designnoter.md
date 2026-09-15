# Designnoter — Advisory Board Unlimited

> Status: RE-MÅLT 2026-09-15 direkte i signupacademy.com's CSS (Divi 5, theme builder) —
> se ADR 0044. Første version (2026-06-26) byggede på computed styles; den nye måling
> fandt seks konkrete afvigelser, som er rettet i tokens og komponenter. Tokens ligger i
> `docs/design-tokens.css` — den fil er autoritativ. Denne note forklarer *intentionen*.
>
> **Ved konflikt mellem designmanual v1.2 og det levende site vinder sitet** (Mads,
> 2026-09-15). ABaaS er en ydelse fra SignUp Academy og skal se ud som hovedvirksomheden.
>
> Mærkesystemet (ordmærke + kortformer) er beskrevet i ADR 0039.

## Brandpersonlighed
Consultancy-grade B2B-premium. Afdæmpet, rent, redaktionelt. Ingen gradienter,
ingen runde hjørner, minimal dekoration. Kontrast mellem store lyse overskrifter
på mørke fotos og luftige lysegrå indholdssektioner.

## Farver (målt)
- Navy `#263753` — Divi "heading color": overskrifter, **top-kontaktbar**, sektionsbånd.
- Charcoal `#1A2528` — Divi "primary": hero, header-bar, mørke sektioner.
- Guld `#B4965D` (hover `#A3854F`) — KUN accent: CTA (fyld + 1 px kant), links, logo.
- Stålblå `#697EA5` — Divi "secondary"; sparsom.
- Lysegrå `#EEEEEE` — sektionsbaggrunde. Brødtekst `#333333`. Slate `#6D838A` — placeholders.
- Foto-overlay: `rgba(34,53,57,0.77)` som gradient nedefra (0 % → gennemsigtig ved 61 %).

## Form
- **border-radius: 0 overalt.** Sitets knap-preset sætter eksplicit 0 på alle fire hjørner.
- Sektioner: **100 px** lodret luft; hero **155 px** (85 px på mobil).
- Indholdsbredde **1300 px** (Divi-rows = 90 %); **hero-rækken 1400 px**; header 1170 px.

## Typografi (målt)
- **Open Sans** til alt; sitet indlæser den variable font 300–800. Vi indlæser
  300/400/**500**/600/700 — 500 manglede før, og sitets nav bruger den.
- H1 (hero): **61 px / 400 / hvid / 1.3**, venstrestillet. Mobil: 55 → 34 px.
  (Var 300 hos os — for tynd ved 61 px; den mest synlige "font-forskel".)
- H2 (sektionsintro): **calc(30px + 1vw) / 300 / navy / 1.4, centreret**. Mobil 30 px.
- H3: **26 px / 400 / 1.4, sentence case** — versal h3 findes kun i foden (20 px/600).
- Lead (hero-undertekst): **20 px / 400 / 1.6 / ren hvid**.
- Brødtekst: 16 px / 1.7 / `#333333`. Divi's globale brødtekstvægt er 500, men sitets egne
  moduler bruger 400 flere steder — vi holder 400. ⚠ Variant: 500 giver et tættere udtryk.
- Nav: **13 px / 500 / versal / 1 px / ren hvid**.
- Top-kontaktbar: 14 px / 600 / hvid, **ikke** versal, centreret (e-mail · telefon).
- Knapper: 14 px / 700 / versal / 1 px, guldfyld + 1 px guldkant, radius 0.
- Eyebrows: versal 14 px/700, guld — vores signatur; sitets forside bruger dem ikke.

## Komponentsignaturer
- CTA: guldfyld, hvid versaltekst, firkantet, ingen gradient.
- Kort: fuldt foto-fill, titel hvid versal nederst, blid zoom/darken på hover.
- Sektionsrytme: vekslende bånd hvid → lysegrå → navy → hvid. **Intro centreret, hero
  venstrestillet.**
- Hero: sitet bruger foto med overlay-gradient. ABaaS har endnu intet hero-foto — charcoal
  indtil et asset findes (`--overlay-hero` er klar).

## Do / Don't
DO: tynde store overskrifter i navy/hvid · alt fladt & firkantet · guld sparsomt
· whitespace · versal-UI med letter-spacing i nav, knapper og eyebrows.
DON'T: runde hjørner · gradienter · skygger på knapper · fede vægte til store
overskrifter · guld som baggrundsflade · presset layout · versal h3 i indhold.

## Næste skridt
1. ✅ Tokens re-målt og komponenter rettet (ADR 0044).
2. Hero-foto: et asset fra SignUp Academy (licensen er deres) → én klasse på hero-båndet.
3. ⚠ Mads klikker og afgør: brødtekst 400 vs. 500 · eyebrows på forsiden · guld-CTA i hero.
