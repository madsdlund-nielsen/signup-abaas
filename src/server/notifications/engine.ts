/**
 * Notifikationsmotoren (fase 4.5, ADR 0057): én besked til én modtager på de kanaler beskedtypen
 * bruger — idempotent, med simpel retry, og uden at opfinde tekst.
 *
 * Rækkefølgen er bærende:
 *
 *   1. RESERVÉR udsendelsen (unik idempotensnøgle i `notification_delivery`) FØR noget sendes.
 *      Samme besked til samme modtager på samme kanal kan dermed aldrig gå afsted to gange,
 *      heller ikke hvis to kørsler overlapper.
 *   2. Find den LIVE skabelon. Ingen live → rækken logges `fejlet: ingen live skabelon` og der
 *      sendes intet. Motoren har ingen tekst af sin egen at falde tilbage på (ADR 0048).
 *   3. RENDER. Et problem (ukendt variabel, manglende værdi) gør udsendelsen `fejlet` — et
 *      halvt udfyldt «Kære {{navn}}» sendes aldrig.
 *   4. Slå modtagerens ADRESSE op server-side. Den bruges til kaldet og gemmes ingen steder.
 *   5. SEND via porten, op til `MAX_ATTEMPTS` forsøg med eksponentiel backoff for forbigående
 *      fejl. En endelig afvisning (4xx) prøves ikke igen.
 *   6. LOG udfaldet. Endelige fejl rapporteres til analytics-porten — uden persondata.
 *
 * Statussen følger adapteren: `sendt` kun når en rigtig leverandør tog imod beskeden, `stub`
 * og `demo` når kanalen ikke var rigtig. En stub-udsendelse er endelig — nøglen er brugt, og
 * intet gensendes bagud når leverandøren senere tændes (en påmindelse om et møde der er
 * forbi er værre end ingen påmindelse).
 */

import { createAnalytics, type Analytics } from "@/lib/analytics";
import { createEmailSender, type EmailSender } from "@/lib/email";
import { ProviderError } from "@/lib/errors";
import { createSmsSender, type SmsSender } from "@/lib/sms";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

import {
  allowedVariableKeys,
  getNotificationType,
  type NotificationChannelKey,
} from "./catalog";
import { renderTemplate, type VariableValues } from "./render";
import { scrubError, scrubPii } from "./scrub";
import { createSupabaseNotificationStore, type DeliveryStatus, type NotificationStore } from "./store";

/** Forsøg pr. kald (1 første + 2 gentagelser). Teknisk grænse, ikke en forretningsregel. */
export const MAX_ATTEMPTS = 3;
/** Ventetid før andet forsøg; fordobles for hvert. */
export const BACKOFF_BASE_MS = 250;

export interface SendNotificationInput {
  /** Nøgle fra `NOTIFICATION_TYPES`. */
  type: string;
  recipientUserId: string;
  /** Det objekt beskeden handler om (fx mødets id). Indgår i idempotensnøglen. */
  relatedId: string | null;
  variables: VariableValues;
  /**
   * Skelner to LOVLIGE udsendelser om samme objekt til samme modtager — fx at et møde flyttes
   * to gange, eller at en påmindelse følger et møde der blev flyttet efter den første.
   * Indgår i idempotensnøglen. Uden den kan hver (type, objekt, modtager, kanal) kun sendes én gang.
   */
  discriminator?: string;
  /** Begræns til nogle af typens kanaler. Standard: alle typens kanaler. */
  channels?: readonly NotificationChannelKey[];
}

export type SendOutcome =
  | { channel: NotificationChannelKey; status: "sendt" | "stub" | "demo"; deliveryId: string }
  | { channel: NotificationChannelKey; status: "fejlet"; deliveryId: string; reason: string }
  /** Nøglen var allerede brugt — intet gensendt. */
  | { channel: NotificationChannelKey; status: "duplikat"; existingStatus: DeliveryStatus };

export interface EngineDeps {
  store: NotificationStore;
  email: EmailSender;
  sms: SmsSender;
  analytics: Analytics;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

/** Produktions-wiring: service-role-lager og portene fra adapter-registret. */
export function createEngineDeps(env: Record<string, string | undefined> = process.env): EngineDeps {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  return {
    store: createSupabaseNotificationStore(createServiceSupabase(config)),
    email: createEmailSender(env),
    sms: createSmsSender(env),
    analytics: createAnalytics(env),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
  };
}

/** `type:objekt:modtager:kanal[:diskriminator]` — unik pr. lovlig udsendelse. */
export function idempotencyKey(
  type: string,
  relatedId: string | null,
  recipientUserId: string,
  channel: NotificationChannelKey,
  discriminator?: string,
): string {
  const parts = [type, relatedId ?? "-", recipientUserId, channel];
  if (discriminator) parts.push(discriminator);
  return parts.join(":");
}

function statusForAdapter(adapterName: string): "sendt" | "stub" | "demo" {
  if (adapterName === "stub") return "stub";
  return adapterName === "demo" ? "demo" : "sendt";
}

/**
 * Send en besked. Returnerer ét udfald pr. kanal. Kaster kun ved fejl i INFRASTRUKTUREN
 * (basen er nede) eller en ukendt beskedtype — en afvist besked er et `fejlet`-udfald, ikke en
 * undtagelse. Kalderne i `./meetings` fanger alligevel alt, så en handling aldrig fejler
 * fordi en notifikation gjorde.
 */
export async function sendNotification(
  input: SendNotificationInput,
  deps: EngineDeps = createEngineDeps(),
): Promise<SendOutcome[]> {
  const type = getNotificationType(input.type);
  if (!type) throw new Error(`Ukendt notifikationstype '${input.type}'.`);

  const channels = input.channels
    ? type.channels.filter((channel) => input.channels?.includes(channel))
    : type.channels;

  const outcomes: SendOutcome[] = [];
  for (const channel of channels) {
    outcomes.push(await sendOnChannel(input, channel, deps));
  }
  return outcomes;
}

async function sendOnChannel(
  input: SendNotificationInput,
  channel: NotificationChannelKey,
  deps: EngineDeps,
): Promise<SendOutcome> {
  const { store } = deps;
  const type = getNotificationType(input.type)!;
  const key = idempotencyKey(input.type, input.relatedId, input.recipientUserId, channel, input.discriminator);

  // 1. Reservér.
  const claim = await store.claimDelivery({
    typeKey: input.type,
    channel,
    recipientUserId: input.recipientUserId,
    relatedId: input.relatedId,
    idempotencyKey: key,
    now: deps.now(),
  });
  if (!claim.claimed) return { channel, status: "duplikat", existingStatus: claim.existingStatus };
  const deliveryId = claim.deliveryId;

  const fail = async (reason: string, attempt: number, templateId: string | null) => {
    await store.updateDelivery(deliveryId, {
      status: "fejlet",
      attempt,
      error: scrubPii(reason),
      templateId,
    });
    return { channel, status: "fejlet", deliveryId, reason: scrubPii(reason) } as const;
  };

  // 2. Live skabelon — ellers intet at sende.
  const template = await store.findLiveTemplate(input.type, channel);
  if (!template) return fail("ingen live skabelon", 0, null);

  // 3. Render. Et problem er en fejlet udsendelse, aldrig en halvt udfyldt besked.
  const rendered = renderTemplate(template, input.variables, allowedVariableKeys(type));
  if (!rendered.ok) {
    const problems = rendered.problems.map((problem) => problem.message).join(" ");
    return fail(`skabelon v${template.version} kan ikke renderes: ${problems}`, 0, template.id);
  }

  // 4. Adressen — slås op nu, bruges til kaldet, gemmes ikke.
  const recipient = await store.resolveRecipient(input.recipientUserId, channel);
  if (recipient.address === null) return fail(recipient.reason, 0, template.id);

  // 5. Send med retry.
  const adapter = channel === "email" ? deps.email : deps.sms;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Tælleren skrives FØR kaldet: en række med forsøg > 0 kan have nået leverandøren, og
    // overtages derfor aldrig bagefter (hellere en tabt besked end en dobbelt).
    await store.updateDelivery(deliveryId, { status: "afventer", attempt });
    try {
      const receipt =
        channel === "email"
          ? await deps.email.send({
              to: recipient.address,
              subject: rendered.subject ?? "",
              body: rendered.text,
              html: rendered.html ?? undefined,
              idempotencyKey: key,
            })
          : await deps.sms.send({ to: recipient.address, message: rendered.text, idempotencyKey: key });

      const status = statusForAdapter(adapter.name);
      await store.updateDelivery(deliveryId, {
        status,
        attempt,
        error: null,
        providerRef: receipt.reference,
        templateId: template.id,
      });
      return { channel, status, deliveryId };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        const outcome = await fail(scrubError(error), attempt, template.id);
        // Endelig fejl → analytics. Kun metadata: ingen adresse, ingen skabelontekst.
        await deps.analytics
          .captureException(new Error(scrubError(lastError)), {
            source: "notifications",
            type: input.type,
            channel,
            attempts: attempt,
            deliveryId,
          })
          .catch(() => undefined);
        return outcome;
      }
      await deps.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
  // Uopnåelig (løkken returnerer altid), men typesystemet kræver en afslutning.
  return fail(scrubError(lastError), MAX_ATTEMPTS, template.id);
}
