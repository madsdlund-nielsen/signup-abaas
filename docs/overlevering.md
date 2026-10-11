# Overlevering til Andreas og Mette

*Én side. Platformen er bygget og kan klikkes igennem; det der mangler er jeres beslutninger og de rigtige konti. Launch er sat til januar 2027.*

## Hvad platformen kan i dag

- **Ejeren** tilmelder sig, tager quizzen, får anbefalet et board på to-tre rådgivere, booker møder, forbereder sig og vurderer mødet bagefter.
- **Rådgiveren** redigerer sin egen profil, angiver hvornår vedkommende kan, og ser sit honorar for hvert møde.
- **Jer som admin** styrer rådgiverkataloget, quizzen, kompetencerne, boardsammensætningen, priser, honorar og teksten i alle beskeder – og ser driften på ét sted.
- **Ét sted at se, hvor langt vi er:** *Admin → Klar til launch*. Siden bliver grøn, når intet blokerer.

Alt det der skal tale med omverdenen – booking, betaling, mail, SMS, AI-referat – er bygget, men kører indtil videre med dummy-svar, fordi de rigtige konti ikke er oprettet. Dummy-data er tydeligt mærket og må ikke være tændt, når vi går i luften.

## Det venter på jer: beslutninger

**Skal være på plads før launch**
- Vilkår og honoraraftale – skal også dække, at møder optages, og at AI og SMS bruges.
- Domænet signupacademy.com, og at Mads får adgang til at pege det på platformen.

**Penge**
- Mødepris og startpris. Uden dem kan ingen få et abonnement.
- Honorarsats pr. rådgiver pr. møde. Uden den beregnes intet honorar.
- Moms på honoraret, og hvad rådgiveren får ved udeblivelse eller sent afbud.
- Regnskabssystem: e-conomic eller Dinero.
- Hvad en fejlet betaling betyder, og hvad der sker ved opsigelse midt i en periode.

**Hverdagens regler**
- Hvor sent må et møde flyttes eller aflyses?
- Hvornår skal påmindelsen om mødet sendes, og hvornår anmodningen om at vurdere det? Hvor længe skal vurderingslinket virke?
- Hvem vælger boardets lead, og efter hvilke regler skifter det?
- Hvem vælges, når to rådgivere passer lige godt til en ejer?
- Hvem må se mødenoter? Hvornår slutter et board?
- Skal der være beskeder inde i platformen, og skal der kunne tages noter under mødet? (Ikke bygget, før I siger ja.)

## Det venter på konti og nøgler

I opretter kontoerne og giver Mads adgang; han kobler dem på. Kontoerne er: databasen (Supabase), hosting (Netlify, betalt plan så serveren ligger i EU), booking og video (Cal.com), betaling (Alunta med QuickPay, og en aftale med Nets om kortgebyrer), AI-referat (Ordbogen), mail (Resend), SMS (inMobile), statistik (PostHog) og regnskab. Faste omkostninger er et overslag på cirka 2.000 kr. om måneden med 10 rådgivere i kataloget og cirka 4.300 kr. med 40 – uden Ordbogen og kortgebyrer, hvis pris først kendes, når aftalen er lavet. Listen med præcis hvad der skal oprettes ligger i `docs/accounts-to-create.md`.

Mads skal desuden bekræfte to ting hos leverandørerne: at booking-løsningen opbevarer data i EU, og at den kan optage møderne. Det afgør, om AI-referatet kan tændes.

## Hvem har adgang til hvad

Ejere ser kun deres eget board. Rådgivere ser kun deres egne møder, deres egen profil og deres eget honorar. Admin ser alt. Adgangen er sikret i selve databasen, ikke kun på skærmen.

## Sådan kommer I i gang

1. Log ind som admin og åbn **Klar til launch**. Her står, hvad der blokerer, og hvem der skal handle.
2. Tag stilling til beslutningerne ovenfor. Priser, honorar og beskedtekster lægger I selv ind under *Prisregler*, *Honorar* og *Notifikationer*; Mads hjælper med resten.
3. Opret kontoerne, og giv Mads nøglerne. Han kobler dem på én ad gangen og tjekker siden bagefter.
4. Afprøv rejsen med en testejer og en testrådgiver, før de første rigtige kunder inviteres.
5. Når siden **Klar til launch** viser, at intet blokerer, kan vi gå i luften.

**Hvis noget går i stykker:** åbn *Admin → Drift* og *Klar til launch*, og kontakt Mads. Fejlscenarierne og hvad man gør står i `docs/runbook.md`.
