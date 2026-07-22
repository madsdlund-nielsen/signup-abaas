/**
 * Adgangsport-cookie-signatur (Fase 1.1+, ADR 0020). KØRER PÅ EDGE (proxy) — derfor Web Crypto
 * (globalThis.crypto.subtle), ikke node:crypto. Cookien indeholder en HMAC over en konstant payload;
 * uden `APP_GATE_COOKIE_SECRET` kan den ikke forfalskes. httpOnly-cookien sættes af server-action'en.
 */

const TOKEN_PAYLOAD = "gate-pass-v1";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Konstant-tids-sammenligning (timingSafeEqual findes ikke på edge). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature);
}

export function signToken(secret: string): Promise<string> {
  return hmac(secret, TOKEN_PAYLOAD);
}

export async function verifyToken(token: string, secret: string): Promise<boolean> {
  return safeEqual(token, await signToken(secret));
}
