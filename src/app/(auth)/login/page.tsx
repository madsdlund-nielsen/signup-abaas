import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { signInAction } from "@/server/auth/actions";

export const metadata: Metadata = { title: "Log ind — Advisory Board Unlimited" };

export default function LoginPage() {
  return (
    <main className="container">
      <div className="auth-card stack">
        <p className="eyebrow">Advisory Board Unlimited</p>
        <h1 className="heading-3 heading--on-light">Log ind</h1>
        <AuthForm
          action={signInAction}
          submitLabel="Log ind"
          alt={
            <>
              Har du ingen konto? <Link href="/signup">Opret konto</Link>
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
    </main>
  );
}
