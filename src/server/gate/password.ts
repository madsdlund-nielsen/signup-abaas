/**
 * Adgangskode-hashing for adgangsporten (ADR 0020). scrypt via node:crypto — KØRER KUN i server-
 * action'en (Node-runtime) og i scripts/hash-gate-password.mjs, ALDRIG på edge (proxy bruger token.ts).
 * Format: "<salt_hex>:<hash_hex>". Én delt adgangskode; plaintext lagres aldrig — kun hashen (i en
 * server-only env-var).
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
