import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";
import { getQuestionDetail } from "@/server/quiz";
import {
  createOption,
  deleteOption,
  moveOption,
  reorderOptions,
  setOptionTags,
  updateOption,
  updateQuestion,
} from "@/server/quiz/actions";
import { listTags } from "@/server/tags";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { PrimaryButton } from "@/components/PrimaryButton";
import { OptionsSection } from "@/components/OptionsSection";
import { QuestionPreviewForm } from "@/components/QuestionPreviewForm";

export const metadata: Metadata = { title: "Redigér spørgsmål — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminQuizQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [question, tags] = await Promise.all([getQuestionDetail(id), listTags()]);
  if (!question) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · <Link href="/admin/quiz">Quiz</Link> · Redigér
          </>
        }
        title="Redigér spørgsmål"
        lead="Spørgsmålstekst, svarmuligheder og deres kobling til kompetence-tags. Forhåndsvisningen viser hvad ejeren møder."
      />
      <PageBody>
        <QuestionPreviewForm
          action={updateQuestion}
          questionId={question.id}
          initialPrompt={question.prompt}
          initialKind={question.kind}
          initialPublished={question.isPublished}
          options={question.options.map((option) => ({
            id: option.id,
            label: option.label,
            kind: option.kind,
            frequencyWeeks: option.frequencyWeeks,
          }))}
        />

        <h2 className="heading-3 heading--on-light">Svarmuligheder</h2>
        <OptionsSection
          questionId={question.id}
          options={question.options}
          tags={tags}
          updateOption={updateOption}
          deleteOption={deleteOption}
          moveOption={moveOption}
          reorderOptions={reorderOptions}
          setOptionTags={setOptionTags}
        />

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
      </PageBody>
    </>
  );
}
