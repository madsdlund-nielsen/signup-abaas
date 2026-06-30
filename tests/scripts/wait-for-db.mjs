// Venter på at test-databasen svarer, før migrationer/tests køres.
// Bruges af `npm run db:test:up` efter docker compose er startet.
import { Client } from "pg";

const url =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/abaas_test";
const maxAttempts = 30;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    console.log(`Database klar (forsøg ${attempt}).`);
    process.exit(0);
  } catch {
    await client.end().catch(() => {});
    if (attempt === maxAttempts) {
      console.error(`Database ikke klar efter ${maxAttempts} forsøg: ${url}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
