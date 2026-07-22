import Link from "next/link";
import type { Metadata } from "next";
import { listQuestions } from "@/server/quiz";
import { createQuestion, deleteQuestion, moveQuestion } from "@/server/quiz/actions";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { PrimaryButton } from "@/components/PrimaryButton";

export const metadata: Metadata = { title: "Quiz — Admin" };

// Læser session-afhængige data (RLS) — dynamisk.
export const dynamic = "force-dynamic";

const KIND_LABEL = { single: "Enkelt-valg", multi: "Multi-valg" } as const;

export default async function AdminQuizPage() {
  const questions = await listQuestions();

  return (
    <main className="container stack">
      <p className="eyebrow">
        <Link href="/admin">Admin</Link> · Quiz
      </p>
      <h1 className="heading-2 heading--on-light">Quiz-spørgsmål</h1>
      <p className="body">
        Admin forfatter quizzen. Svarmuligheder og kompetence-tag-mapping tilføjes pr. spørgsmål.
      </p>

      <form className="form measure" action={createQuestion}>
        <TextArea name="prompt" label="Nyt spørgsmål (tekst)" required />
        <Select name="kind" label="Type" defaultValue="multi">
          <option value="single">Enkelt-valg</option>
          <option value="multi">Multi-valg</option>
        </Select>
        <Field name="sort_order" label="Sortering" type="number" defaultValue={questions.length + 1} />
        <PrimaryButton type="submit">Opret spørgsmål</PrimaryButton>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th className="table__head">Spørgsmål</th>
            <th className="table__head">Type</th>
            <th className="table__head">Status</th>
            <th className="table__head">Handling</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => (
            <tr key={q.id} className="table__row">
              <td className="table__cell">{q.prompt}</td>
              <td className="table__cell">{KIND_LABEL[q.kind]}</td>
              <td className="table__cell">{q.isPublished ? "Publiceret" : "Kladde"}</td>
              <td className="table__cell">
                <span className="row-form">
                  <Link className="btn-secondary" href={`/admin/quiz/${q.id}`}>
                    Redigér
                  </Link>
                  <form action={moveQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button className="btn-secondary" type="submit" aria-label="Flyt op">
                      ↑
                    </button>
                  </form>
                  <form action={moveQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button className="btn-secondary" type="submit" aria-label="Flyt ned">
                      ↓
                    </button>
                  </form>
                  <form action={deleteQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <button className="btn-secondary" type="submit">
                      Slet
                    </button>
                  </form>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
