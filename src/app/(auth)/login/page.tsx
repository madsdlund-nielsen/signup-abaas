import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { signInAction } from "@/server/auth/actions";
import { loginErrorMessage } from "@/server/auth/confirm";

export const metadata: Metadata = {
  title: "Log ind — Advisory Board Unlimited",
};

// `?fejl=<kode>` kommer fra /auth/confirm; læses pr. request.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ fejl?: string }> }) {
  // Koden slås op i en lukket liste — den rå parameter gengives aldrig.
  const linkError = loginErrorMessage((await searchParams).fejl);

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
          <h1 className="heading-3 heading--on-light">Log ind</h1>
          {linkError ? (
            <p className="form__notice" role="alert">
              {linkError}
            </p>
          ) : null}
          <AuthForm
            action={signInAction}
            submitLabel="Log ind"
            alt={
              <>
                Har du ingen konto? <Link href="/signup">Opret konto</Link>
                <br />
                <Link href="/glemt-adgangskode">Glemt adgangskode?</Link>
              </>
            }
          >
            <Field name="email" label="E-mail" type="email" autoComplete="email" required />
            <Field
              name="password"
              label="Adgangskode"
              type="password"
              autoComplete="current-password"
              required
            />
          </AuthForm>
        </div>
      </div>
    </main>
  );
}
