/**
 * Operator commands, run inside the orchestrator container:
 *
 *   node dist/cli.js grant <discord-user-id> <slots> [note…]   allow a user that many Custom bots
 *   node dist/cli.js grants                                    list grants and their use
 *   node dist/cli.js bots                                      list Custom bots and their status
 *   node dist/cli.js add <discord-user-id> < token-file        register a bot for a customer
 *   node dist/cli.js remove <bot-id>                           ask the orchestrator to delete a bot
 *
 * Tokens are never printed.
 */
import { readFileSync } from "node:fs";

import { connectDatabase } from "@lunaecho/db";
import { CustomBotService, inspectBotToken, TokenVault } from "@lunaecho/modules";

function secret(name: string): string {
  const file = process.env[`${name}_FILE`];
  const value = file === undefined ? process.env[name] : readFileSync(file, "utf8").trim();

  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }

  return value;
}

const [command, ...args] = process.argv.slice(2);
const control = await connectDatabase({
  connectionString: secret("CONTROL_DATABASE_URL"),
  poolSize: 1,
  runMigrations: false,
});
const bots = new CustomBotService(
  control.db,
  TokenVault.fromKeyFile(process.env["TOKEN_KEY_FILE"] ?? "/run/secrets/token-key"),
);

try {
  switch (command) {
    case "grant": {
      const [userId, slots, ...note] = args;

      if (userId === undefined || !/^\d{17,20}$/.test(userId) || slots === undefined) {
        throw new Error("Usage: grant <discord-user-id> <slots> [note…]");
      }

      await bots.grant(
        userId,
        Number(slots),
        "operator",
        note.length === 0 ? null : note.join(" "),
      );
      console.log(`${userId} may now run ${slots} Custom bot(s).`);
      break;
    }
    case "grants":
      console.table(await bots.listGrants());
      break;
    case "bots":
      console.table(
        (await bots.listDeployments()).map((bot) => ({
          desired: bot.desiredState,
          id: bot.id,
          message: bot.statusMessage ?? "",
          name: bot.name,
          owner: bot.ownerUserId,
          status: bot.status,
        })),
      );
      break;
    case "add": {
      const [ownerId] = args;

      if (ownerId === undefined || !/^\d{17,20}$/.test(ownerId)) {
        throw new Error("Usage: add <discord-user-id> < token-file");
      }

      // The token comes from standard input, so it never shows up in a shell history.
      const chunks: Buffer[] = [];

      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }

      const token = Buffer.concat(chunks).toString("utf8").trim();
      const inspection = await inspectBotToken(token);
      const bot = await bots.create(ownerId, token, inspection);
      console.log(`Registered ${bot.name} (${bot.id}); the orchestrator starts it shortly.`);
      break;
    }
    case "remove": {
      const [botId] = args;
      const bot = (await bots.listDeployments()).find((candidate) => candidate.id === botId);

      if (bot === undefined) {
        throw new Error("No such bot.");
      }

      await bots.setDesiredState(bot.ownerUserId, bot.id, "deleted");
      console.log(`${bot.name} will be removed with its database.`);
      break;
    }
    default:
      throw new Error(
        "Commands: grant <user-id> <slots> [note…] | grants | bots | add <user-id> | remove <bot-id>",
      );
  }
} finally {
  await control.close();
}
