"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

export interface BoardActionState {
  error?: string;
  /** Bekræftelse efter en vellykket handling. */
  notice?: string;
  /** Handlingen lykkedes, men en følgevirkning gjorde ikke (fx Cal.com-hosts). Vist som advarsel. */
  warning?: string;
}

export type BoardAction = (prev: BoardActionState, formData: FormData) => Promise<BoardActionState>;

/**
 * Kompakt handlingsformular til admins board-editor (ADR 0062): en knap (og evt. et felt) i en
 * række, med svaret — fejl, bekræftelse eller advarsel — direkte under. Samme React 19
 * useActionState som AuthForm, men uden den fulde formularskal, så den kan stå i en tabelrække.
 * Al styling via token-klasser.
 */
export function BoardActionForm({
  action,
  submitLabel,
  children,
}: {
  action: BoardAction;
  submitLabel: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<BoardActionState, FormData>(action, {});

  return (
    <div className="stack">
      <form className="row-form" action={formAction}>
        {children}
        <button className="btn-secondary" type="submit" disabled={pending}>
          {submitLabel}
        </button>
      </form>
      {state.error ? (
        <p className="form__notice" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.warning ? (
        <p className="form__notice" role="alert">
          {state.warning}
        </p>
      ) : null}
      {!state.error && state.notice ? (
        <p className="form__notice" role="status">
          {state.notice}
        </p>
      ) : null}
    </div>
  );
}
