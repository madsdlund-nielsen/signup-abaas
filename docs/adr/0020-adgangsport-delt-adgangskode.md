# 0020 — Adgangsport: delt adgangskode før auth (lukket test)

- **Status:** Accepteret
- **Dato:** 2026-07-22
- **Fase:** 1
- **Berører uafklaret punkt:** nej (midlertidig adgangskontrol til ejer-test; ikke en del af den permanente auth-model)

## Kontekst

Før Andreas & Mette får appen til test skal tilfældige besøgende, der falder over URL'en, holdes ude
— også fra login/signup. Vi vil have **én delt adgangskode FØR auth-skærmen**, som Mads kan give til
testerne. Kravet er "simpelt" og midlertidigt. Signup er åben, så uden en port kan hvem som helst
oprette en konto; en delt port foran alt lukker det under testfasen.

Begrænsninger: ingen tunge afhængigheder (ADR 0002); porten kører i `proxy` (Next 16-middleware) som
på Netlify eksekveres som en **edge/Deno-funktion** → node:crypto er ikke garanteret der.

## Overvejede muligheder

- **A — custom port i proxy:** delt kode, scrypt-hash i server-only env-var, signeret httpOnly-cookie,
  feature-flag. Placeres før auth i proxy'en.
- **B — Netlify site-password (indbygget):** nul kode, men gater hele sitet før alt (kan ikke sidde
  "mellem auth og app"), og kræver betalt plan.
- **Lagring:** plaintext env-var vs. **hash** vs. DB-tabel.

## Beslutning

**A + hash i env-var.** Tre server-only env-vars (aldrig `NEXT_PUBLIC`, aldrig i repo/DB):
`APP_GATE_ENABLED`, `APP_GATE_PASSWORD_HASH` (scrypt `salt:hash`), `APP_GATE_COOKIE_SECRET` (HMAC-nøgle).
- **Proxy** (edge): uden en gyldig, HMAC-**signeret** `app_gate`-cookie omdirigeres enhver request
  (også `/login`) til `/gate`. Kun `/gate` er undtaget. Signaturverifikation via **Web Crypto**
  (`token.ts`) — edge-sikker; ingen node:crypto på edge.
- **Server-action** (Node): verificerer koden mod scrypt-hashen (`password.ts`, node:crypto,
  konstant-tid) og sætter en httpOnly/Secure/SameSite=Lax-cookie (30 dage).
- **Hashing** frem for plaintext: lækker env'en (log/screenshot), er koden ikke direkte genskabelig.
  scrypt er i Node's indbyggede crypto → ingen ny dependency. Plaintext lever kun i testernes
  password-manager; deles ud-af-bånd. Genereres med `scripts/hash-gate-password.mjs` (skjult stdin).
- **Feature-flag:** slukket når `APP_GATE_ENABLED !== "true"` → CI/dev/tests upåvirket; slukkes efter
  launch med én env-ændring, ingen kodefjernelse.

**Fail-open ved delvis konfiguration:** er porten "enabled" men mangler hash/secret, logges en advarsel
og porten er inaktiv — frem for at låse alle ude (inkl. admin) ved en fejlkonfiguration. Sæt alle tre
vars samtidig.

## Konsekvenser

- **Positive:** tilfældige besøgende (og spam-signups) holdes ude under testen; ingen ny dependency;
  ingen DB-overflade; triviel at slukke efter launch.
- **Negative / pris:** delt hemmelighed (ikke pr.-bruger) — god nok til en lukket test, ikke til
  produktion. Fail-open betyder "enabled men fejlkonfigureret = åben" (bevidst, for at undgå lockout).
- **Opfølgning:** fjern/slå fra efter launch (`APP_GATE_ENABLED=false`). Er en stærkere port nødvendig
  senere (pr.-bruger, rate-limiting), er dette et rent, isoleret modul at udbygge.
