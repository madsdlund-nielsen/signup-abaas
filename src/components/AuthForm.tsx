"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { PrimaryButton } from "@/components/PrimaryButton";

export interface AuthFormState {
  error?: string;
}

export type AuthAction = (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;

/**
 * Delt formularskal for login/signup. Bruger React 19 useActionState: server-action
 * kører submit, redirecter ved succes og returnerer { error } ved fejl (vist i .form__notice).
 * Al styling via token-klasser.
 */
export function AuthForm({
  action,
  submitLabel,
  children,
  alt,
}: {
  action: AuthAction;
  submitLabel: string;
  children: ReactNode;
  alt?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <form className="form" action={formAction}>
      {children}
      {state.error ? (
        <p className="form__notice" role="alert">
          {state.error}
        </p>
      ) : null}
      <PrimaryButton type="submit" disabled={pending}>
        {submitLabel}
      </PrimaryButton>
      {alt ? <p className="form__alt">{alt}</p> : null}
    </form>
  );
}
