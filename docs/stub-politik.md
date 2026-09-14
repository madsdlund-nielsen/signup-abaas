# Stub-politik

> Uafklarede punkter blokerer ikke byggeriet — vi bygger med stubs. Denne fil
> udfolder reglen fra `CLAUDE.md`; registret over faktiske stubs ligger i
> `docs/stub-register.md`. **Hver ny stub registreres i samme PR som den opstår.**

## Kernereglen

**En stub er et synligt hul, ikke et midlertidigt svar.**

Den fejler højlydt i produktion frem for at gætte stille. En stub der returnerer
noget plausibelt er værre end ingen stub: den flytter fejlen fra byggetid til
produktion, og fra en fejlmeddelelse til et forkert tal på en faktura.

To ting følger direkte:

1. **Skriv aldrig et plausibelt forretningstal som placeholder.** Ingen `499`, ingen
   `0.25` momssats, ingen `1200` honorarsats "indtil videre". Et tal ingen har
   besluttet må ikke findes i koden — heller ikke som default.
2. **Stub aldrig:** autorisation, RLS, webhook-signaturverifikation, idempotens
   eller samtykke. De fem er sikkerheds- og integritetsgrænser. En stubbet grænse
   er en åben dør, og den slags opdages ikke i test — den opdages bagefter.

## De to stub-typer i repoet

Mønstret er etableret i fase 0 (ADR 0004) og håndhæves af `tests/integration/adapters.test.ts`.
Hver adapter i `src/lib/<modul>/index.ts` vælger implementering ud fra
`isEnabled(<flag>, env) && isConfigured(config)` — er begge ikke opfyldt, returneres stubben.

### Backend-stub — kaster

For operationer der ikke kan udføres uden en rigtig backend. Kaster
`NotConfiguredError` (`src/lib/errors.ts`) med leverandør og operation.

```ts
throw new NotConfiguredError("calcom", "createBooking");
```

Bruges hvor et manglende kald ville korrumpere forretningstilstand: booking, video,
betaling, bogføring, LLM, transskription.

### Fire-and-forget-stub — logger og resolver

For operationer hvor et manglende kald ikke ændrer forretningstilstand: e-mail, SMS,
analytics. Stubben logger hvad den *ville* have gjort og resolver.

```ts
console.info(`[email:stub] ville sende til ${message.to}: "${message.subject}"`);
```

Den må aldrig sluge en fejl fra en *konfigureret* adapter — kun stå i stedet for et
kald der aldrig blev forsøgt.

## Demo-implementeringer — ikke stubs (ADR 0041)

Siden 2026-09-14 har hver backend-port en tredje implementering ved siden af rigtig og
stub: `src/lib/<modul>/demo.ts`. Den er det modsatte af en stub på ét punkt — den
**virker** — og identisk på det afgørende: den foregiver intet.

Factoryen vælger demo kun når `FLAG_DEMO` er sat **og** den rigtige config mangler.
Rigtige nøgler vinder altid. Demo kan derfor aldrig skygge for en ægte integration.

Data-reglen: alt demo returnerer er *åbenlyst* falsk — referencer med `DEMO-`, tekster
med `[DEMO]`, aldrig et tal der ligner en pris eller en sats. Forbuddet ovenfor gælder
*plausible* placeholders; en værdi ingen kan forveksle med en beslutning er ikke en
placeholder. Ingen demo-værdi lever i kode som default; de lever i `demo.ts` og i
demo-seed'et.

De fem grænser gælder uændret: demo erstatter leverandørkald, aldrig autorisation, RLS,
webhook-signaturverifikation, idempotens eller samtykke. Demo-checkouten
(`confirmDemoCard`) er det eneste sted en demo skriver forretningstilstand — den udfører
præcis webhookens tilstandsskift, bag ejerskabstjek, og afvises medmindre demo-provideren
er den aktive.

Demo registreres ikke i stub-registret som et hul — den er ikke et. Registret noterer i
stedet hvilke moduler der har en demo, så fase 6 kan bekræfte at `FLAG_DEMO` er slået fra.

## Beslutnings-pladsholdere — en tredje kategori

Nogle huller kan ikke fejle højlydt, fordi funktionen skal returnere noget for at
virke overhovedet. Board-matchingens tie-break er eksemplet: algoritmen *skal* vælge
en partner, også før ejeren har besluttet efter hvilken regel.

For dem gælder en anden regel: **vær neutral og deterministisk frem for plausibel.**
Tie-break sorterer på `sort_order`, navn og id — en rækkefølge der udtrykker ingen
holdning til rating eller tilgængelighed, og som aldrig ændrer sig mellem to kørsler.
En pladsholder der *lignede* en rigtig regel ville være et gæt forklædt som en beslutning.

Pladsholdere registreres på lige fod med stubs, i deres egen sektion, og markeres i
koden med `// TODO(ejer):` / `// TODO(mads):`.

## Sådan registrerer du

Tilføj en række i `docs/stub-register.md` i **samme PR** som stubben. Hver post skal
kunne besvare: hvad er stubbet, hvorfor, hvad låser det op, og hvem skylder svaret.

En stub uden en registerpost er ikke et synligt hul — den er et skjult et.

## Lukning

Fase 6 gennemgår registret post for post (`docs/fase-6.md` §6.4). Hver tilbageværende
stub skal enten være løst eller have **eksplicit ejer-accept** på at gå i launch som
stub. Ingen stub går i produktion, fordi nogen glemte den.
