import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { requestPasswordResetAction } from "@/server/auth/actions";

export const metadata: Metadata = {
  title: "Glemt adgangskode — Advisory Board Unlimited",
};

export default function ForgotPasswordPage() {
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
          <h1 className="heading-3 heading--on-light">Glemt adgangskode</h1>
          <p className="body">
            Skriv den e-mailadresse du logger ind med, så sender vi et link til at vælge en ny
            adgangskode.
          </p>
          <AuthForm
            action={requestPasswordResetAction}
            submitLabel="Send link"
            alt={
              <>
                Kom du i tanke om den? <Link href="/login">Log ind</Link>
              </>
            }
          >
            <Field name="email" label="E-mail" type="email" autoComplete="email" required />
          </AuthForm>
        </div>
      </div>
    </main>
  );
}
