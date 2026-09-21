# 0049 — Brugeropslaget memoiseres pr. request, og proxyen holdes billig

- **Status:** Accepteret
- **Dato:** 2026-09-21
- **Fase:** — (drift/ydelse, rører fase 0's auth-fundament)
- **Berører uafklaret punkt:** nej. Netlify-planen (funktions-region) er et åbent punkt,
  men denne ADR beslutter intet om den

## Kontekst

Backlog **B-27** målte at hver sidevisning på `sua-abaas.netlify.app` koster en
serverfunktion, at intet caches, og at en dansk bruger krydser Atlanten flere gange pr.
sidevisning. Ejerne dømmer platformen på om den føles high-end (CLAUDE.md § Design), så det
er et acceptkriterium, ikke kosmetik.

En gennemgang af kaldsvejen viste hvor tiden faktisk går. Ét sideskift for en **indlogget**
bruger spørger om den samme bruger flere gange:

| Kaldssted | Hvad det koster |
|---|---|
| `src/proxy.ts` | `supabase.auth.getUser()` — sessionsopfriskning |
| `SiteHeader` (rodlayoutet) | `getCurrentUser()` → JWT-verifikation + rolleopslag |
| segment-layout, fx `/admin/layout.tsx` | `getCurrentUser()` → igen |
| siden selv og hver server-reader med `requireRole` | `getCurrentUser()` → igen |

Hvert `getCurrentUser()` er **to** netværkskald til Supabase (`auth.getUser()` +
`user_role_assignment`-opslaget), og de ligger sekventielt før noget renderes. På en
admin-side blev det 5-7 rundture til Stockholm — fra en funktion i Ohio.

Next 16's egen vejledning (`node_modules/next/dist/docs`) er utvetydig om proxy-laget:
proxyen er "not intended for slow data fetching", kører på **hver** request inklusive
prefetches, og bør kun læse sessionen fra cookien — databasetjek frarådes direkte.
Matcher-eksemplet i `guides/authentication.md` udelader `api`.

## Overvejede muligheder

- **A — fjern `getUser()` fra proxyen.** Fjerner ét netværkskald pr. request. Men kaldet
  er dér for at **opfriske** sessionen (`@supabase/ssr`-mønstret), ikke for at autorisere;
  uden det udløber adgangstokens og brugeren logges ud efter en time. Desuden: målt i
  `auth-js` returnerer `getUser()` **lokalt uden netværkskald** når der ingen session-cookie
  er — så for anonyme gæster er kaldet allerede gratis, og for indloggede gør det nytte.
  Prisen er reel, gevinsten er ikke.
- **B — gør de offentlige sider statiske igen.** Den største gevinst for en førstegangsbesøgende,
  men årsagen er at `SiteHeader` ligger i **rodlayoutet** og venter på `getCurrentUser()`,
  hvilket gør hver rute dynamisk. At flytte den afhængighed om er en ændring af site-kromet
  (ADR 0039) og fortjener sin egen skive — ikke en sidegevinst i en ydelses-PR.
- **C — fjern duplikaterne.** Brugeren kan ikke skifte midt i et render-pass, så de 2-4
  opslag pr. request er per definition det samme svar hentet flere gange.

## Beslutning

**C, plus den ene matcher-rettelse der også er en fejlrettelse.**

1. **`getCurrentUser` memoiseres pr. request** med `cache` fra React. Semantikken er
   uændret — samme JWT-verifikation, samme rolleopslag, samme svar — kun antallet af gange
   det sker pr. request ændrer sig.

   Det er et greb på autorisationslaget, så forudsætningen er **verificeret, ikke antaget**:
   uden for et render-scope memoiserer `cache` slet ikke og kalder bare igennem. Der findes
   altså intet modul-globalt map der kunne bære én brugers session over i en anden requests
   render. `tests/unit/auth.test.ts` låser den forudsætning fast, så et React-skifte fanges
   af CI i stedet for i produktion.

   Læs-efter-skriv er gennemgået: de to steder der tildeler roller (`provisionOwner`,
   `provisionPartner`) afslutter med en `redirect()` frem for at læse brugeren igen i samme
   request, så et memoiseret svar kan ikke nå at blive forældet.

2. **Proxy-matcheren udelader `api`.** Det er primært en **fejlrettelse**: adgangsporten
   (ADR 0020) omdirigerer alt undtagen `/gate`, så i det øjeblik porten blev slået til,
   ville Cal.com's og Alunta's callbacks blive sendt til en adgangskodeskærm. En maskine kan
   ikke taste en delt adgangskode. Webhooks bærer i forvejen deres eget værn — HMAC-signatur
   før alt andet, fail-closed (ADR 0027/0029) — så hverken porten eller sessionsopfriskningen
   har noget at bidrage med dér.

**Bevidst ikke gjort:** A og B ovenfor. A ville bytte en time**s** session for ét sparet kald
der for anonyme allerede er gratis. B er den næste skive.

## Konsekvenser

- Positive: målt på en lokal produktionsbuild falder antallet af brugeropslag fra **2 til 1**
  pr. request på `/dashboard` og `/moeder` — altså fra fire til to netværkskald når Supabase
  er konfigureret. På ruter med både et segment-layout og server-readers (`/admin/*`) er
  besparelsen større, fordi flere kaldssteder deler det samme ene opslag. Webhooks kan ikke
  længere brydes af at porten slås til.
- Negative / pris: `src/server/auth/index.ts` importerer nu `react`. Det er uproblematisk på
  serveren, men gør modulet lidt mindre "rent domæne". Memoiseringen er usynlig, så en
  fremtidig læser kan tro at hvert kald rammer Supabase — derfor står begrundelsen i koden
  og ikke kun her.
- Opfølgning:
  - **B-27 er ikke lukket.** Tilbage står (a) at rodlayoutets `SiteHeader` gør hver rute
    dynamisk, så intet kan caches — egen skive, rører ADR 0039; og (b) funktions-regionen
    i Netlify, som kræver Pro og er en plan-beslutning, ikke Claude Codes.
  - Mål igen fra en dansk forbindelse før der konkluderes på absolutte tal.
