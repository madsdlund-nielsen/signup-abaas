"use client";

import { useActionState, useRef, useState } from "react";

import { PrimaryButton } from "@/components/PrimaryButton";
import { StatusBadge } from "@/components/StatusBadge";
import { TemplatePreview } from "@/components/TemplatePreview";
import type { NotificationChannelKey, NotificationVariable } from "@/server/notifications/catalog";
import { renderTemplate } from "@/server/notifications/render";
import type { TemplateActionState } from "@/server/notifications/template-actions";
import {
  channelBadge,
  differsFromLive,
  type ChannelTemplateState,
  type TemplateVersion,
} from "@/server/notifications/template-state";

/**
 * Skabelon-editor med live preview (fase 4.6, ADR 0057) — én redigeringsflade pr. kanal.
 *
 * To eksplicitte krav styrer designet:
 *   1. LIVE PREVIEW: previewet rendres af den SAMME `renderTemplate` som motoren bruger,
 *      for hvert tastetryk, med åbenlyst falske eksempelværdier. Hvad man ser er hvad
 *      der ville blive sendt — og et problem (ukendt variabel) står markeret, aldrig tomt.
 *   2. LIVE vs. UDKAST: kanalens overskrift bærer altid et mærke for hvad der er i produktion
 *      og hvad der kun er et udkast, og en advarsel står der så længe de to afviger. Publicering
 *      er et to-trins valg ("Publicér…" → "Bekræft: gør live"), så det ikke sker ved et uheld.
 *
 * Alle handlinger er server-actions (props, så komponenten kan testes uden server).
 */

type Action = (prev: TemplateActionState, formData: FormData) => Promise<TemplateActionState>;

export interface TemplateEditorActions {
  save: Action;
  publish: Action;
  discard: Action;
}

export interface EditorChannel {
  label: string;
  state: ChannelTemplateState;
}

export interface TemplateEditorProps {
  typeKey: string;
  channels: readonly EditorChannel[];
  variables: readonly NotificationVariable[];
  /** Åbenlyst falske eksempelværdier til previewet (jf. `PREVIEW_EXAMPLES`). */
  examples: Readonly<Record<string, string>>;
  actions: TemplateEditorActions;
}

const DATE = new Intl.DateTimeFormat("da-DK", {
  timeZone: "Europe/Copenhagen",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(iso: string | null): string {
  return iso ? DATE.format(new Date(iso)) : "—";
}

function statusLabel(version: TemplateVersion): string {
  if (version.status === "live") return "Live";
  return version.status === "udkast" ? "Udkast" : "Arkiveret";
}

function ChannelEditor({
  typeKey,
  channel,
  variables,
  examples,
  actions,
}: Omit<TemplateEditorProps, "channels"> & { channel: EditorChannel }) {
  const { state } = channel;
  const { live, draft } = state;
  const channelKey: NotificationChannelKey = state.channel;
  const initial = draft ?? live;

  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [previewOf, setPreviewOf] = useState<"draft" | "live">("draft");
  const [confirming, setConfirming] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<"subject" | "body">("body");

  const [result, run, pending] = useActionState<TemplateActionState, FormData>(
    async (prev, formData) => {
      const intent = String(formData.get("intent") ?? "save");
      const action =
        intent === "publish" ? actions.publish : intent === "discard" ? actions.discard : actions.save;
      const next = await action(prev, formData);
      setConfirming(false);
      if (!next.error && intent === "discard") {
        setSubject(live?.subject ?? "");
        setBody(live?.body ?? "");
      }
      return next;
    },
    {},
  );

  const allowed = variables.map((variable) => variable.key);
  const content = { channel: channelKey, subject: channelKey === "email" ? subject : null, body };
  const draftResult = renderTemplate(content, examples, allowed);
  const liveResult = live
    ? renderTemplate({ channel: channelKey, subject: live.subject, body: live.body }, examples, allowed)
    : null;

  const badge = channelBadge(state);
  const savedDiffersFromLive = Boolean(draft) && differsFromLive(draft!, live);
  const unsaved = initial
    ? differsFromLive(content, initial)
    : subject.trim() !== "" || body.trim() !== "";
  // Ukendte variabler og syntaksfejl blokerer publicering; en variabel uden eksempelværdi gør ikke.
  const blocking = draftResult.problems.some((problem) => problem.kind !== "missing");
  const empty = body.trim() === "" || (channelKey === "email" && subject.trim() === "");

  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    if (channelKey === "email" && lastField.current === "subject") {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? start;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
      el?.focus();
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? body.length;
      const end = el?.selectionEnd ?? start;
      setBody(body.slice(0, start) + token + body.slice(end));
      el?.focus();
    }
  }

  function load(version: TemplateVersion) {
    setSubject(version.subject ?? "");
    setBody(version.body);
  }

  const previewShowsLive = previewOf === "live" && liveResult !== null;

  return (
    <section className="template-channel stack" aria-labelledby={`kanal-${channelKey}`}>
      <div className="template-channel__head">
        <h2 id={`kanal-${channelKey}`} className="heading-3 heading--on-light">
          {channel.label}
        </h2>
        {live ? (
          <StatusBadge tone="live">Live · v{live.version}</StatusBadge>
        ) : (
          <StatusBadge tone="none">Ingen live</StatusBadge>
        )}
        {draft ? <StatusBadge tone="draft">Udkast · v{draft.version}</StatusBadge> : null}
      </div>

      {badge === "ingen-live" ? (
        <p className="form__notice" role="status">
          Der er ingen live skabelon på denne kanal. Motoren sender ingenting her, før en
          version er publiceret — den logger «fejlet: ingen live skabelon».
        </p>
      ) : null}
      {savedDiffersFromLive ? (
        <p className="form__notice" role="status">
          Det gemte udkast (v{draft!.version}) afviger fra den live version (v{live?.version}).
          Kun den live tekst bruges ved udsendelse — udkastet er IKKE i brug, før du publicerer det.
        </p>
      ) : null}
      {unsaved ? (
        <p className="form__notice" role="status">
          Du har ændringer der ikke er gemt.
        </p>
      ) : null}

      <div className="template-editor">
        <form className="form" action={run}>
          <input type="hidden" name="type_key" value={typeKey} />
          <input type="hidden" name="channel" value={channelKey} />

          {channelKey === "email" ? (
            <div className="field">
              <label className="field__label" htmlFor={`emne-${channelKey}`}>
                Emne
              </label>
              <input
                ref={subjectRef}
                className="field__input"
                id={`emne-${channelKey}`}
                name="subject"
                type="text"
                value={subject}
                onFocus={() => {
                  lastField.current = "subject";
                }}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor={`tekst-${channelKey}`}>
              Tekst
            </label>
            <textarea
              ref={bodyRef}
              className="field__textarea"
              id={`tekst-${channelKey}`}
              name="body"
              rows={10}
              value={body}
              onFocus={() => {
                lastField.current = "body";
              }}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>

          <div className="stack">
            <p className="form__alt">Indsæt variabel (indsættes hvor markøren står):</p>
            <div className="chips">
              {variables.map((variable) => (
                <button
                  key={variable.key}
                  className="chip"
                  type="button"
                  title={variable.label}
                  onClick={() => insertVariable(variable.key)}
                >
                  {`{{${variable.key}}}`}
                </button>
              ))}
            </div>
          </div>

          {result.error ? (
            <p className="form__notice" role="alert">
              {result.error}
            </p>
          ) : null}
          {result.notice ? (
            <p className="form__notice" role="status">
              {result.notice}
            </p>
          ) : null}

          {confirming ? (
            <p className="form__notice" role="alert">
              Teksten bliver LIVE for alle fremtidige udsendelser på {channel.label.toLowerCase()}.
              {live ? ` Den nuværende live version (v${live.version}) arkiveres.` : ""}
            </p>
          ) : null}

          <div className="row-form">
            <button
              className="btn-secondary"
              type="submit"
              name="intent"
              value="save"
              disabled={pending || empty}
            >
              Gem udkast
            </button>
            {confirming ? (
              <>
                <PrimaryButton type="submit" name="intent" value="publish" disabled={pending}>
                  Bekræft: gør live
                </PrimaryButton>
                <button className="btn-secondary" type="button" onClick={() => setConfirming(false)}>
                  Annullér
                </button>
              </>
            ) : (
              <PrimaryButton
                type="button"
                disabled={pending || empty || blocking}
                onClick={() => setConfirming(true)}
              >
                Publicér…
              </PrimaryButton>
            )}
            {draft ? (
              <button
                className="btn-secondary"
                type="submit"
                name="intent"
                value="discard"
                disabled={pending}
              >
                Forkast udkast
              </button>
            ) : null}
            {live ? (
              <button className="btn-secondary" type="button" onClick={() => load(live)}>
                Nulstil til live
              </button>
            ) : null}
          </div>
          {blocking ? (
            <p className="form__alt">
              Udkastet kan ikke publiceres, før variablerne markeret i previewet er rettet.
            </p>
          ) : null}
        </form>

        <div className="stack">
          <div className="template-channel__head">
            <h3 className="heading-3 heading--on-light">Preview</h3>
            {previewShowsLive ? (
              <StatusBadge tone="live">Live · v{live?.version}</StatusBadge>
            ) : (
              <StatusBadge tone="draft">Udkast — ikke sendt</StatusBadge>
            )}
          </div>
          <div className="row-form">
            <button
              className="btn-secondary"
              type="button"
              aria-pressed={!previewShowsLive}
              onClick={() => setPreviewOf("draft")}
            >
              Din tekst
            </button>
            <button
              className="btn-secondary"
              type="button"
              aria-pressed={previewShowsLive}
              disabled={!liveResult}
              onClick={() => setPreviewOf("live")}
            >
              Den live version
            </button>
          </div>
          {previewShowsLive && liveResult ? (
            <TemplatePreview result={liveResult} channel={channelKey} />
          ) : empty ? (
            <p className="empty">Skriv teksten til venstre — previewet opdateres mens du skriver.</p>
          ) : (
            <TemplatePreview result={draftResult} channel={channelKey} />
          )}
          <p className="form__alt">
            Eksempelværdierne er åbenlyst falske ([DEMO]) og sendes aldrig til nogen.
          </p>
        </div>
      </div>

      {state.history.length > 0 ? (
        <div className="stack">
          <h3 className="heading-3 heading--on-light">Versionshistorik</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="table__head">Version</th>
                  <th className="table__head">Status</th>
                  <th className="table__head">Publiceret</th>
                  <th className="table__head">Handling</th>
                </tr>
              </thead>
              <tbody>
                {state.history.map((version) => (
                  <tr key={version.id} className="table__row">
                    <td className="table__cell">v{version.version}</td>
                    <td className="table__cell">
                      <StatusBadge
                        tone={
                          version.status === "live"
                            ? "live"
                            : version.status === "udkast"
                              ? "draft"
                              : "archived"
                        }
                      >
                        {statusLabel(version)}
                      </StatusBadge>
                    </td>
                    <td className="table__cell">{formatDate(version.publishedAt)}</td>
                    <td className="table__cell">
                      <button className="btn-secondary" type="button" onClick={() => load(version)}>
                        Indlæs i editor
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="form__alt">
            «Indlæs i editor» fylder felterne ud — intet gemmes eller publiceres, før du selv gør det.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function TemplateEditor({ typeKey, channels, variables, examples, actions }: TemplateEditorProps) {
  return (
    <div className="stack">
      {channels.map((channel) => (
        <ChannelEditor
          key={channel.state.channel}
          typeKey={typeKey}
          channel={channel}
          variables={variables}
          examples={examples}
          actions={actions}
        />
      ))}
    </div>
  );
}
