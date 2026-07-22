"use server";

/**
 * Server-action for adgangsporten (ADR 0020). Verificerer den delte adgangskode mod scrypt-hashen og
 * sætter en signeret httpOnly-cookie ved succes. Genbruger AuthForm-formen (returnerer { error }).
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AuthFormState } from "@/components/AuthForm";
import { GATE_COOKIE, isGateActive, readGateConfig } from "./index";
import { verifyPassword } from "./password";
import { signToken } from "./token";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export async function submitGate(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const config = readGateConfig();
  if (!isGateActive(config) || !config.passwordHash || !config.cookieSecret) {
    return { error: "Adgangsporten er ikke konfigureret korrekt." };
  }

  const password = String(formData.get("password") ?? "");
  if (!verifyPassword(password, config.passwordHash)) {
    return { error: "Forkert adgangskode." };
  }

  const token = await signToken(config.cookieSecret);
  const store = await cookies();
  store.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  });

  redirect("/");
}
