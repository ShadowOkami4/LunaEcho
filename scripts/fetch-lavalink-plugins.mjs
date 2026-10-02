/**
 * Downloads the Lavalink plugins into lavalink/plugins, which docker-compose mounts. Lavalink loads
 * every jar it finds there, so startup no longer depends on Lavalink's plugin repository.
 *
 *   npm run lavalink:plugins
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const plugins = [
  // A snapshot build: release 1.18.2 can no longer decipher YouTube's current player script, and the
  // fixes after it (newer client versions, iOS playback) are not released yet. Switch back to a
  // release from https://github.com/lavalink-devs/youtube-source/releases once one includes them.
  {
    file: "youtube-plugin-2be8e542d3f6f178e048dca565892684c2e40177.jar",
    url: "https://maven.lavalink.dev/snapshots/dev/lavalink/youtube/youtube-plugin/2be8e542d3f6f178e048dca565892684c2e40177/youtube-plugin-2be8e542d3f6f178e048dca565892684c2e40177.jar",
  },
];

const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "lavalink", "plugins");
await mkdir(directory, { recursive: true });

for (const plugin of plugins) {
  const target = join(directory, plugin.file);
  const existing = await stat(target).catch(() => undefined);

  if (existing !== undefined && existing.size > 0) {
    console.log(`${plugin.file} is already present`);
    continue;
  }

  const response = await fetch(plugin.url);

  if (!response.ok) {
    throw new Error(`Downloading ${plugin.file} failed with HTTP ${response.status}`);
  }

  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  console.log(`Downloaded ${plugin.file}`);
}
