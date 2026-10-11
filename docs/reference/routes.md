# Reference: ruter

> Genereret af `scripts/gen-reference.mjs` (`npm run docs:reference`). Redigér ikke i hånden — ret koden eller migrationerne og generér igen.

Adgangen er **udledt af koden**: guards i selve filen eller i et overliggende `layout.tsx`, og for handlers signatur-/hemmelighedstjek i filen. Hvor ingen guard kan findes står *usikker* — det er ikke det samme som offentlig. Autorisationen i sidste instans er RLS i databasen, ikke denne tabel.

**Adgangsport (ADR 0020).** `src/proxy.ts` matcher:

    /((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)

Undtaget porten (`isGateExempt`): `/gate`, `/vurdering/`. *Udenfor proxyen* = ruten når aldrig porten (fx `/api/`, som i stedet bærer sin egen signatur eller hemmelighed).

## Sider (35)

| Rute | Fil | Adgang | Udledning | Adgangsport |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | ingen guard fundet i filen — offentlig eller beskyttet andetsteds | usikker | bag porten |
| `/admin` | `src/app/admin/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/boards` | `src/app/admin/boards/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/boards/[id]` | `src/app/admin/boards/[id]/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/drift` | `src/app/admin/drift/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/honorar` | `src/app/admin/honorar/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/juridisk` | `src/app/admin/juridisk/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/klar` | `src/app/admin/klar/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/notifikationer` | `src/app/admin/notifikationer/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/notifikationer/[type]` | `src/app/admin/notifikationer/[type]/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/partners` | `src/app/admin/partners/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/partners/[id]` | `src/app/admin/partners/[id]/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/priser` | `src/app/admin/priser/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/quiz` | `src/app/admin/quiz/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/quiz/[id]` | `src/app/admin/quiz/[id]/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/tags` | `src/app/admin/tags/page.tsx` | login + rolle admin | kode | bag porten |
| `/admin/vurderinger` | `src/app/admin/vurderinger/page.tsx` | login + rolle admin | kode | bag porten |
| `/betaling` | `src/app/betaling/page.tsx` | login + rolle ejer | kode | bag porten |
| `/betaling/demo-kort/[membershipId]` | `src/app/betaling/demo-kort/[membershipId]/page.tsx` | login + rolle ejer | kode | bag porten |
| `/board` | `src/app/board/page.tsx` | login + rolle ejer | kode | bag porten |
| `/check-email` | `src/app/(auth)/check-email/page.tsx` | ingen guard fundet i filen — offentlig eller beskyttet andetsteds | usikker | bag porten |
| `/dashboard` | `src/app/dashboard/page.tsx` | login (indholdet forgrener på rolle: admin, ejer, partner) | kode | bag porten |
| `/gate` | `src/app/gate/page.tsx` | ingen guard fundet i filen — offentlig eller beskyttet andetsteds | usikker | undtaget |
| `/konto` | `src/app/konto/page.tsx` | login | kode | bag porten |
| `/login` | `src/app/(auth)/login/page.tsx` | ingen guard fundet i filen — offentlig eller beskyttet andetsteds | usikker | bag porten |
| `/moeder` | `src/app/moeder/page.tsx` | login + rolle ejer | kode | bag porten |
| `/moeder/[id]` | `src/app/moeder/[id]/page.tsx` | login (indholdet forgrener på rolle: ejer, partner) | kode | bag porten |
| `/moeder/rum/[ref]` | `src/app/moeder/rum/[ref]/page.tsx` | login (indholdet forgrener på rolle: ejer, partner) | kode | bag porten |
| `/onboarding` | `src/app/onboarding/page.tsx` | login + rolle ejer | kode | bag porten |
| `/partner` | `src/app/partner/page.tsx` | login + rolle partner | kode | bag porten |
| `/partner/honorar` | `src/app/partner/honorar/page.tsx` | login + rolle partner | kode | bag porten |
| `/partner/tilgaengelighed` | `src/app/partner/tilgaengelighed/page.tsx` | login + rolle partner | kode | bag porten |
| `/signup` | `src/app/(auth)/signup/page.tsx` | ingen guard fundet i filen — offentlig eller beskyttet andetsteds | usikker | bag porten |
| `/styleguide` | `src/app/styleguide/page.tsx` | ingen guard fundet i filen — offentlig eller beskyttet andetsteds | usikker | bag porten |
| `/vurdering/[token]` | `src/app/vurdering/[token]/page.tsx` | engangstoken i URL (kontrolleres på serveren) | usikker | undtaget |

## Route handlers (7)

| Rute | Metoder | Fil | Adgang | Udledning | Adgangsport | Planlagt af |
|---|---|---|---|---|---|---|
| `/admin/honorar/eksport` | GET | `src/app/admin/honorar/eksport/route.ts` | login + rolle admin | kode | bag porten |  |
| `/api/admin/indsigt` | POST | `src/app/api/admin/indsigt/route.ts` | login; rolle kontrolleres ikke i filen (sti under admin — formentlig i en delegeret funktion) | usikker | udenfor proxyen |  |
| `/api/cron/charge-periods` | POST | `src/app/api/cron/charge-periods/route.ts` | cron (header x-cron-secret mod CRON_SECRET) | kode | udenfor proxyen | charge-periods (`0 3 * * *`) |
| `/api/cron/notifications` | POST | `src/app/api/cron/notifications/route.ts` | cron (header x-cron-secret mod CRON_SECRET) | kode | udenfor proxyen | ingen scheduled function |
| `/api/cron/summaries` | POST | `src/app/api/cron/summaries/route.ts` | cron (header x-cron-secret mod CRON_SECRET) | kode | udenfor proxyen | summaries (`*/15 * * * *`) |
| `/api/webhooks/alunta` | POST | `src/app/api/webhooks/alunta/route.ts` | webhook (signatur verificeres før alt andet) | kode | udenfor proxyen |  |
| `/api/webhooks/calcom` | POST | `src/app/api/webhooks/calcom/route.ts` | webhook (signatur verificeres før alt andet) | kode | udenfor proxyen |  |

## Planlagte funktioner (2)

| Funktion | Cron (UTC) | Kalder | Fil |
|---|---|---|---|
| charge-periods | `0 3 * * *` | `/api/cron/charge-periods` | `netlify/functions/charge-periods.ts` |
| summaries | `*/15 * * * *` | `/api/cron/summaries` | `netlify/functions/summaries.ts` |
