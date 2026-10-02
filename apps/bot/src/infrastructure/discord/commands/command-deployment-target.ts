export type CommandDeploymentTarget =
  Readonly<{ scope: "global" }> | Readonly<{ guildId: string; scope: "guild" }>;

export class CommandDeploymentTargetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CommandDeploymentTargetError";
  }
}

export function resolveCommandDeploymentTarget(
  arguments_: readonly string[],
  developmentGuildId: string | undefined,
): CommandDeploymentTarget {
  const knownArguments = new Set(["--global"]);
  const unknownArgument = arguments_.find((argument) => !knownArguments.has(argument));

  if (unknownArgument !== undefined) {
    throw new CommandDeploymentTargetError(`Unknown argument: ${unknownArgument}`);
  }

  if (arguments_.includes("--global")) {
    return { scope: "global" };
  }

  if (developmentGuildId !== undefined) {
    return { guildId: developmentGuildId, scope: "guild" };
  }

  throw new CommandDeploymentTargetError(
    "Set DISCORD_DEVELOPMENT_GUILD_ID for a guild deployment, or pass --global explicitly.",
  );
}
