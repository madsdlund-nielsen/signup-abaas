import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { signUpAction } from "@/server/auth/actions";

export const metadata: Metadata = {
  title: "Opret konto — Advisory Board Unlimited",
};

export default function SignupPage() {
  return (
    <main className="focus-page">
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
          <h1 className="heading-3 heading--on-light">Opret konto</h1>
          <AuthForm
            action={signUpAction}
            submitLabel="Opret konto"
            alt={
              <>
                Har du allerede en konto? <Link href="/login">Log ind</Link>
              </>
            }
          >
            <Field name="email" label="E-mail" type="email" autoComplete="email" required />
            <Field
              name="password"
              label="Adgangskode"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </AuthForm>
        </div>
      </div>
    </main>
  );
}
