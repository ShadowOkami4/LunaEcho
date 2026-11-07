import { join } from "node:path";

import {
  defaultWelcomeCard,
  maximumWelcomeCardTextLength,
  renderWelcomeCard,
  renderWelcomeCardText,
  welcomeCardBackgrounds,
  welcomeCardLayouts,
  type WelcomeCardDesign,
} from "@lunaecho/modules";

import { userAvatarUrl } from "@/lib/discord";
import { getActiveSession } from "@/lib/session";
import { requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const colorPattern = /^#[0-9a-f]{6}$/i;
/** The dashboard serves the same font files the bot uses from its public folder. */
const fontFolder = join(process.cwd(), "public", "fonts");

function pick<Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * Draws the welcome or goodbye card with the unsaved design from the designer's query string,
 * using the signed-in user as the sample member. Only people who manage the server may ask.
 */
export async function GET(
  request: Request,
  { params }: Readonly<{ params: Promise<{ botId?: string; guildId: string }> }>,
): Promise<Response> {
  const { botId, guildId } = await params;

  if ((await getActiveSession()) === undefined) {
    return new Response(null, { status: 401 });
  }

  // Answers 404 unless the user manages the server and the bot (LunaEcho or theirs) is in it.
  const { app, guild, session } = await requireWorkspace(guildId, botId);

  const query = new URL(request.url).searchParams;
  const color = (name: string, fallback: string) => {
    const value = query.get(name) ?? "";
    return colorPattern.test(value) ? value : fallback;
  };
  const text = (name: string, fallback: string) =>
    (query.get(name) ?? fallback).slice(0, maximumWelcomeCardTextLength);
  const design: WelcomeCardDesign = {
    accentColor: color("accentColor", defaultWelcomeCard.accentColor),
    background: pick(query.get("background"), welcomeCardBackgrounds, "luna"),
    layout: pick(query.get("layout"), welcomeCardLayouts, "centered"),
    overlayOpacity: Math.min(80, Math.max(0, Math.round(Number(query.get("overlayOpacity")) || 0))),
    textColor: color("textColor", defaultWelcomeCard.textColor),
  };
  const displayName = session.user.globalName ?? session.user.username;
  const values = { displayName, memberCount: 128, serverName: guild.name };
  const avatarUrl = userAvatarUrl(session.user, 256);
  const avatar =
    avatarUrl === null
      ? undefined
      : await fetch(avatarUrl, { signal: AbortSignal.timeout(5_000) })
          .then(async (response) =>
            response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined,
          )
          .catch(() => undefined);
  const backgroundImage =
    design.background === "image" ? await app.welcomeCards.getBackgroundImage(guildId) : undefined;

  const png = await renderWelcomeCard({
    backgroundImage,
    content: {
      avatar,
      displayName,
      subtitle: renderWelcomeCardText(text("subtitle", ""), values),
      title: renderWelcomeCardText(text("title", "Welcome, {username}!"), values),
    },
    design,
    fontFolder,
  });

  return new Response(new Uint8Array(png), {
    headers: { "Cache-Control": "private, no-store", "Content-Type": "image/png" },
  });
}
