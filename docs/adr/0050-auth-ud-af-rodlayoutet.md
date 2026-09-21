# 0050 — Sessionen ud af rodlayoutet: header-nav'en streames

- **Status:** Accepteret
- **Dato:** 2026-09-21
- **Fase:** — (drift/ydelse, rører site-kromet fra ADR 0039)
- **Berører uafklaret punkt:** nej. Netlify-planen og en evt. Cache Components-migration
  er begge åbne, men denne ADR beslutter ingen af dem

## Kontekst

ADR 0049 fjernede de duplikerede brugeropslag pr. request. Tilbage stod den tungere halvdel
af **B-27**: intet på `sua-abaas.netlify.app` kan caches, og hele siden venter på en rundtur
til Supabase før første byte.

Årsagen er målt, ikke gættet. `SiteHeader` lå i **rodlayoutet** og ventede på
`getCurrentUser()`. Et enkelt cookie-opslag i rodlayoutet smitter af på alt. To builds side
om side viser det:

| Build | Rutetabel |
|---|---|
| Uden Supabase-konfiguration | `/`, `/_not-found`, `/check-email`, `/login`, `/signup`, `/styleguide` er **statiske** (○) |
| **Med** Supabase-konfiguration (som på Netlify) | **hver eneste rute er dynamisk** (ƒ) — også `/_not-found` |

Uden nøgler giver auth-porten stub'en, som svarer uden at røre cookies, så Next kan
prærendere. Med nøgler læser den rigtige provider cookies under prerender, og så falder
hele sitet ud af statisk rendering. Det er derfor svarene bærer `no-store`.

## Overvejede muligheder

- **A — Cache Components (`cacheComponents: true`).** Next 16's egen anbefaling til netop
  dette: statisk skal + streamede dynamiske huller (PPR). **Afprøvet.** Buildet fejler på
  19 filer: `Route segment config "dynamic" is not compatible with nextConfig.cacheComponents`.
  De 19 `export const dynamic = "force-dynamic"` er bevidste markeringer ("Session- + RLS-afhængig
  — aldrig statisk prerender"), og under Cache Components vendes modellen om, så hver
  authed side desuden skal have sine Suspense-grænser gennemgået. Det er en migration med
  egen risiko på Netlify, ikke en skive — og et valg om hele rammeværkets cache-semantik,
  som ikke er Claude Codes at træffe alene.
- **B — kromet gøres auth-frit på offentlige ruter** (rute-grupper eller en klient-nav).
  Giver ægte statiske sider, men en indlogget bruger på forsiden ville møde "Log ind",
  eller et synligt hop ved hydrering — netop det kromet ellers undgår.
- **C — isolér afhængigheden bag en Suspense-grænse.** Ruten forbliver dynamisk, men
  kromet og sideindholdet behøver ikke længere vente på sessionen.

## Beslutning

**C nu; A forelægges Mads.**

`SiteHeader` er gjort **synkron og auth-fri**. Det auth-afhængige led er flyttet til
`SiteNav` bag `<Suspense>`, så resten af svaret kan sendes af sted med det samme og nav'en
streame ind bagefter.

Målt på en lokal produktionsbuild med en simuleret rundtur på 150 ms (forsiden tvunget
dynamisk, som den er i produktion):

| | TTFB på `/` | Total |
|---|---|---|
| Sessionen i rodlayoutet | **~162 ms** | ~162 ms |
| Nav'en bag Suspense | **~15 ms** | ~160 ms |

Siden begynder altså at tegne med det samme frem for at vente rundturen af. Samlet tid er
den samme — det er *ventetiden før noget sker* der forsvinder, og det er den ejerne mærker.

**Fallback er `null`, ikke den udloggede nav.** En kort tom plads er ærligere end at vise
"Log ind" til en der ER logget ind. Anonyme gæster betaler i praksis ikke for det: uden
session-cookie svarer `auth.getUser()` lokalt uden netværkskald (målt i `auth-js`, ADR 0049),
så deres nav er der straks.

## Konsekvenser

- Positive: TTFB på offentlige sider afkobles fra Supabase. Kromet er nu testbart — rolle-
  logikken i nav'en var **utestet** så længe headeren var en async server-komponent
  (`tests/unit/site-chrome.test.tsx` sagde det selv); `SiteNavLinks` er ren og dækket for
  alle rollekombinationer, inklusive at en bruger uden roller ikke får en indgang den ikke må se.
- Negative / pris: ruterne er **stadig dynamiske**, så der caches fortsat intet på CDN'en.
  Denne ADR fjerner ventetiden, ikke funktionskaldet. Kromet er desuden delt over to filer
  hvor det før var én.
- Opfølgning:
  - **B-27 er stadig ikke lukket.** Tilbage står (a) Cache Components-migrationen, som er
    Mads' valg — afprøvet og beskrevet ovenfor, så beslutningen kan træffes på tal frem for
    på fornemmelse; og (b) funktions-regionen i Netlify, som kræver Pro.
  - Mål igen fra en dansk forbindelse før der konkluderes på absolutte tal.
