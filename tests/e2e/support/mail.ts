/**
 * Mailpit/Inbucket-opslag. Supabase Auth sender bekræftelses- og invitationsmails hertil i den
 * lokale stak, så e-mail-trinnene kan gennemspilles uden en rigtig SMTP-udbyder.
 */

import { loadSupabaseEnv } from "./env";

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
  To: Array<{ Address: string }>;
}

export interface MailMessage {
  ID: string;
  Subject: string;
  HTML: string;
  Text: string;
}

/** Vent på en mail til en adresse (emnet indeholder den givne tekst) og returner dens indhold. */
export async function waitForMail(to: string, subjectIncludes: string, timeoutMs = 20_000): Promise<MailMessage> {
  const { mailUrl } = loadSupabaseEnv();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    if (response.ok) {
      const body = (await response.json()) as { messages?: MailSummary[] };
      const match = (body.messages ?? []).find((m) => m.Subject.toLowerCase().includes(subjectIncludes.toLowerCase()));
      if (match) {
        const full = await fetch(`${mailUrl}/api/v1/message/${match.ID}`);
        return (await full.json()) as MailMessage;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Ingen mail til ${to} med "${subjectIncludes}" i emnet inden for ${timeoutMs} ms.`);
}

/** Det første link i mailen der peger på Supabase Auth's verify-endpoint. */
export function verifyLink(message: MailMessage): string {
  const haystack = `${message.HTML}\n${message.Text}`;
  const match = /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify\?[^\s"'<>]+/.exec(haystack);
  if (!match) throw new Error(`Mailen "${message.Subject}" indeholder intet verify-link.`);
  return match[0].replaceAll("&amp;", "&");
}
