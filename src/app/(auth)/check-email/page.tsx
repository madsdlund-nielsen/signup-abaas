import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tjek din e-mail — Advisory Board Unlimited" };

export default function CheckEmailPage() {
  return (
    <main className="container">
      <div className="auth-card stack">
        <p className="eyebrow">Advisory Board Unlimited</p>
        <h1 className="heading-3 heading--on-light">Tjek din e-mail</h1>
        <p className="body">
          Vi har sendt dig et bekræftelseslink. Åbn det for at aktivere din konto — så kan du logge
          ind.
        </p>
        <p className="form__alt">
          Bekræftet allerede? <Link href="/login">Log ind</Link>
        </p>
      </div>
    </main>
  );
}
