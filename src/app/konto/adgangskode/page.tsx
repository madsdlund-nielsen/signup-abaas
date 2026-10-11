import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { getCurrentUser } from "@/server/auth";
import { setPasswordAction } from "@/server/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password-policy";

export const metadata: Metadata = { title: "Vælg adgangskode — Advisory Board Unlimited" };
export const dynamic = "force-dynamic";

/**
 * «Sæt adgangskode» (B-70, ADR 0073). Landingssiden efter invitations- og nulstillingslinks
 * (/auth/confirm), og også en almindelig «skift adgangskode» for en indlogget bruger. Kræver
 * en session; uden en sendes brugeren til login med en forklaring.
 */
export default async function SetPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?fejl=ny-adgangskode");

  return (
    <main id="main" className="focus-page">
      <div className="focus-page__inner">
        <Image
          className="focus-page__mark"
          src="/brand/abu-mark-01-light-on-dark.svg"
          alt="Advisory Board Unlimited"
          width={96}
          height={96}
          priority
        />
        <div className="panel stack">
          <h1 className="heading-3 heading--on-light">Vælg adgangskode</h1>
          <p className="body">
            Du er logget ind som {user.email}. Vælg en adgangskode, du kan bruge næste gang du logger ind.
          </p>
          <AuthForm
            action={setPasswordAction}
            submitLabel="Gem adgangskode"
            alt={<Link href="/konto">Tilbage til din konto</Link>}
          >
            <Field
              name="password"
              label="Ny adgangskode"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
            />
            <Field
              name="repeat"
              label="Gentag adgangskode"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
            />
          </AuthForm>
        </div>
      </div>
    </main>
  );
}
