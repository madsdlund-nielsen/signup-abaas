/**
 * Synkronisér afventende periode-opkrævninger til betalingsleverandørens abonnement
 * (B-19, ADR 0056). Erstatter indberetningen af forbrug pr. møde (ADR 0032).
 *
 * For hvert medlemskab med en afventende periode sættes abonnementets pris hos leverandøren til
 * den NYESTE afventende periodes beløb (`upsertSubscription`, idempotent), og medlemskabets
 * afventende rækker flyttes til 'rapporteret' — prisen er meldt, leverandøren fakturerer selv,
 * og webhooken (invoice.paid / invoice.payment_failed) er autoritativ for gennemført/fejlet.
 *
 * Fejl i selve leverandørkaldet lader rækken stå som 'afventer' med årsagen i `failure_reason`,
 * så næste kørsel prøver igen — en forbigående fejl må ikke ende som en endelig 'fejlet'.
 * Med stub aktiv (ingen nøgler) kaster porten NotConfiguredError: hele synkroniseringen
 * stopper og rækkerne står ærligt som 'afventer'.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { NotConfiguredError } from "@/lib/errors";
import type { PaymentProvider } from "@/lib/payments";

import { BILLING_PERIOD_DAYS } from "./periods";

interface MembershipEmbed {
  provider_customer_ref: string | null;
  provider_subscription_ref: string | null;
  billing_anchor: string | null;
}

interface PendingChargeRow {
  id: string;
  membership_id: string;
  amount_minor: number;
  currency: string;
  period_start: string;
  membership: MembershipEmbed | MembershipEmbed[] | null;
}

export interface SyncResult {
  /** Medlemskaber hvis abonnementspris er meldt til leverandøren. */
  reported: number;
  /** Medlemskaber der ikke kunne synkroniseres (kort mangler, abonnement ikke koblet, API-fejl). */
  failed: number;
  /** Stub aktiv: intet blev forsøgt. Indeholder fejlbeskeden. */
  notConfigured: string | null;
}

export async function syncPendingSubscriptions(
  service: SupabaseClient,
  provider: PaymentProvider,
): Promise<SyncResult> {
  const result: SyncResult = { reported: 0, failed: 0, notConfigured: null };

  const { data, error } = await service
    .from("payment_charge")
    .select(
      "id, membership_id, amount_minor, currency, period_start, membership(provider_customer_ref, provider_subscription_ref, billing_anchor)",
    )
    .eq("status", "afventer")
    .not("period_start", "is", null)
    .order("period_start", { ascending: false });
  if (error) throw new Error(`Kunne ikke læse afventende opkrævninger: ${error.message}`);

  // Pr. medlemskab: nyeste periode først (ordnet ovenfor) — det er dens beløb leverandøren skal have.
  const byMembership = new Map<string, PendingChargeRow[]>();
  for (const row of (data ?? []) as unknown as PendingChargeRow[]) {
    byMembership.set(row.membership_id, [...(byMembership.get(row.membership_id) ?? []), row]);
  }

  const stamp = () => new Date().toISOString();

  for (const [membershipId, rows] of byMembership) {
    const latest = rows[0];
    if (!latest) continue;
    const membership = Array.isArray(latest.membership) ? latest.membership[0] : latest.membership;
    const chargeIds = rows.map((r) => r.id);

    const markWaiting = async (reason: string) => {
      await service
        .from("payment_charge")
        .update({ failure_reason: reason, updated_at: stamp() })
        .in("id", chargeIds);
    };

    if (!membership?.provider_customer_ref || !membership.billing_anchor) {
      // Kort ikke registreret endnu — ærligt afventende, ikke en fejl.
      result.failed += 1;
      await markWaiting("Kortet er ikke registreret hos leverandøren endnu.");
      continue;
    }

    try {
      const subscription = await provider.upsertSubscription({
        membershipId,
        customerRef: membership.provider_customer_ref,
        subscriptionRef: membership.provider_subscription_ref,
        amountMinor: latest.amount_minor,
        currency: latest.currency,
        intervalDays: BILLING_PERIOD_DAYS,
        startsOn: membership.billing_anchor,
      });

      if (subscription.id !== membership.provider_subscription_ref) {
        await service
          .from("membership")
          .update({ provider_subscription_ref: subscription.id, updated_at: stamp() })
          .eq("id", membershipId);
      }
      await service
        .from("payment_charge")
        .update({
          status: "rapporteret",
          provider_charge_ref: subscription.id,
          failure_reason: null,
          updated_at: stamp(),
        })
        .in("id", chargeIds);
      result.reported += 1;
    } catch (e) {
      if (e instanceof NotConfiguredError) {
        // Stub aktiv: lad rækkerne stå som 'afventer' og fortæl præcis hvorfor.
        result.notConfigured = e.message;
        return result;
      }
      result.failed += 1;
      await markWaiting(e instanceof Error ? e.message : String(e));
    }
  }

  return result;
}
