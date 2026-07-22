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
import { translateAuthError } from "./error-messages";
import { provisionOwner } from "./provisioning";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "./supabase-config";
import { createServerSupabase, createServiceSupabase } from "./supabase-server";

const NOT_CONFIGURED = "Login er ikke konfigureret endnu (afventer Supabase-projekt).";

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
