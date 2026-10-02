import type { AppLogger } from "@lunaecho/core";
import type { MusicService, MusicSettingsService } from "@lunaecho/modules";

import type {
  ComponentInteractionHandler,
  RoutedComponentInteraction,
} from "../../infrastructure/discord/commands/component-interaction-registry.js";
import { updatePanel } from "../../infrastructure/discord/commands/interaction-responder.js";
import {
  controlMessages,
  createMusicPlayerPanel,
  musicPanelActions,
  musicPanelPrefix,
  resolveMusicRequester,
  runMusicPanelAction,
  type MusicPanelAction,
} from "./music-panel.js";

function isMusicPanelAction(value: string): value is MusicPanelAction {
  return musicPanelActions.some((action) => action === value);
}

/** The player panel's buttons; the panel redraws itself after every action. */
export class MusicPanelHandler implements ComponentInteractionHandler {
  public readonly customIdPrefix = musicPanelPrefix;
  public readonly requiredCapability = "music";

  public constructor(
    private readonly music: MusicService | undefined,
    private readonly settings: MusicSettingsService,
  ) {}

  public async handle(interaction: RoutedComponentInteraction, logger: AppLogger): Promise<void> {
    if (interaction.isModalSubmit() || !interaction.inCachedGuild()) {
      return;
    }

    const action = interaction.customId.slice(musicPanelPrefix.length);

    if (this.music === undefined || !isMusicPanelAction(action)) {
      await updatePanel(interaction, createMusicPlayerPanel(undefined, "Music is unavailable."));
      return;
    }

    const requester = await resolveMusicRequester(this.settings, interaction);
    const result = await runMusicPanelAction(this.music, interaction.guildId, requester, action);

    if (result !== "done") {
      logger.debug({ action, result }, "Music panel action refused");
    }

    await updatePanel(
      interaction,
      createMusicPlayerPanel(this.music.getSession(interaction.guildId), controlMessages[result]),
    );
  }
}
