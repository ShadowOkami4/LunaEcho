import type { AppLogger, Capability, EntitlementService } from "@lunaecho/core";
import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export type CommandExecutionContext = Readonly<{
  entitlements: EntitlementService;
  interaction: ChatInputCommandInteraction;
  logger: AppLogger;
}>;

export interface ChatInputCommand {
  readonly data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  readonly guildOnly?: boolean;
  readonly requiredCapability?: Capability;
  readonly requiredMemberPermissions?: bigint;

  execute(context: CommandExecutionContext): Promise<void>;
}
