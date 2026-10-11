import type { RenderResult, Segment } from "@/server/notifications/render";

/**
 * Preview af en renderet skabelon (fase 4.6): præcis det `renderTemplate` ville sende, med
 * hver slags stykke markeret for sig — flettede værdier med en guld-understregning, og alt der
 * ville forhindre en udsendelse (ukendt variabel, manglende værdi, ugyldig syntaks) som et
 * fyldt guldfelt, så det ikke kan overses og aldrig står som et stille tomt felt.
 *
 * Ren præsentation: samme komponent bruges af editorens live preview og af den læsbare
 * visning af den live version. Al styling via token-klasser.
 */

function problemTitle(segment: Segment): string | undefined {
  switch (segment.kind) {
    case "unknown":
      return `Ukendt variabel «${segment.name}»`;
    case "missing":
      return `Ingen værdi til «${segment.name}»`;
    case "invalid":
      return "Ugyldig variabel-syntaks";
    default:
      return undefined;
  }
}

function Segments({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
        if (segment.kind === "value") {
          return (
            <span key={index} className="preview__value" title={`{{${segment.name}}}`}>
              {segment.text}
            </span>
          );
        }
        return (
          <mark key={index} className="preview__problem" title={problemTitle(segment)}>
            {segment.raw}
          </mark>
        );
      })}
    </>
  );
}

export function TemplatePreview({
  result,
  channel,
}: {
  result: RenderResult;
  channel: "email" | "sms";
}) {
  return (
    <div className="preview">
      {channel === "email" && result.segments.subject ? (
        <p className="preview__subject">
          <span className="preview__label">Emne</span>
          <Segments segments={result.segments.subject} />
        </p>
      ) : null}

      <p className="preview__body">
        <Segments segments={result.segments.body} />
      </p>

      {channel === "sms" ? (
        <p className="preview__meta">{result.text.length} tegn</p>
      ) : null}

      {result.problems.length > 0 ? (
        <ul className="preview__problems" role="alert">
          {result.problems.map((problem, index) => (
            <li key={index}>{problem.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
