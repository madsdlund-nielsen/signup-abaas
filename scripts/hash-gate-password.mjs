#!/usr/bin/env node
/**
 * Genererer en scrypt-hash til env-varen APP_GATE_PASSWORD_HASH (adgangsporten, ADR 0020).
 * Læser adgangskoden SKJULT fra stdin, så plaintext aldrig havner i shell-historik eller argv.
 * Brug:  node scripts/hash-gate-password.mjs
 * Output (indsæt i Netlify):  <salt_hex>:<hash_hex>
 */
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Skjul indtastningen (skriv intet efter prompten).
    rl._writeToOutput = (chunk) => {
      if (chunk.includes(question)) process.stdout.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = process.argv[2] ?? (await promptHidden("Gate password: "));
if (!password) {
  console.error("Ingen adgangskode angivet.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`${salt.toString("hex")}:${hash.toString("hex")}`);
