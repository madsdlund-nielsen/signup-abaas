import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
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
 * Kontoprofilen (skive K, ADR 0061): navn, telefon og tidszone. Åben for alle indloggede
 * roller — det er KONTOENS navn, ikke partnerens katalogprofil (`/partner`).
 *
 * Hvad felterne bruges til står på siden, så ingen afgiver et nummer uden at vide til hvad.
 * Der er ingen afkrydsning til SMS: samtykke til SMS, optagelse og AI er en del af kontrakten
 * (Mads, 2026-10-11, ADR 0065), og platformen har ingen opt-in/out. Et nummer er nok til at få SMS.
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
        lead="Dit navn, dit telefonnummer og din tidszone. Navnet og tidszonen bruges, når du bookes til et møde; telefonnummeret bruges til SMS-påmindelser om dine møder."
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
            </AuthForm>
          ) : (
            <p className="form__notice" role="status">
              Din konto kunne ikke læses lige nu. Prøv igen om lidt.
            </p>
          )}
        </section>

        <p className="body">
          <Link href="/konto/adgangskode">Skift adgangskode</Link>
        </p>
        <p className="body">
          <Link href="/dashboard">Til dashboardet</Link>
        </p>
      </PageBody>
    </>
  );
}
