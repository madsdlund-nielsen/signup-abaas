import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { signUpAction } from "@/server/auth/actions";

export const metadata: Metadata = { title: "Opret konto — Advisory Board Unlimited" };

export default function SignupPage() {
  return (
    <main className="container">
      <div className="auth-card stack">
        <p className="eyebrow">Advisory Board Unlimited</p>
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
    </main>
  );
}
