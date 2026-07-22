import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getQuestion } from "@/server/quiz";
import { updateQuestion } from "@/server/quiz/actions";
import { TextArea } from "@/components/TextArea";
import { Select } from "@/components/Select";
import { PrimaryButton } from "@/components/PrimaryButton";

export const metadata: Metadata = { title: "Redigér spørgsmål — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminQuizQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const question = await getQuestion(id);
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

      <p className="body">
        Svarmuligheder og kompetence-tag-mapping tilføjes her i næste trin (PR 2).
      </p>
    </main>
  );
}
