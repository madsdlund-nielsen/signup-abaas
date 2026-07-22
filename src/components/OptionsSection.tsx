"use client";

import { useRef, useState } from "react";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { Checkbox } from "@/components/Checkbox";
import type { QuizOption } from "@/server/quiz";
import type { CompetenceTag } from "@/server/tags";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * Klient-liste over ét spørgsmåls svarmuligheder. Rækkefølge kan ændres med native HTML5-drag
 * (progressiv forbedring) ELLER op/ned-knapper (a11y-fallback). Begge persisterer via server-
 * actions (drag → reorderOptions bulk; op/ned → moveOption swap). Redigér/slet/tag-picker
 * bevarer det etablerede form-per-handling-mønster. Al styling via token-klasser.
 */
export function OptionsSection({
  questionId,
  options,
  tags,
  updateOption,
  deleteOption,
  moveOption,
  reorderOptions,
  setOptionTags,
}: {
  questionId: string;
  options: QuizOption[];
  tags: CompetenceTag[];
  updateOption: Action;
  deleteOption: Action;
  moveOption: Action;
  reorderOptions: Action;
  setOptionTags: Action;
}) {
  const [order, setOrder] = useState<QuizOption[]>(options);
  const dragIndex = useRef<number | null>(null);

  // Server-revalidering leverer en frisk options-prop (ny reference) → synk lokal rækkefølge under
  // render (Reacts anbefalede mønster frem for setState-i-effect). Interne drag-renders ændrer ikke
  // options-referencen, så lokal rækkefølge bevares mens man trækker.
  const [prevOptions, setPrevOptions] = useState<QuizOption[]>(options);
  if (options !== prevOptions) {
    setPrevOptions(options);
    setOrder(options);
  }

  function handleDragOver(event: React.DragEvent, targetIndex: number) {
    event.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === targetIndex) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    dragIndex.current = targetIndex;
  }

  async function persistOrder() {
    dragIndex.current = null;
    const formData = new FormData();
    formData.set("question_id", questionId);
    formData.set("order", orderRef.current.map((o) => o.id).join(","));
    await reorderOptions(formData);
  }

  if (order.length === 0) {
    return <p className="body">Ingen svarmuligheder endnu — tilføj den første nedenfor.</p>;
  }

  return (
    <ul className="stack">
      {order.map((option, index) => (
        <li
          key={option.id}
          className="option-item"
          onDragOver={(event) => handleDragOver(event, index)}
          onDrop={persistOrder}
        >
          <span className="row-form">
            <span
              className="drag-handle"
              draggable
              onDragStart={() => {
                dragIndex.current = index;
              }}
              onDragEnd={() => {
                dragIndex.current = null;
              }}
              role="button"
              aria-label="Træk for at ændre rækkefølge"
              title="Træk for at ændre rækkefølge"
            >
              ⠿
            </span>
            <span className="body">{option.label}</span>
          </span>

          <form className="row-form" action={updateOption}>
            <input type="hidden" name="id" value={option.id} />
            <input type="hidden" name="question_id" value={questionId} />
            <Field name="label" label="Etiket" defaultValue={option.label} required />
            <Select name="kind" label="Type" defaultValue={option.kind}>
              <option value="tag">Kompetence-tag</option>
              <option value="free_text">Fritekst</option>
              <option value="frequency">Frekvens</option>
            </Select>
            <Field
              name="frequency_weeks"
              label="Uger (kun frekvens)"
              type="number"
              min={1}
              defaultValue={option.frequencyWeeks ?? undefined}
            />
            <button className="btn-secondary" type="submit">
              Gem
            </button>
          </form>

          <span className="row-form">
            <form action={moveOption}>
              <input type="hidden" name="id" value={option.id} />
              <input type="hidden" name="question_id" value={questionId} />
              <input type="hidden" name="direction" value="up" />
              <button className="btn-secondary" type="submit" aria-label="Flyt svarmulighed op">
                ↑
              </button>
            </form>
            <form action={moveOption}>
              <input type="hidden" name="id" value={option.id} />
              <input type="hidden" name="question_id" value={questionId} />
              <input type="hidden" name="direction" value="down" />
              <button className="btn-secondary" type="submit" aria-label="Flyt svarmulighed ned">
                ↓
              </button>
            </form>
            <form action={deleteOption}>
              <input type="hidden" name="id" value={option.id} />
              <input type="hidden" name="question_id" value={questionId} />
              <button className="btn-secondary" type="submit">
                Slet
              </button>
            </form>
          </span>

          {option.kind === "tag" && (
            <form action={setOptionTags}>
              <input type="hidden" name="option_id" value={option.id} />
              <input type="hidden" name="question_id" value={questionId} />
              <p className="field__label">Kompetence-tags for denne svarmulighed</p>
              {tags.length === 0 ? (
                <p className="body">Ingen kompetence-tags oprettet endnu.</p>
              ) : (
                <div className="checkbox-group">
                  {tags.map((tag) => (
                    <Checkbox
                      key={tag.id}
                      name="tag"
                      value={tag.id}
                      label={tag.label}
                      defaultChecked={option.competenceTagIds.includes(tag.id)}
                    />
                  ))}
                </div>
              )}
              <button className="btn-secondary" type="submit">
                Gem tags
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}
