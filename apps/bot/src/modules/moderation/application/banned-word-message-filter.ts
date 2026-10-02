import type { Message } from "discord.js";

import type { AppLogger } from "@lunaecho/core";
import type {
  MessageCreateHandler,
  MessageCreateHandlingResult,
} from "../../../infrastructure/discord/discord-event-handler.js";
import { BannedWordMatcher } from "../domain/banned-word-matcher.js";
import type { ModerationSettingsService } from "@lunaecho/modules";

export class BannedWordMessageFilter implements MessageCreateHandler {
  private readonly matcher = new BannedWordMatcher();

  public constructor(
    private readonly settings: ModerationSettingsService,
    private readonly logger: AppLogger,
  ) {}

  public async handle(message: Message): Promise<MessageCreateHandlingResult> {
    if (
      !message.inGuild() ||
      message.author.bot ||
      message.webhookId !== null ||
      message.content.length === 0
    ) {
      return "continue";
    }

    const settings = await this.settings.getSettings(message.guildId);

    if (!settings.bannedWordsEnabled || settings.bannedWords.length === 0) {
      return "continue";
    }

    const match = this.matcher.findMatch(message.content, settings.bannedWords);

    if (match === undefined) {
      return "continue";
    }

    try {
      await message.delete();
      this.logger.info(
        {
          authorId: message.author.id,
          channelId: message.channelId,
          guildId: message.guildId,
          messageId: message.id,
        },
        "Deleted a message matching the banned-word policy",
      );
      return "stop";
    } catch (error) {
      this.logger.error(
        {
          authorId: message.author.id,
          channelId: message.channelId,
          err: error,
          guildId: message.guildId,
          messageId: message.id,
        },
        "Failed to delete a message matching the banned-word policy",
      );
      return "continue";
    }
  }
}
