import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";
import { getCurrentUser } from "@/server/auth";
import { listPublishedQuestions } from "@/server/quiz";
import { getMyAnswers } from "@/server/quiz/answers";
import { saveMyAnswers } from "@/server/quiz/answer-actions";
import { OnboardingFlow } from "@/components/OnboardingFlow";

export const metadata: Metadata = {
  title: "Onboarding — Advisory Board Unlimited",
};

// Session- + RLS-afhængig — aldrig statisk prerender.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ejer")) redirect("/dashboard");

  const [questions, initialAnswers] = await Promise.all([listPublishedQuestions(), getMyAnswers()]);

  if (questions.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow={
            <>
              <Link href="/dashboard">Dashboard</Link> · Onboarding
            </>
          }
          title="Onboarding"
        />
        <PageBody>
          <p className="empty">
            Quizzen er ikke offentliggjort endnu, så der er ikke noget at besvare. En administrator
            udgiver den, og så kan du komme i gang.
          </p>
          <p className="body">
            <Link href="/dashboard">Til dashboard</Link>
          </p>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/dashboard">Dashboard</Link> · Onboarding
          </>
        }
        title="Fortæl hvor det gør ondt"
        lead="Dine svar oversættes til de kompetencer dit board skal dække. Du kan altid vende tilbage og ændre dem."
      />
      <PageBody>
        <OnboardingFlow
          questions={questions}
          initialAnswers={initialAnswers}
          action={saveMyAnswers}
        />
      </PageBody>
    </>
  );
}
