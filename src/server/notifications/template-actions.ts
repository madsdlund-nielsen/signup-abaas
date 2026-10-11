"use server";

/**
 * Admin-mutationer for notifikationsskabeloner (fase 4.6, ADR 0057). Service-role bag
 * requireRole('admin') — mønster fra pricing/actions. Skabelonerne er versioner:
 *
 *   - «Gem udkast» opretter eller opdaterer det ene udkast pr. (type, kanal). Et udkast må gerne
 *     indeholde fejl (en halvfærdig skabelon er arbejde i gang) — det sender aldrig noget.
 *   - «Publicér» gemmer teksten som udkast og gør den live via `publish_notification_template`
 *     (0021), der arkiverer den forrige live i samme transaktion. En tekst med syntaksfejl eller
 *     ukendte variabler kan ikke publiceres.
 *   - «Forkast udkast» sletter udkastet; live og historik røres ikke.
 *
 * Teksten kommer fra admins indtastning — aldrig fra kode (ADR 0048).
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentUser, requireRole, type AuthUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

import { allowedVariableKeys, getNotificationType, type NotificationChannelKey } from "./catalog";
import { validateTemplate } from "./render";
import { differsFromLive } from "./template-state";

export interface TemplateActionState {
  error?: string;
  notice?: string;
}

interface Context {
  service: SupabaseClient;
  user: AuthUser;
}

async function requireAdminContext(): Promise<Context> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "admin");
  return { service: createServiceSupabase(config), user };
}

interface Submitted {
  typeKey: string;
  channel: NotificationChannelKey;
  subject: string | null;
  body: string;
  allowed: readonly string[];
}

/** Læs og valider formularen mod kataloget: kendt type, kanal typen bruger, emne kun på e-mail. */
function readSubmission(formData: FormData): Submitted {
  const typeKey = String(formData.get("type_key") ?? "");
  const type = getNotificationType(typeKey);
  if (!type) throw new Error("Ukendt beskedtype.");

  const channel = String(formData.get("channel") ?? "") as NotificationChannelKey;
  if (!type.channels.includes(channel)) {
    throw new Error(`Beskedtypen «${type.label}» bruges ikke på kanalen ${channel || "—"}.`);
  }

  const body = String(formData.get("body") ?? "");
  if (!body.trim()) throw new Error("Brødteksten må ikke være tom.");

  let subject: string | null = null;
  if (channel === "email") {
    subject = String(formData.get("subject") ?? "").trim();
    if (!subject) throw new Error("E-mailen skal have en emnelinje.");
  }
  return { typeKey, channel, subject, body, allowed: allowedVariableKeys(type) };
}

interface ExistingRows {
  draft: { id: string } | null;
  live: { subject: string | null; body: string } | null;
  maxVersion: number;
}

async function readExisting(
  service: SupabaseClient,
  typeKey: string,
  channel: NotificationChannelKey,
): Promise<ExistingRows> {
  const { data, error } = await service
    .from("notification_template")
    .select("id, version, status, subject, body")
    .eq("type_key", typeKey)
    .eq("channel", channel);
  if (error) throw new Error(`Kunne ikke læse skabelonerne: ${error.message}`);
  const rows = (data ?? []) as Array<{
    id: string;
    version: number;
    status: string;
    subject: string | null;
    body: string;
  }>;
  const live = rows.find((row) => row.status === "live");
  return {
    draft: rows.find((row) => row.status === "udkast") ?? null,
    live: live ? { subject: live.subject, body: live.body } : null,
    maxVersion: rows.reduce((max, row) => Math.max(max, row.version), 0),
  };
}

/** Opret eller opdatér det ene udkast pr. (type, kanal). Returnerer udkastets id. */
async function upsertDraft(service: SupabaseClient, submitted: Submitted): Promise<string> {
  const existing = await readExisting(service, submitted.typeKey, submitted.channel);
  const now = new Date().toISOString();

  if (existing.draft) {
    const { error } = await service
      .from("notification_template")
      .update({ subject: submitted.subject, body: submitted.body, updated_at: now })
      .eq("id", existing.draft.id);
    if (error) throw new Error(`Kunne ikke gemme udkastet: ${error.message}`);
    return existing.draft.id;
  }

  const { data, error } = await service
    .from("notification_template")
    .insert({
      type_key: submitted.typeKey,
      channel: submitted.channel,
      version: existing.maxVersion + 1,
      status: "udkast",
      subject: submitted.subject,
      body: submitted.body,
    })
    .select("id")
    .single();
  if (error || !data) {
    // Unik-bruddet betyder at en anden admin oprettede udkastet samtidig.
    throw new Error(`Kunne ikke oprette udkastet: ${error?.message ?? "ingen række skrevet"}`);
  }
  return (data as { id: string }).id;
}

function revalidate(typeKey: string): void {
  revalidatePath("/admin/notifikationer");
  revalidatePath(`/admin/notifikationer/${typeKey}`);
}

function toError(e: unknown): TemplateActionState {
  return { error: e instanceof Error ? e.message : String(e) };
}

export async function saveTemplateDraft(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  try {
    const { service } = await requireAdminContext();
    const submitted = readSubmission(formData);
    await upsertDraft(service, submitted);
    revalidate(submitted.typeKey);

    const problems = validateTemplate(submitted, submitted.allowed);
    return {
      notice:
        problems.length > 0
          ? `Udkast gemt — men det kan ikke publiceres endnu: ${problems.map((p) => p.message).join(" ")}`
          : "Udkast gemt. Det er ikke live — intet er sendt ud med den nye tekst.",
    };
  } catch (e) {
    return toError(e);
  }
}

export async function publishTemplate(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  try {
    const { service, user } = await requireAdminContext();
    const submitted = readSubmission(formData);

    const problems = validateTemplate(submitted, submitted.allowed);
    if (problems.length > 0) {
      return {
        error: `Kan ikke publiceres: ${problems.map((p) => p.message).join(" ")}`,
      };
    }

    const existing = await readExisting(service, submitted.typeKey, submitted.channel);
    if (!differsFromLive(submitted, existing.live)) {
      return { error: "Intet at publicere: teksten er identisk med den live version." };
    }

    const draftId = await upsertDraft(service, submitted);
    const { error } = await service.rpc("publish_notification_template", {
      p_template_id: draftId,
      p_published_by: user.id,
    });
    if (error) return { error: `Kunne ikke publicere: ${error.message}` };

    revalidate(submitted.typeKey);
    return { notice: "Publiceret. Den nye tekst er LIVE og bruges fra næste udsendelse." };
  } catch (e) {
    return toError(e);
  }
}

export async function discardTemplateDraft(
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  try {
    const { service } = await requireAdminContext();
    const typeKey = String(formData.get("type_key") ?? "");
    const type = getNotificationType(typeKey);
    const channel = String(formData.get("channel") ?? "");
    if (!type || !type.channels.includes(channel as NotificationChannelKey)) {
      return { error: "Ukendt beskedtype eller kanal." };
    }

    // Kun rækken med status udkast — en publiceret version kan ikke slettes (trigger i 0021).
    const { error } = await service
      .from("notification_template")
      .delete()
      .eq("type_key", typeKey)
      .eq("channel", channel)
      .eq("status", "udkast");
    if (error) return { error: `Kunne ikke forkaste udkastet: ${error.message}` };

    revalidate(typeKey);
    return { notice: "Udkastet er forkastet. Den live version er uændret." };
  } catch (e) {
    return toError(e);
  }
}
