import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";

/**
 * Loads the nearest `.env` file, walking up from the working directory. Workspace scripts run
 * inside `apps/bot`, while the file lives at the repository root. Variables that are already set
 * are never overwritten, and a missing file is fine for deployments that inject the environment.
 */
export function loadNearestEnvFile(startDirectory: string): void {
  let directory = startDirectory;

  for (;;) {
    const candidate = join(directory, ".env");

    if (existsSync(candidate)) {
      loadEnvFile(candidate);
      return;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return;
    }

    directory = parent;
  }
}
