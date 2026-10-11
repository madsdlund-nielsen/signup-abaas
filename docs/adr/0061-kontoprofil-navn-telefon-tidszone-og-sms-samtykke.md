# 0061 — Kontoprofil: navn, telefon, tidszone og SMS-samtykke på brugeren

- **Status:** Accepteret — delvist erstattet af 0065 (SMS-opt-in (`sms_opt_in`/`sms_opt_in_at`, afkrydsningen på `/konto` og samtykkekravet i motoren) er fjernet i migration 0027; navn, telefon og tidszone består)
- **Dato:** 2026-10-10
- **Fase:** 2 + 4 (lukker huller fra booking, ADR 0046, og notifikationsmotoren, ADR 0057)
- **Berører uafklaret punkt:** ja — samtykketeksten til SMS og privatlivsvilkår (ToS) er ejerens.
  Teksten på `/konto` er teknisk pladsholder, ikke godkendt juridisk ordlyd.

## Kontekst

Tre huller fra tidligere skiver havde samme rod: brugeren har kun en e-mailadresse.

1. **Booking.** Cal.com kræver et ikke-tomt attendee-navn og en tidszone. `ownerAttendee` brugte
   e-mailadressen som navn og et fast `Europe/Copenhagen` (`TODO(mads)`, ADR 0046).
2. **SMS.** Notifikationsmotoren (ADR 0057) har en SMS-kanal til påmindelse og ratinganmodning,
   men der var intet telefonnummer at sende til — enhver SMS blev logget som `fejlet`.
3. **Skabelonvariabler.** Kataloget havde bevidst ingen modtagernavn-variabel, fordi ingen
   modtager havde et navn (ADR 0057 pkt. 3).

Valgene er Spand A (datamodel, RLS-mønster) og berører et uafklaret punkt (samtykke).

## Overvejede muligheder

**Hvor profilen bor**
- *A — kolonner på `app_user`.* Rækken findes for enhver bruger (provisioneringen opretter den),
  defaults gælder uden backfill, og adgangsmodellen er allerede den rigtige: `app_user_select_self`
  (0006) og ingen write-policies.
- *B — 1:1-tabel `app_user_profile`.* Adskiller følsomme felter fra kontoen, men kræver en række
  pr. bruger (backfill + provisionering i to veje), egne policies, og et join i hver læsning —
  uden at vi i dag har en læsevej der motiverer adskillelsen.

**Tidszone: kort liste eller IANA-form**
- *A — `check (time_zone in (…))`.* Strengt, men hver ny zone er en migration, og listen er et
  produktvalg i et schema.
- *B — IANA-form i databasen, gyldighed i appen.* Databasen afviser det der ikke engang har
  formen (`Copenhagen`, `+01:00`, SQL i feltet); appen kontrollerer mod tz-databasen via `Intl`.

**SMS-samtykke**
- *A — nummeret findes = SMS må sendes.* Forkert: brugeren kan have givet nummeret til andet.
- *B — et eksplicit, separat samtykke (`sms_opt_in` + `sms_opt_in_at`), og motoren kræver begge.*

**Modtagernavn i skabeloner**
- *A — fald tilbage til e-mailadressen når navnet mangler.* «Kære eva@firma.dk» er værre end ingen hilsen.
- *B — navnet leveres af motoren når det findes; mangler det, er det et render-problem (`fejlet`).*
  Samme regel som alle andre variabler (ADR 0057 pkt. 3): aldrig et stille tomt felt.

## Beslutning

**1. Kolonner på `app_user` (A), migration `0024_account_profile.sql`.** `display_name`,
`phone_e164`, `time_zone not null default 'Europe/Copenhagen'`, `sms_opt_in not null default false`,
`sms_opt_in_at`. Ingen kolonne har en forretningsværdi som default: navn og nummer er `null`,
samtykket er `false`. Tidszonens default er kontoens oprindelige antagelse (alle ejere er danske) —
en teknisk standard, ikke et forretningstal.

**2. RLS — uændret mønster, én ny policy.** Brugeren læser sin egen række (`app_user_select_self`).
Der er **bevidst ingen write-policy**: profilen skrives af en server-action
(`src/server/account/actions.ts`) med service-role bag `getCurrentUser`, og rækken der opdateres er
altid `id = den nuværende bruger` (id'et kommer aldrig fra formularen). En self-update-policy ville
også lade brugeren ændre `email` og `id` direkte via PostgREST. Ny: `app_user_select_admin`
(`has_role('admin')`) — admin læser (indsigt, support), skriver ikke. Det lukker samtidig det hul
ADR 0053 nævnte (admin kunne ikke tælle brugere). Læsevejen `getMyAccount` filtrerer derfor
**eksplicit på brugerens id**: uden filter ville en admin få en tilfældig rækkes profil.

**3. Constraints (formen i databasen, betydningen i appen).**
- Telefon: `^\+[1-9][0-9]{6,14}$` (E.164). «+45 foran otte cifre»-hjælpen er appens
  (`normalisePhone`, ren og enhedstestet): mellemrum og tegnsætning ignoreres, `00` er `+`,
  præcis otte cifre er dansk (og starter med 2-9), alt andet uden `+` afvises med en vejledning
  frem for at blive gættet.
- Tidszone: IANA-**form** eller `UTC` i databasen (B ovenfor); `isValidTimeZone` kontrollerer mod
  `Intl`. Formularens vælger har en kort udvalgt liste — det er et UI-valg, ikke en regel; et
  gemt navn uden for listen beholdes i vælgeren.
- Navn: 1-100 tegn efter trim, ingen styretegn (linjeskift kunne havne i en e-mailemnelinje).
- Samtykke: `(sms_opt_in ∧ sms_opt_in_at ≠ null ∧ phone_e164 ≠ null) ∨ (¬sms_opt_in ∧ sms_opt_in_at = null)`.
  Et samtykke uden nummer eller tidspunkt, og et tidspunkt uden samtykke, er ødelagte tilstande.
  Et tilbagekaldt samtykke efterlader intet tidspunkt, der kunne ligne et gyldigt.

**4. SMS-samtykke er en eksplicit afkrydsning, aldrig forudafkrydset for nye konti (B).** Samtykket
gælder nummeret i feltet, når der gemmes: et ændret nummer er et nyt samtykke og får nyt
tidspunkt (`smsConsentStamp`); et nyt navn fornyer det ikke. Sige ja uden nummer er en fejl, ikke
et stille nej. En allerede givet tilladelse vises afkrydset, fordi den afspejler brugerens eget valg.
Et gemt nummer uden samtykke er lovligt — nummeret bruges bare ikke.

**5. Motoren kræver nummer OG samtykke.** `resolveRecipient(…, "sms")` giver kun adressen når
`sms_opt_in` er sand og `phone_e164` findes; ellers logges `fejlet: intet SMS-samtykke/telefonnummer`
(samme log-form som for en manglende adresse — ingen persondata, ADR 0057 pkt. 6). SMS-opslaget
læser hverken e-mail eller navn.

**6. `{{modtager_navn}}` leveres af motoren (B).** Kataloget får variablen på alle fire typer.
Motoren slår kontoens `display_name` op — kun hvis skabelonen bruger variablen og kalderen ikke selv
har leveret en værdi. Har modtageren intet navn, findes værdien ikke, og renderen melder «har ingen
værdi» → udsendelsen er `fejlet`. Det er en bevidst afvejning, som editoren siger højt på variablen:
en skabelon der bruger navnet fejler for modtagere uden et. Partnernes katalognavn
(`partner_profile.name`) er et andet felt og bruges ikke.

**7. Booking.** `ownerAttendee({ email, displayName, timeZone })`: navn = `display_name`, ellers
e-mailadressen (Cal.com kræver et navn, og et opfundet er et gæt); tidszone = kontoens, med
`DEFAULT_TIME_ZONE` kun som værn mod en række uden værdi. De to `TODO(mads)` er fjernet.

**8. Indsigtsudtrækket (ADR 0053).** `person` får `navn`, `telefon`, `tidszone` og
`sms_samtykke { givet, tidspunkt }`. SMS-samtykket er undtagelsen fra «der findes ingen
samtykketabel»; afgrænsningen i selve udtrækket siger det, og at der ikke er historik.

**9. Mappestruktur.** `src/server/account/` (domænemappe, ADR 0035): `validation.ts` (rene regler),
`index.ts` (læsevej), `actions.ts` (skrivevej). Siden `/konto` er åben for alle roller — det er
*kontoens* navn, ikke en rolleprofil. Intet nyt feature-flag: siden læser og skriver kun egne data.

## Konsekvenser

- Positive: tre huller lukket med ét felt-sæt og ingen ny tabel eller policy-sæt. SMS kan nu
  sendes til dem der har bedt om det, og kun dem. Booking viser ejerens rigtige navn og zone.
- Negative / pris: **telefonnummeret ligger på en tabel mange læsevej-ideer vil ville udvide**.
  Enhver fremtidig bredere select-policy på `app_user` (fx «partnere ser deres ejers navn»)
  ville også blotlægge nummeret — den skal i stedet gå via en view med de navngivne kolonner
  (mønster: `partner_fee_line`, ADR 0051), eller via kolonne-grants. Overvejelsen står her, så
  den ikke glemmes. Navnet er ikke tvunget: en konto uden navn får e-mailen som attendee-navn, og
  skabeloner der bruger `{{modtager_navn}}` fejler for den.
- Opfølgning:
  - ~~TODO(ejer): SMS-samtykketeksten~~ → lukket af ADR 0065 (samtykket er kontraktens; afkrydsningen er væk).
    ToS/privatlivsvilkår er stadig ejerens indhold — teksten på `/konto` var teknisk
    pladsholder. Forudsætning for at `FLAG_SMS` tændes i produktion.
  - TODO(ejer): skal navnet være påkrævet ved signup/onboarding (og dermed give `{{modtager_navn}}`
    til alle)? Indtil da er det frivilligt.
  - TODO(mads): inMobile-adapteren er stadig uverificeret live (ADR 0057); telefonnummeret sendes
    kun til inMobile når brugeren har angivet det (ADR 0065; `docs/gdpr/leverandoer-register.md`).
  - Sletning: kolonnerne forsvinder med `app_user`-rækken; hos inMobile skal nummeret slettes
    særskilt (`docs/gdpr/sletteflow.md`).
  - Navnet bruges ikke endnu til hilsner i `/dashboard` m.m. — en lille, selvstændig skive.
