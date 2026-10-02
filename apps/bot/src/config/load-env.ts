import { loadNearestEnvFile } from "@lunaecho/core";

// Imported first by every entry point so the environment is ready before anything reads it.
loadNearestEnvFile(process.cwd());
