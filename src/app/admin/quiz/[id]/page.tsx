import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getQuestionDetail } from "@/server/quiz";
import type { QuizOption } from "@/server/quiz";
import {
  createOption,
  deleteOption,
  moveOption,
  setOptionTags,
  updateOption,
  updateQuestion,
} from "@/server/quiz/actions";
import { listTags } from "@/server/tags";
import type { CompetenceTag } from "@/server/tags";
import { Field } from "@/components/Field";
import { TextArea } from "@/components/TextArea";
import { Select } from "@/components/Select";
import { Checkbox } from "@/components/Checkbox";
import { PrimaryButton } from "@/components/PrimaryButton";

export const metadata: Metadata = { title: "Redigér spørgsmål — Admin" };
export const dynamic = "force-dynamic";

function OptionItem({
  option,
  questionId,
  tags,
}: {
  option: QuizOption;
  questionId: string;
  tags: CompetenceTag[];
}) {
  return (
    <li className="option-item">
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
  );
}

export default async function AdminQuizQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [question, tags] = await Promise.all([getQuestionDetail(id), listTags()]);
  if (!question) notFound();

  return (
    <main className="container stack">
      <p className="eyebrow">
        <Link href="/admin">Admin</Link> · <Link href="/admin/quiz">Quiz</Link> · Redigér
      </p>
      <h1 className="heading-2 heading--on-light">Redigér spørgsmål</h1>

      <form className="form measure" action={updateQuestion}>
        <input type="hidden" name="id" value={question.id} />
        <TextArea name="prompt" label="Spørgsmålstekst" defaultValue={question.prompt} required />
        <Select name="kind" label="Type" defaultValue={question.kind}>
          <option value="single">Enkelt-valg</option>
          <option value="multi">Multi-valg</option>
        </Select>
        <div className="field">
          <label className="field__label" htmlFor="is_published">
            Publiceret (synlig for ejere)
          </label>
          <input type="checkbox" name="is_published" id="is_published" defaultChecked={question.isPublished} />
        </div>
        <PrimaryButton type="submit">Gem</PrimaryButton>
      </form>

      <h2 className="heading-3 heading--on-light">Svarmuligheder</h2>
      {question.options.length === 0 ? (
        <p className="body">Ingen svarmuligheder endnu — tilføj den første nedenfor.</p>
      ) : (
        <ul className="stack">
          {question.options.map((option) => (
            <OptionItem key={option.id} option={option} questionId={question.id} tags={tags} />
          ))}
        </ul>
      )}

      <form className="form measure" action={createOption}>
        <input type="hidden" name="question_id" value={question.id} />
        <Field name="label" label="Ny svarmulighed (etiket)" required />
        <Select name="kind" label="Type" defaultValue="tag">
          <option value="tag">Kompetence-tag</option>
          <option value="free_text">Fritekst</option>
          <option value="frequency">Frekvens</option>
        </Select>
        <Field name="frequency_weeks" label="Uger (kun frekvens)" type="number" min={1} />
        <Field
          name="sort_order"
          label="Sortering"
          type="number"
          defaultValue={question.options.length + 1}
        />
        <PrimaryButton type="submit">Tilføj svarmulighed</PrimaryButton>
      </form>
    </main>
  );
}
