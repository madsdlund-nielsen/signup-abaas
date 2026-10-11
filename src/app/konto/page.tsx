import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { Checkbox } from "@/components/Checkbox";
import { Field } from "@/components/Field";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Select } from "@/components/Select";
import { getMyAccount } from "@/server/account";
import { saveAccountProfile } from "@/server/account/actions";
import { DEFAULT_TIME_ZONE, DISPLAY_NAME_MAX, timeZoneChoices } from "@/server/account/validation";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Konto — Advisory Board Unlimited" };
export const dynamic = "force-dynamic";

/**
 * Kontoprofilen (skive K, ADR 0061): navn, telefon, tidszone og SMS-samtykke. Åben for alle
 * indloggede roller — det er KONTOENS navn, ikke partnerens katalogprofil (`/partner`).
 *
 * Hvad felterne bruges til står på siden, så ingen afgiver et nummer uden at vide til hvad.
 * Samtykket til SMS er en eksplicit, aldrig forudafkrydset afkrydsning for nye konti; en
 * allerede givet tilladelse vises afkrydset, fordi den afspejler brugerens eget valg.
 *
 * TODO(ejer): samtykketeksten og privatlivsvilkår (ToS) — teksten nedenfor er teknisk
 * pladsholder, ikke godkendt juridisk ordlyd.
 */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const account = await getMyAccount();
  const timeZone = account?.timeZone ?? DEFAULT_TIME_ZONE;

  return (
    <>
      <PageHeader
        eyebrow="Konto"
        title="Din konto"
        lead="Dit navn, dit telefonnummer og din tidszone. Navnet og tidszonen bruges, når du bookes til et møde; telefonnummeret kun hvis du siger ja til SMS."
      />
      <PageBody>
        <section className="panel measure">
          <h2 className="heading-3 heading--on-light">Om dig</h2>
          <p className="body">Logget ind som {user.email}.</p>

          {account ? (
            <AuthForm action={saveAccountProfile} submitLabel="Gem konto">
              <Field
                name="display_name"
                label="Navn"
                autoComplete="name"
                maxLength={DISPLAY_NAME_MAX}
                defaultValue={account.displayName ?? ""}
              />
              <p className="body">
                Vises for dine rådgivere i mødeinvitationen. Har du ikke angivet et navn, bruges
                din e-mailadresse.
              </p>

              <Select name="time_zone" label="Tidszone" defaultValue={timeZone}>
                {timeZoneChoices(timeZone).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <Field
                name="phone"
                label="Telefonnummer"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+45 12 34 56 78"
                defaultValue={account.phone ?? ""}
              />
              <p className="body">
                Danske numre kan skrives med otte cifre — vi sætter +45 foran. Til udlandet skrives
                landekoden med +.
              </p>

              <div className="stack">
                <Checkbox
                  name="sms_opt_in"
                  value="on"
                  label="Ja tak, send mig SMS om mine møder."
                  defaultChecked={account.smsOptIn}
                />
                <p className="body">
                  Med et flueben giver du os lov til at bruge nummeret i feltet ovenfor til
                  SMS-påmindelser og -bedømmelse af dine møder. Nummeret bruges ikke til
                  markedsføring. Fjerner du fluebenet, sendes der ingen flere SMS. Uden flueben
                  gemmer vi nummeret, men sender intet til det.
                </p>
                {account.smsOptIn && account.smsOptInAt ? (
                  <p className="body">
                    Du sagde ja til SMS{" "}
                    {new Intl.DateTimeFormat("da-DK", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone,
                    }).format(new Date(account.smsOptInAt))}
                    .
                  </p>
                ) : null}
              </div>
            </AuthForm>
          ) : (
            <p className="form__notice" role="status">
              Din konto kunne ikke læses lige nu. Prøv igen om lidt.
            </p>
          )}
        </section>

        <p className="body">
          <Link href="/dashboard">Til dashboardet</Link>
        </p>
      </PageBody>
    </>
  );
}
