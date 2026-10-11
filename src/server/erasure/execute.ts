/**
 * Udførelse af en sletning (GDPR art. 17, ADR 0068). Ingen "use server": modulet tager sine
 * afhængigheder som argument, så rækkefølgen kan afprøves uden netværk. Autorisation hører til
 * kalderen (`./request` — admin FØR noget andet); intet her tjekker hvem brugeren er.
 *
 * Rækkefølgen er bærende:
 *   1. Bekræftelse: e-mailen skrevet igen skal passe til kontoen (to-trins).
 *   2. Plan (`planErasure`) — blokeringer afviser sletningen FØR noget skrives (fail-closed).
 *   3. Supabase i ÉN transaktion (`erase_data_subject`, 0028). Fejler den, er intet ændret.
 *   4. Cal.com: hosts på de berørte boards og kommende bookinger. Fejl ruller IKKE Supabase tilbage.
 *   5. Øvrige eksterne behandlere via portene. Fejl ruller IKKE Supabase tilbage; de registreres.
 *   6. Supabase Auth (`auth.admin.deleteUser`) og kontoankeret — KUN hvis ingen genkørbar behandler
 *      (PostHog, Resend) fejlede. Ellers står kontoen blankeret tilbage som opslagsnøgle, og
 *      sletningen kan genkøres. Cal.com er ikke genkørbar (møderne er væk) og rettes manuelt.
 *   7. Kvittering (`erasure_receipt`): pseudonymt id-hash, tidspunkt, systemer og udfald. Ingen persondata.
 *
 * IDEMPOTENT: en genkørsel er et almindeligt kald. Er kontoen væk, svarer den `ikke-fundet`; står
 * den blankeret tilbage, gentages de eksterne skridt, og Supabase-funktionen finder intet at slette.
 *
 * Persondata-hygiejne: kvitteringens `detail` er faste tekster; fejl fra leverandører skrubbes
 * (`scrubError`) og bærer aldrig adresse, id eller svartekst.
 */

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { NotConfiguredError } from "@/lib/errors";
import type { BookingProvider } from "@/lib/booking/port";
import type { ProcessorEraser } from "@/lib/erasure";
import type { RowFetcher } from "@/server/admin/subject-collect";
import { normaliseEmail } from "@/server/admin/subject-access";
import { settleBoardChangeSync } from "@/server/boards/audit";
import { syncBoardHosts } from "@/server/meetings/board-hosts";
import { scrubError } from "@/server/notifications/scrub";
import { planErasure, type ErasurePlan } from "./plan";

export type SystemStatus = "slettet" | "intet_at_slette" | "fejlet" | "ikke_konfigureret" | "manuel" | "udsat";

export interface SystemResult {
  /** Stabil nøgle: `supabase`, `calcom`, `posthog`, `resend`, `inmobile`, `ordbogen`, `supabase-auth`. */
  system: string;
  label: string;
  status: SystemStatus;
  /** Fast tekst uden persondata. */
  detail: string;
}

export type ErasureOutcome = "gennemfoert" | "delvist";

export interface ErasureReceiptView {
  /** Null hvis kvitteringen ikke kunne gemmes (sletningen er alligevel sket). */
  id: string | null;
  executedAt: string;
  outcome: ErasureOutcome;
  systems: SystemResult[];
  /** Systemer der ikke er slettet automatisk (fejlet, ikke konfigureret, manuel, udsat). */
  missing: string[];
  receiptSaved: boolean;
}

export interface AuthAdmin {
  deleteUser(userId: string): Promise<{ error: { message: string; status?: number; code?: string } | null }>;
}

export interface ErasureDeps {
  /** Service-role-klienten (rpc + skrivning). Må kun være konstrueret efter et admin-tjek. */
  service: SupabaseClient;
  fetchRows: RowFetcher;
  authAdmin: AuthAdmin;
  erasers: ProcessorEraser[];
  booking: BookingProvider;
  now?: () => Date;
}

export type ExecuteFailure = "ikke-fundet" | "email-matcher-ikke" | "blokeret" | "fejlet";

export type ExecuteResult =
  | { ok: true; receipt: ErasureReceiptView }
  | { ok: false; code: ExecuteFailure; message: string; plan?: ErasurePlan };

export const MISSING_STATUSES: readonly SystemStatus[] = ["fejlet", "ikke_konfigureret", "manuel", "udsat"];

const STATUS_PRIORITY: SystemStatus[] = ["fejlet", "ikke_konfigureret", "udsat", "manuel", "slettet", "intet_at_slette"];

/** Det værste udfald vinder — et system er først «slettet» når alle dets skridt er det. */
export function worstStatus(statuses: readonly SystemStatus[]): SystemStatus {
  for (const status of STATUS_PRIORITY) if (statuses.includes(status)) return status;
  return "intet_at_slette";
}

/** SHA-256 (hex) af bruger-id'et — kvitteringens pseudonyme nøgle (0028). */
export function subjectHash(userId: string): string {
  return createHash("sha256").update(`erasure:v1:${userId}`).digest("hex");
}

/** Behandlere en genkørsel af sletningen kan nå igen (nøglen — id eller e-mail — findes i ankeret). */
const RETRYABLE_SYSTEMS: ReadonlySet<string> = new Set(["posthog", "resend"]);

const NOT_CONFIGURED_DETAIL =
  "Adapteren er ikke aktiv i dette miljø — der er ikke slettet noget automatisk. Kontrollér og slet manuelt hos leverandøren.";

interface DbResult {
  deleted: Record<string, number>;
  board_changes: Array<{ board_id: string; change_id: string }>;
}

function isDbResult(data: unknown): data is DbResult {
  const d = data as Partial<DbResult> | null;
  return !!d && typeof d === "object" && typeof d.deleted === "object" && Array.isArray(d.board_changes);
}

/** Cal.com: hosts på de berørte boards og kommende bookinger. Kaster aldrig. */
async function eraseCalcom(
  deps: ErasureDeps,
  plan: ErasurePlan,
  changes: DbResult["board_changes"],
): Promise<SystemResult | null> {
  const external = plan.externals.find((e) => e.processor === "calcom");
  if (!external) return null;

  const statuses: SystemStatus[] = [];
  const notes: string[] = [];
  const stub = deps.booking.name === "stub";

  for (const change of changes) {
    const sync = await syncBoardHosts(deps.service, change.board_id, { createIfMissing: false }, deps.booking);
    // Rækken står pessimistisk som 'fejlet' (0026); ret den til det faktiske udfald.
    await settleBoardChangeSync(
      deps.service,
      change.change_id,
      sync.status === "opdateret" ? "opdateret" : sync.status === "fejlet" ? "fejlet" : "sprunget_over",
    );
    statuses.push(sync.status === "opdateret" ? "slettet" : sync.status === "fejlet" ? (stub ? "ikke_konfigureret" : "fejlet") : "intet_at_slette");
  }
  if (changes.length > 0) {
    const failed = statuses.filter((s) => s === "fejlet" || s === "ikke_konfigureret").length;
    notes.push(
      failed > 0
        ? `Hosts ikke opdateret på ${failed} af ${changes.length} boards (kør «Opdatér hosts» under Boards).`
        : `Hosts opdateret på de ${changes.length} berørte boards.`,
    );
  }

  let cancelled = 0;
  let cancelFailed = 0;
  let cancelNotConfigured = 0;
  for (const uid of plan.upcomingBookingUids) {
    try {
      await deps.booking.cancelMeeting(uid, "Kontoen er slettet.");
      cancelled += 1;
    } catch (e) {
      if (e instanceof NotConfiguredError) cancelNotConfigured += 1;
      else cancelFailed += 1;
    }
  }
  if (plan.upcomingBookingUids.length > 0) {
    statuses.push(cancelFailed > 0 ? "fejlet" : cancelNotConfigured > 0 ? "ikke_konfigureret" : "slettet");
    notes.push(
      `${cancelled} af ${plan.upcomingBookingUids.length} kommende bookinger aflyst` +
        (cancelFailed + cancelNotConfigured > 0 ? " — resten skal aflyses manuelt i Cal.com." : "."),
    );
  }

  if (external.manual && external.manualIsGap) {
    statuses.push("manuel");
    notes.push(external.manual);
  }
  return {
    system: "calcom",
    label: external.label,
    status: worstStatus(statuses),
    detail: notes.join(" ") || "Intet at slette hos Cal.com.",
  };
}

/** PostHog og Resend via `eraseDataSubject`. Kaster aldrig. */
async function eraseProcessors(deps: ErasureDeps, plan: ErasurePlan, subject: { userId: string; email: string }): Promise<SystemResult[]> {
  const results: SystemResult[] = [];
  for (const eraser of deps.erasers) {
    const external = plan.externals.find((e) => e.processor === eraser.processor);
    const label = external?.label ?? eraser.processor;
    try {
      const receipt = await eraser.eraseDataSubject(subject);
      const base =
        receipt.status === "slettet"
          ? `Slettet via ${eraser.name}${receipt.reference ? ` (${receipt.reference})` : ""}.`
          : "Personen findes ikke hos behandleren — intet at slette.";
      results.push({
        system: eraser.processor,
        label,
        status: receipt.status,
        detail: external?.manual && !external.manualIsGap ? `${base} ${external.manual}` : base,
      });
    } catch (e) {
      if (e instanceof NotConfiguredError) {
        results.push({ system: eraser.processor, label, status: "ikke_konfigureret", detail: NOT_CONFIGURED_DETAIL });
      } else {
        results.push({
          system: eraser.processor,
          label,
          status: "fejlet",
          detail: `Sletningen fejlede (${scrubError(e, 160)}). Kør sletningen igen.`,
        });
      }
    }
  }
  return results;
}

/** Behandlere uden automatisk sletning (inMobile, Ordbogen): synlige huller, aldrig stille. */
function manualProcessors(plan: ErasurePlan): SystemResult[] {
  return plan.externals
    .filter((e) => e.processor !== "calcom" && e.automatic === null && e.manual)
    .map((e) => ({ system: e.processor, label: e.label, status: "manuel" as const, detail: e.manual as string }));
}

function summariseDeleted(deleted: Record<string, number>): string {
  const total = Object.entries(deleted)
    .filter(([key]) => key !== "board_change_actor")
    .reduce((sum, [, n]) => sum + n, 0);
  return `Slettet i én transaktion (${total} rækker direkte; resten via cascade). Aktør nulstillet i ${deleted.board_change_actor ?? 0} sporrækker.`;
}

export async function executeErasure(
  deps: ErasureDeps,
  input: { adminId: string; userId: string; confirmEmail: string },
): Promise<ExecuteResult> {
  const now = deps.now ?? (() => new Date());

  // 1. Findes kontoen, og passer den bekræftede e-mail?
  const [user] = await deps.fetchRows({
    table: "app_user",
    columns: "id, email",
    eq: { column: "id", value: input.userId },
  });
  if (!user) {
    return {
      ok: false,
      code: "ikke-fundet",
      message: "Ingen konto med det id. Er personen allerede slettet, er der intet mere at gøre.",
    };
  }
  const email = String(user.email ?? "").toLowerCase();
  if (normaliseEmail(input.confirmEmail) !== email) {
    return { ok: false, code: "email-matcher-ikke", message: "E-mailen matcher ikke kontoen. Intet er slettet." };
  }

  // 2. Plan og blokeringer — fail-closed.
  const plan = await planErasure(deps.fetchRows, input.userId, input.adminId, now());
  if (!plan.executable) {
    return {
      ok: false,
      code: "blokeret",
      message: plan.blockers.map((b) => b.message).join(" "),
      plan,
    };
  }

  // 3. Supabase i én transaktion.
  const { data, error } = await deps.service.rpc("erase_data_subject", {
    p_user_id: input.userId,
    p_actor_id: input.adminId,
    p_board_removals: plan.boardRemovals.map((r) => ({
      board_id: r.boardId,
      expected_partner_ids: r.expectedPartnerIds,
      partner_id: r.partnerId,
      lead_id: r.leadId,
    })),
  });
  if (error || !isDbResult(data)) {
    const message = error?.message ?? "Sletningen returnerede et uventet svar.";
    // Funktionen er sidste værn for opbevaringspligt: et løb efter planen ender her.
    const blocked = /opbevaringspligt|B-68|sidste admin/i.test(message);
    return {
      ok: false,
      code: blocked ? "blokeret" : "fejlet",
      message: `${scrubError(message, 300)} Intet er slettet.`,
      plan,
    };
  }

  const systems: SystemResult[] = [
    { system: "supabase", label: "Supabase (sandhedskilden)", status: "slettet", detail: summariseDeleted(data.deleted) },
  ];

  // 4-5. Eksterne behandlere — fejl her ruller aldrig Supabase tilbage.
  const calcom = await eraseCalcom(deps, plan, data.board_changes);
  if (calcom) systems.push(calcom);
  systems.push(...(await eraseProcessors(deps, plan, { userId: input.userId, email })));
  systems.push(...manualProcessors(plan));

  // 6. Auth-kontoen og ankeret — kun hvis intet fejlede, så en genkørsel stadig kan finde personen.
  // Kun behandlere en genkørsel kan nå igen holder ankeret tilbage. Cal.com kan ikke: møderne er væk fra
  // Supabase, så bookinger og hosts findes ikke længere i en ny plan — de rettes manuelt (se detaljen).
  const failed = systems.some((s) => s.status === "fejlet" && RETRYABLE_SYSTEMS.has(s.system));
  let anchorRemoved = false;
  if (failed) {
    systems.push({
      system: "supabase-auth",
      label: "Supabase Auth (login)",
      status: "udsat",
      detail:
        "Ikke forsøgt, fordi et system fejlede: kontoen står blankeret tilbage (kun e-mail), så sletningen kan køres igen.",
    });
  } else {
    const { error: authError } = await deps.authAdmin.deleteUser(input.userId);
    const alreadyGone = authError?.status === 404 || authError?.code === "user_not_found";
    if (authError && !alreadyGone) {
      systems.push({
        system: "supabase-auth",
        label: "Supabase Auth (login)",
        status: "fejlet",
        detail: `Login-kontoen blev ikke slettet (${scrubError(authError.message, 160)}). Kør sletningen igen.`,
      });
    } else {
      // Triggeren fra 0004 fjerner ankeret; sletningen herunder dækker en konto uden Auth-bruger.
      const { error: anchorError } = await deps.service.from("app_user").delete().eq("id", input.userId);
      anchorRemoved = !anchorError;
      systems.push({
        system: "supabase-auth",
        label: "Supabase Auth (login)",
        status: anchorRemoved ? "slettet" : "fejlet",
        detail: anchorRemoved
          ? "Login-kontoen og kontoankeret er slettet."
          : "Login-kontoen er slettet, men kontoankeret kunne ikke fjernes. Kør sletningen igen.",
      });
    }
  }

  // 7. Kvittering — ingen persondata.
  const outcome: ErasureOutcome = anchorRemoved ? "gennemfoert" : "delvist";
  const missing = systems.filter((s) => MISSING_STATUSES.includes(s.status)).map((s) => s.system);
  const executedAt = now().toISOString();

  let receiptId: string | null = null;
  try {
    const { data: saved, error: saveError } = await deps.service
      .from("erasure_receipt")
      .insert({
        subject_hash: subjectHash(input.userId),
        requested_by: input.adminId,
        executed_at: executedAt,
        outcome,
        systems,
        missing,
      })
      .select("id")
      .maybeSingle();
    receiptId = saveError ? null : ((saved as { id?: string } | null)?.id ?? null);
    if (saveError) console.error(`[erasure] kvittering ikke gemt: ${scrubError(saveError.message)}`);
  } catch (e) {
    console.error(`[erasure] kvittering ikke gemt: ${scrubError(e)}`);
  }
  console.info(`[erasure] sletning kørt af admin ${input.adminId}: ${outcome}, mangler: ${missing.join(",") || "intet"}`);

  return {
    ok: true,
    receipt: { id: receiptId, executedAt, outcome, systems, missing, receiptSaved: receiptId !== null },
  };
}
