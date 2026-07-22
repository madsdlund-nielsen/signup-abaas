"use client";

import { useState } from "react";

/**
 * Præsentations-renderer for ét quiz-spørgsmål i EJER-look (firkantede, store, flade svarknapper
 * jf. designnoter). Bruges både til admin-preview "inden gem" (Fase 1.2) og senere i ejer-flowet
 * (Fase 1.3) — dermed er preview == produktion. Ren visning: valg-state er lokal og præsentational
 * (ingen persistering her). Al styling via token-klasser (.quiz*).
 */

export type QuizRendererKind = "single" | "multi";

export interface QuizRendererOption {
  id: string;
  label: string;
  kind: "tag" | "free_text" | "frequency";
  frequencyWeeks?: number | null;
}

export interface QuizRendererQuestion {
  prompt: string;
  kind: QuizRendererKind;
  options: QuizRendererOption[];
}

function optionText(option: QuizRendererOption): string {
  if (option.kind === "frequency" && option.frequencyWeeks) {
    return `Hver ${option.frequencyWeeks}. uge`;
  }
  return option.label;
}

export function QuizRenderer({ question }: { question: QuizRendererQuestion }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    setSelected((current) => {
      if (question.kind === "single") return current.includes(id) ? [] : [id];
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });
  }

  return (
    <section className="quiz" aria-label="Preview af spørgsmål">
      <h3 className="quiz__prompt">{question.prompt || "Spørgsmålstekst mangler"}</h3>
      {question.options.length === 0 ? (
        <p className="body">Ingen svarmuligheder endnu.</p>
      ) : (
        <div className="quiz__options">
          {question.options.map((option) =>
            option.kind === "free_text" ? (
              <label key={option.id} className="field quiz__freetext">
                <span className="field__label">{option.label}</span>
                <input className="field__input" type="text" placeholder={option.label} readOnly />
              </label>
            ) : (
              <button
                key={option.id}
                type="button"
                className={
                  selected.includes(option.id)
                    ? "quiz__option quiz__option--selected"
                    : "quiz__option"
                }
                aria-pressed={selected.includes(option.id)}
                onClick={() => toggle(option.id)}
              >
                {optionText(option)}
              </button>
            ),
          )}
        </div>
      )}
    </section>
  );
}
