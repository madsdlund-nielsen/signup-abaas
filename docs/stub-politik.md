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
