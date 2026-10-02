import { loadNearestEnvFile } from "@lunaecho/core";

import { connectDatabase } from "../connect-database.js";

/** Applies pending migrations without starting the bot, for deployment pipelines. */
loadNearestEnvFile(process.cwd());
const connectionString = process.env["DATABASE_URL"];

if (connectionString === undefined) {
  console.error("DATABASE_URL is not set");
  process.exitCode = 1;
} else {
  const connection = await connectDatabase({ connectionString });
  await connection.close();
  console.log("Database schema is up to date");
}
