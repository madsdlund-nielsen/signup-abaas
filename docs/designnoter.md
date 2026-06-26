# Designnoter — Advisory Board Unlimited

> Status: BEKRÆFTET 2026-06-26 via computed styles fra signupacademy.com
> (Claude in Chrome). Tokens ligger i `docs/design-tokens.css` — den fil er
> autoritativ. Denne note forklarer *intentionen* bag tokens.
>
> Logo til Advisory Board Unlimited er endnu ikke designet (laves i Claude
> Design, matcher palette + Open Sans, udskiftes senere).

## Brandpersonlighed
Consultancy-grade B2B-premium. Afdæmpet, rent, redaktionelt. Ingen gradienter,
ingen runde hjørner, minimal dekoration. Kontrast mellem store lyse overskrifter
på mørke fotos og luftige lysegrå indholdssektioner.

## Farver (bekræftet)
- Navy `#263753` — primær brand; overskrifter, paneler, midt-sektioner.
- Charcoal `#1A2528` — hero/mørk sektion, header-bar.
- Guld `#B4965D` (hover `#A3854F`) — KUN accent: CTA, links, highlight, logo.
- Lysegrå `#EEEEEE` — sektionsbaggrunde. Brødtekst `#333333`.

## Form
- **border-radius: 0 overalt.** Knapper, kort, inputs er firkantede. Signatur.
- Generøs whitespace; ~90px lodret mellem sektioner.

## Typografi
- **Open Sans** til alt (overskrift + brød). Vægte: 300 / 400 / 600 / 700.
- Store overskrifter er TYNDE (300/400) — aldrig fed. Elegancen ligger i tynde
  streger ved stor størrelse.
- Eyebrows, nav, knapper, kort-titler: UPPERCASE med letter-spacing 1px.
- Brødtekst line-height ~1.7 for redaktionel, åndbar følelse.

## Komponentsignaturer
- CTA: guldfyld, hvid versaltekst, firkantet, ingen gradient.
- Kort: fuldt foto-fill, titel hvid versal nederst, blid zoom/darken på hover.
- Sektionsrytme: vekslende bånd hvid → lysegrå → navy → hvid.
- Foto-overlay: mørk translucent (rgba(38,55,83,0.85)) så hvid tekst læses.

## Do / Don't
DO: tynde store overskrifter i navy/hvid · alt fladt & firkantet · guld sparsomt
· whitespace · versal-UI med letter-spacing.
DON'T: runde hjørner · gradienter · skygger på knapper · fede vægte til store
overskrifter · guld som baggrundsflade · presset layout.

## Næste skridt
1. ✅ Tokens bygget (`design-tokens.css`).
2. Logo-placeholder i Claude Design (palette + Open Sans, firkantet).
3. Design-token-trin er nu i `fase-0-eksekvering.md` (trin 1b).
