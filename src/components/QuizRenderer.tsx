"use client";

import { useState } from "react";

/**
 * Præsentations-renderer for ét quiz-spørgsmål i EJER-look (firkantede, store, flade svarknapper
 * jf. designnoter). Bruges både til admin-preview "inden gem" (Fase 1.2) og i ejer-flowet
 * (Fase 1.3) — dermed er preview == produktion. Al styling via token-klasser (.quiz*).
 *
 * Valg-state er valgfrit KONTROLLERET: uden `selected`/`onToggle` styrer komponenten selv (admin-
 * preview, ren visning); med dem ejer forælderen valgene (ejer-flowet, der persisterer). Tilsvarende
 * er free_text redigerbar når `onFreeText` gives, ellers readOnly (preview).
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

export function QuizRenderer({
  question,
  selected: controlledSelected,
  onToggle,
  freeText,
  onFreeText,
  ariaLabel = "Preview af spørgsmål",
}: {
  question: QuizRendererQuestion;
  selected?: string[];
  onToggle?: (id: string) => void;
  freeText?: Record<string, string>;
  onFreeText?: (id: string, value: string) => void;
  ariaLabel?: string;
}) {
  const [internalSelected, setInternalSelected] = useState<string[]>([]);
  const selected = controlledSelected ?? internalSelected;

  function toggle(id: string) {
    if (onToggle) {
      onToggle(id);
      return;
    }
    setInternalSelected((current) => {
      if (question.kind === "single") return current.includes(id) ? [] : [id];
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    });
  }

  return (
    <section className="quiz" aria-label={ariaLabel}>
      <h3 className="quiz__prompt">{question.prompt || "Spørgsmålstekst mangler"}</h3>
      {question.options.length === 0 ? (
        <p className="body">Ingen svarmuligheder endnu.</p>
      ) : (
        <div className="quiz__options">
          {question.options.map((option) =>
            option.kind === "free_text" ? (
              <label key={option.id} className="field quiz__freetext">
                <span className="field__label">{option.label}</span>
                <input
                  className="field__input"
                  type="text"
                  placeholder={option.label}
                  value={onFreeText ? (freeText?.[option.id] ?? "") : undefined}
                  onChange={onFreeText ? (event) => onFreeText(option.id, event.target.value) : undefined}
                  readOnly={!onFreeText}
                />
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
