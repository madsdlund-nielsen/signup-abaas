"use client";

import { useMemo, useState } from "react";
import { QuizRenderer } from "@/components/QuizRenderer";
import type { QuizRendererOption } from "@/components/QuizRenderer";
import { PrimaryButton } from "@/components/PrimaryButton";
import type { QuizQuestionDetail } from "@/server/quiz";
import type { OwnerAnswer } from "@/server/quiz/answers";
import type { AnswerInput } from "@/server/quiz/answer-actions";

/**
 * Conversational ejer-onboarding (Fase 1.3): ét spørgsmål pr. skærm, progressindikator, blød
 * overgang, store firkantede touch-knapper (byggespec §5.2). Genbruger `QuizRenderer` i kontrolleret
 * tilstand, så preview == produktion. Samler svar lokalt og persisterer via `saveMyAnswers` (authed
 * klient + RLS). Ingen matching/anbefaling/pris her — kun kompetence-signalet fanges.
 */

type SaveAction = (selections: AnswerInput[]) => Promise<void>;

function toRendererOption(option: QuizQuestionDetail["options"][number]): QuizRendererOption {
  return { id: option.id, label: option.label, kind: option.kind, frequencyWeeks: option.frequencyWeeks };
}

export function OnboardingFlow({
  questions,
  initialAnswers,
  action,
}: {
  questions: QuizQuestionDetail[];
  initialAnswers: OwnerAnswer[];
  action: SaveAction;
}) {
  // optionId → { questionId, kind } for at fordele initial-svar til rette spørgsmål.
  const optionIndex = useMemo(() => {
    const map = new Map<string, { questionId: string; kind: string }>();
    for (const question of questions) {
      for (const option of question.options) {
        map.set(option.id, { questionId: question.id, kind: option.kind });
      }
    }
    return map;
  }, [questions]);

  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const answer of initialAnswers) {
      const entry = optionIndex.get(answer.optionId);
      if (entry && entry.kind !== "free_text") {
        (initial[entry.questionId] ??= []).push(answer.optionId);
      }
    }
    return initial;
  });
  const [freeTextByOption, setFreeTextByOption] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const answer of initialAnswers) {
      const entry = optionIndex.get(answer.optionId);
      if (entry && entry.kind === "free_text") initial[answer.optionId] = answer.freeText ?? "";
    }
    return initial;
  });

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = questions.length;
  const question = questions[step];

  function handleToggle(optionId: string) {
    setSelectedByQuestion((prev) => {
      const current = prev[question.id] ?? [];
      const next =
        question.kind === "single"
          ? current.includes(optionId)
            ? []
            : [optionId]
          : current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId];
      return { ...prev, [question.id]: next };
    });
  }

  function handleFreeText(optionId: string, value: string) {
    setFreeTextByOption((prev) => ({ ...prev, [optionId]: value }));
  }

  function isAnswered(q: QuizQuestionDetail): boolean {
    if ((selectedByQuestion[q.id] ?? []).length > 0) return true;
    return q.options.some(
      (option) => option.kind === "free_text" && (freeTextByOption[option.id] ?? "").trim().length > 0,
    );
  }

  function buildSelections(): AnswerInput[] {
    const result: AnswerInput[] = [];
    for (const q of questions) {
      for (const optionId of selectedByQuestion[q.id] ?? []) result.push({ optionId });
      for (const option of q.options) {
        if (option.kind === "free_text") {
          const text = (freeTextByOption[option.id] ?? "").trim();
          if (text) result.push({ optionId: option.id, freeText: text });
        }
      }
    }
    return result;
  }

  async function handleSubmit() {
    setPending(true);
    setError(null);
    try {
      await action(buildSelections());
      setDone(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Kunne ikke gemme dine svar.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <section className="onboarding stack">
        <h1 className="heading-2 heading--on-light">Tak</h1>
        <p className="body">
          Dine svar er gemt. Dit board sammensættes i næste trin ud fra de kompetencer, du valgte.
        </p>
        <a className="btn-secondary" href="/dashboard">
          Til dashboard
        </a>
      </section>
    );
  }

  const isLast = step === total - 1;
  const answered = isAnswered(question);

  return (
    <section className="onboarding stack">
      <div className="progress" role="group" aria-label="Fremskridt">
        <p className="progress__meta">
          Spørgsmål {step + 1} af {total}
        </p>
        <div className="progress__track">
          <div className="progress__bar" style={{ width: `${((step + 1) / total) * 100}%` }} />
        </div>
      </div>

      <div key={step} className="step-fade">
        <QuizRenderer
          question={{
            prompt: question.prompt,
            kind: question.kind,
            options: question.options.map(toRendererOption),
          }}
          selected={selectedByQuestion[question.id] ?? []}
          onToggle={handleToggle}
          freeText={freeTextByOption}
          onFreeText={handleFreeText}
          ariaLabel={`Spørgsmål ${step + 1} af ${total}`}
        />
      </div>

      {error ? (
        <p className="form__notice" role="alert">
          {error}
        </p>
      ) : null}

      <div className="onboarding__nav">
        <button
          className="btn-secondary"
          type="button"
          onClick={() => setStep((value) => value - 1)}
          disabled={step === 0 || pending}
        >
          Tilbage
        </button>
        {isLast ? (
          <PrimaryButton type="button" onClick={handleSubmit} disabled={!answered || pending}>
            {pending ? "Gemmer…" : "Gem svar"}
          </PrimaryButton>
        ) : (
          <PrimaryButton
            type="button"
            onClick={() => setStep((value) => value + 1)}
            disabled={!answered}
          >
            Videre
          </PrimaryButton>
        )}
      </div>
    </section>
  );
}
