import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/server/auth";
import { listPublishedQuestions } from "@/server/quiz";
import { getMyAnswers } from "@/server/quiz/answers";
import { saveMyAnswers } from "@/server/quiz/answer-actions";
import { OnboardingFlow } from "@/components/OnboardingFlow";

export const metadata: Metadata = { title: "Onboarding — Advisory Board Unlimited" };

// Session- + RLS-afhængig — aldrig statisk prerender.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ejer")) redirect("/dashboard");

  const [questions, initialAnswers] = await Promise.all([listPublishedQuestions(), getMyAnswers()]);

  if (questions.length === 0) {
    return (
      <main className="container stack">
        <p className="eyebrow">Advisory Board Unlimited</p>
        <h1 className="heading-2 heading--on-light">Onboarding</h1>
        <p className="body">Quizzen er ikke klar endnu. Kom tilbage om lidt.</p>
        <p className="body">
          <Link href="/dashboard">Til dashboard</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="container stack">
      <p className="eyebrow">Advisory Board Unlimited</p>
      <OnboardingFlow questions={questions} initialAnswers={initialAnswers} action={saveMyAnswers} />
    </main>
  );
}
