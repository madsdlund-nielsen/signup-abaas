import Image from "next/image";
import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Field } from "@/components/Field";
import { submitGate } from "@/server/gate/actions";

export const metadata: Metadata = {
  title: "Adgang — Advisory Board Unlimited",
};
export const dynamic = "force-dynamic";

/**
 * Adgangsport-skærm (ADR 0020): én delt adgangskode før auth under den lukkede ejer-test.
 * Genbruger AuthForm/Field/token-klasser — ingen ny styling.
 */
export default function GatePage() {
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
          <h1 className="heading-2 heading--on-light">Adgang</h1>
          <p className="body">
            Denne test-adgang er beskyttet. Indtast adgangskoden for at fortsætte.
          </p>
          <AuthForm action={submitGate} submitLabel="Fortsæt">
            <Field name="password" label="Adgangskode" type="password" required />
          </AuthForm>
        </div>
      </div>
    </main>
  );
}
