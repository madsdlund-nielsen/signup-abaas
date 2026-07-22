"use client";

import { useState } from "react";
import { TextArea } from "@/components/TextArea";
import { Select } from "@/components/Select";
import { PrimaryButton } from "@/components/PrimaryButton";
import { QuizRenderer } from "@/components/QuizRenderer";
import type { QuizRendererKind, QuizRendererOption } from "@/components/QuizRenderer";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * Redigér-formular for ét spørgsmål MED live "preview inden gem" (eksplicit ejer-krav). Prompt og
 * type holdes i lokal state, så preview'et opdateres mens admin skriver — endnu før der gemmes.
 * Options kommer fra allerede gemte data. Preview'et bruger QuizRenderer = samme visning ejeren
 * møder i 1.3. Server-action (updateQuestion) sendes ind som prop; de controlled felter bevarer
 * name, så FormData er uændret.
 */
export function QuestionPreviewForm({
  action,
  questionId,
  initialPrompt,
  initialKind,
  initialPublished,
  options,
}: {
  action: Action;
  questionId: string;
  initialPrompt: string;
  initialKind: QuizRendererKind;
  initialPublished: boolean;
  options: QuizRendererOption[];
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [kind, setKind] = useState<QuizRendererKind>(initialKind);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="stack">
      <form className="form measure" action={action}>
        <input type="hidden" name="id" value={questionId} />
        <TextArea
          name="prompt"
          label="Spørgsmålstekst"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          required
        />
        <Select
          name="kind"
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value as QuizRendererKind)}
        >
          <option value="single">Enkelt-valg</option>
          <option value="multi">Multi-valg</option>
        </Select>
        <div className="field">
          <label className="field__label" htmlFor="is_published">
            Publiceret (synlig for ejere)
          </label>
          <input
            type="checkbox"
            name="is_published"
            id="is_published"
            defaultChecked={initialPublished}
          />
        </div>
        <PrimaryButton type="submit">Gem</PrimaryButton>
      </form>

      <button
        className="btn-secondary"
        type="button"
        aria-expanded={showPreview}
        onClick={() => setShowPreview((value) => !value)}
      >
        {showPreview ? "Skjul preview" : "Vis preview (inden gem)"}
      </button>

      {showPreview && (
        <div className="band band--grey">
          <div className="band__inner">
            <QuizRenderer question={{ prompt, kind, options }} />
          </div>
        </div>
      )}
    </div>
  );
}
