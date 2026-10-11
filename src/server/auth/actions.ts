"use server";

/**
 * Server-actions for auth-flow (fase 1.1, ADR 0014). Login/signup/logout mod Supabase Auth.
 * Signup provisionerer 'ejer'-rollen server-side (service-role) via provisionOwner.
 *
 * Når Supabase ikke er konfigureret (kontofri CI/dev uden nøgler) returnerer login/signup en
 * pæn "ikke konfigureret"-besked i stedet for at kaste — siderne virker stadig.
 */

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/components/AuthForm";
import { destinationAfterPassword } from "./confirm";
import { translateAuthError } from "./error-messages";
import { getCurrentUser } from "./index";
import { validateNewPassword } from "./password-policy";
import { provisionOwner } from "./provisioning";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "./supabase-config";
import { createServerSupabase, createServiceSupabase } from "./supabase-server";

const NOT_CONFIGURED = "Login er ikke konfigureret endnu (afventer Supabase-projekt).";

/**
 * Det ene svar på «glemt adgangskode» — samme tekst uanset om adressen findes, så formularen
 * ikke kan bruges til at afgøre hvem der har en konto (B-70, ADR 0073).
 */
const PASSWORD_RESET_NOTICE = "Hvis adressen findes, har vi sendt et link til at vælge en ny adgangskode.";

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return { error: NOT_CONFIGURED };

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createServerSupabase(config);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`[auth] signIn fejlede: ${error.message}`);
    return { error: translateAuthError(error.message) };
  }

  redirect("/dashboard");
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return { error: NOT_CONFIGURED };

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    console.error(`[auth] signUp fejlede: ${error.message}`);
    return { error: translateAuthError(error.message) };
  }
  if (!data.user) return { error: "Uventet: Supabase returnerede ingen bruger ved signup." };

  // Provisionér ejer-rolle server-side (bypasser RLS). Fejler dette, får brugeren den KONKRETE
  // årsag i stedet for en tavs "ingen rolle"-tilstand (session er allerede sat af signUp).
  try {
    await provisionOwner(createServiceSupabase(config), data.user.id, email);
  } catch (e) {
    return {
      error: `Konto oprettet, men rolletildeling fejlede: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Har e-mailbekræftelse slået til, oprettes ingen session ved signup (data.session == null).
  // Send brugeren til en "tjek din e-mail"-side i stedet for dashboardet (som ville bounce til login).
  if (!data.session) redirect("/check-email");

  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const config = readSupabaseAuthConfig();
  if (isSupabaseAuthConfigured(config)) {
    const supabase = await createServerSupabase(config);
    await supabase.auth.signOut();
  }
  redirect("/login");
}

/**
 * «Glemt adgangskode» (B-70, ADR 0073). Sender nulstillingsmailen server-side; mailskabelonen peger på
 * `/auth/confirm?token_hash=…&type=recovery`, som sætter sessionen og sender videre til
 * `/konto/adgangskode`. Svaret er identisk uanset om kontoen findes — og uanset om Supabase
 * afviser kaldet (fejlen logges, ikke vises). Eneste afvigelse er en tom e-mail, som ikke røber noget.
 */
export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return { error: NOT_CONFIGURED };

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Skriv den e-mailadresse du bruger til at logge ind." };

  const supabase = await createServerSupabase(config);
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) console.error(`[auth] resetPasswordForEmail fejlede: ${error.message}`);

  return { notice: PASSWORD_RESET_NOTICE };
}

/**
 * «Sæt adgangskode» (B-70, ADR 0073): kræver en session — fra et invitations- eller nulstillingslink
 * eller en almindelig login-session. Uden session returneres en rolig besked (siden redirecter selv
 * til login; actionen er forsvaret hvis den kaldes direkte). Adgangskodereglen er signup's (8 tegn).
 */
export async function setPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) return { error: NOT_CONFIGURED };

  const password = String(formData.get("password") ?? "");
  const repeat = String(formData.get("repeat") ?? "");
  const invalid = validateNewPassword(password, repeat);
  if (invalid) return { error: invalid };

  const supabase = await createServerSupabase(config);
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) {
    return { error: "Din session er udløbet. Bed om et nyt link via «Glemt adgangskode» på loginsiden." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error(`[auth] updateUser(password) fejlede: ${error.message}`);
    return { error: translateAuthError(error.message) };
  }

  const user = await getCurrentUser();
  redirect(destinationAfterPassword(user?.roles ?? []));
}
