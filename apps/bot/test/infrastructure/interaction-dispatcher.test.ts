import {
  EntitlementService,
  getPlanPolicy,
  type EntitlementProvider,
  type EntitlementSnapshot,
  type PlanId,
} from "@lunaecho/core";
import {
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  type Interaction,
  type InteractionReplyOptions,
} from "discord.js";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { ChatInputCommand } from "../../src/infrastructure/discord/commands/chat-input-command.js";
import { CommandRegistry } from "../../src/infrastructure/discord/commands/command-registry.js";
import { ComponentInteractionRegistry } from "../../src/infrastructure/discord/commands/component-interaction-registry.js";
import { InteractionDispatcher } from "../../src/infrastructure/discord/commands/interaction-dispatcher.js";
import type { ModuleGate } from "@lunaecho/modules";
import { createTestModuleService } from "../helpers/create-test-module-service.js";

class CatalogProvider implements EntitlementProvider {
  public constructor(private readonly planId: PlanId) {}

  public resolveForGuild(guildId: string): Promise<EntitlementSnapshot> {
    const policy = getPlanPolicy(this.planId);

    return Promise.resolve({
      capabilities: new Set(policy.capabilities),
      evaluatedAt: new Date("2026-01-01T00:00:00.000Z"),
      guildId,
      planId: policy.id,
      quotas: policy.quotas,
    });
  }
}

function createInteraction(
  commandName: string,
  guildId: string | null = "guild-1",
  memberPermissions = new PermissionsBitField(PermissionFlagsBits.Administrator),
) {
  const reply = vi
    .fn<(options: InteractionReplyOptions) => Promise<void>>()
    .mockResolvedValue(undefined);
  const followUp = vi
    .fn<(options: InteractionReplyOptions) => Promise<void>>()
    .mockResolvedValue(undefined);
  const interaction = {
    commandName,
    deferred: false,
    followUp,
    guildId,
    id: "interaction-1",
    isChatInputCommand: () => true,
    memberPermissions,
    replied: false,
    reply,
    user: { id: "user-1" },
  } as unknown as Interaction;

  return { followUp, interaction, reply };
}

function createDispatcher(
  command: ChatInputCommand,
  planId: PlanId = "self-hosted",
  modules?: ModuleGate,
) {
  const entitlements = new EntitlementService(new CatalogProvider(planId));
  return new InteractionDispatcher(
    new CommandRegistry([command]),
    entitlements,
    pino({ level: "silent" }),
    new ComponentInteractionRegistry([]),
    modules,
  );
}

describe("InteractionDispatcher", () => {
  it("executes a known command", async () => {
    const execute = vi.fn<ChatInputCommand["execute"]>().mockResolvedValue(undefined);
    const command: ChatInputCommand = {
      data: { description: "A test command", name: "test", type: 1 },
      execute,
    };
    const dispatcher = createDispatcher(command);
    const { interaction } = createInteraction("test");

    await dispatcher.handle(interaction);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("returns a safe response for unknown commands", async () => {
    const command: ChatInputCommand = {
      data: { description: "A test command", name: "test", type: 1 },
      execute: vi.fn<ChatInputCommand["execute"]>().mockResolvedValue(undefined),
    };
    const dispatcher = createDispatcher(command);
    const { interaction, reply } = createInteraction("removed-command");

    await dispatcher.handle(interaction);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]?.[0].components).toHaveLength(1);
    expect(reply.mock.calls[0]?.[0].flags).toEqual([
      MessageFlags.Ephemeral,
      MessageFlags.IsComponentsV2,
    ]);
  });

  it("blocks commands that are unavailable on the current plan", async () => {
    const execute = vi.fn<ChatInputCommand["execute"]>().mockResolvedValue(undefined);
    const command: ChatInputCommand = {
      data: { description: "A test command", name: "music-test", type: 1 },
      execute,
      requiredCapability: "music",
    };
    const dispatcher = createDispatcher(command, "cloud");
    const { interaction, reply } = createInteraction("music-test");

    await dispatcher.handle(interaction);
    expect(execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]?.[0].components).toHaveLength(1);
    expect(reply.mock.calls[0]?.[0].flags).toEqual([
      MessageFlags.Ephemeral,
      MessageFlags.IsComponentsV2,
    ]);
  });

  it("blocks a module's commands only in guilds that disabled the module", async () => {
    const execute = vi.fn<ChatInputCommand["execute"]>().mockResolvedValue(undefined);
    const command: ChatInputCommand = {
      data: { description: "A moderation command", name: "moderation-test", type: 1 },
      execute,
      requiredCapability: "moderation",
    };
    const modules = createTestModuleService();
    await modules.setEnabled("guild-1", "moderation", false, "admin-1");
    const dispatcher = createDispatcher(command, "self-hosted", modules);
    const disabledGuild = createInteraction("moderation-test", "guild-1");
    const enabledGuild = createInteraction("moderation-test", "guild-2");

    await dispatcher.handle(disabledGuild.interaction);
    expect(execute).not.toHaveBeenCalled();
    expect(disabledGuild.reply).toHaveBeenCalledOnce();

    await dispatcher.handle(enabledGuild.interaction);
    expect(execute).toHaveBeenCalledOnce();
    expect(enabledGuild.reply).not.toHaveBeenCalled();
  });

  it("enforces administrator permissions at execution time", async () => {
    const execute = vi.fn<ChatInputCommand["execute"]>().mockResolvedValue(undefined);
    const command: ChatInputCommand = {
      data: { description: "An admin command", name: "admin-test", type: 1 },
      execute,
      requiredMemberPermissions: PermissionFlagsBits.Administrator,
    };
    const dispatcher = createDispatcher(command);
    const { interaction, reply } = createInteraction(
      "admin-test",
      "guild-1",
      new PermissionsBitField(0n),
    );

    await dispatcher.handle(interaction);
    expect(execute).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce();
  });
});
