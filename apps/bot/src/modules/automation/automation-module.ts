import { ExpiringCache, toError, type AppLogger } from "@lunaecho/core";
import type { LunaDatabase } from "@lunaecho/db";
import {
  AutomationService,
  conditionsMet,
  matchesKeyword,
  renderAutomationText,
  type AutomationRule,
} from "@lunaecho/modules";
import type { Client, Guild, GuildMember, Message } from "discord.js";

import {
  listen,
  type BotModule,
  type ModuleContext,
} from "../../infrastructure/discord/bot-module.js";

const scheduleIntervalMilliseconds = 60_000;

/** What a rule acts on. Scheduled rules have no member and no source message. */
type RunContext = Readonly<{
  channelId: string | null;
  guild: Guild;
  member: GuildMember | null;
  message: Message | null;
}>;

/** Runs the actions of matching rules. One failing action does not stop the others. */
export class AutomationRunner {
  /** Cooldown deadlines per rule and member. */
  private readonly cooldowns = new ExpiringCache<string, number>({
    clock: () => new Date(),
    maximumEntries: 50_000,
    ttlMilliseconds: 86_400_000,
  });
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly rules: AutomationService,
    private readonly client: Client,
    private readonly moduleRuns: (guildId: string) => Promise<boolean>,
    private readonly logger: AppLogger,
  ) {}

  public start(): void {
    this.timer = setInterval(() => {
      void this.runScheduled().catch((error: unknown) => {
        this.logger.error({ err: toError(error) }, "Running scheduled automations failed");
      });
    }, scheduleIntervalMilliseconds);
    this.timer.unref();
  }

  public close(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }

    return Promise.resolve();
  }

  public async runScheduled(): Promise<void> {
    for (const rule of await this.rules.takeDueScheduled()) {
      const guild = this.client.guilds.cache.get(rule.guildId);

      if (guild !== undefined && (await this.moduleRuns(rule.guildId))) {
        await this.run(rule, { channelId: null, guild, member: null, message: null });
      }
    }
  }

  public async onMemberJoin(member: GuildMember): Promise<void> {
    if (member.user.bot || !(await this.moduleRuns(member.guild.id))) {
      return;
    }

    for (const rule of await this.rules.rulesFor(member.guild.id, "member-join")) {
      await this.runIfAllowed(rule, {
        channelId: null,
        guild: member.guild,
        member,
        message: null,
      });
    }
  }

  public async onMessage(message: Message<true>): Promise<void> {
    if (message.author.bot || message.member === null || message.content.length === 0) {
      return;
    }

    const rules = await this.rules.rulesFor(message.guildId, "message-keyword");
    const matching = rules.filter((rule) => matchesKeyword(rule.trigger, message.content));

    if (matching.length === 0 || !(await this.moduleRuns(message.guildId))) {
      return;
    }

    for (const rule of matching) {
      await this.runIfAllowed(rule, {
        channelId: message.channelId,
        guild: message.guild,
        member: message.member,
        message,
      });
    }
  }

  private async runIfAllowed(rule: AutomationRule, context: RunContext): Promise<void> {
    const roleIds = new Set(context.member?.roles.cache.keys() ?? []);

    if (!conditionsMet(rule.conditions, { channelId: context.channelId, roleIds })) {
      return;
    }

    const cooldownKey = `${rule.id}:${context.member?.id ?? ""}`;

    if (rule.cooldownSeconds > 0) {
      const now = Date.now();

      if ((this.cooldowns.get(cooldownKey) ?? 0) > now) {
        return;
      }

      this.cooldowns.set(cooldownKey, now + rule.cooldownSeconds * 1_000);
    }

    await this.run(rule, context);
  }

  private async run(rule: AutomationRule, context: RunContext): Promise<void> {
    const values = {
      channelId: context.channelId,
      serverName: context.guild.name,
      userId: context.member?.id ?? null,
      username: context.member?.user.username ?? null,
    };
    // Automations may greet the member who triggered them, but never ping roles or @everyone.
    const allowedMentions = { users: context.member === null ? [] : [context.member.id] };

    for (const action of rule.actions) {
      try {
        switch (action.kind) {
          case "send-message": {
            const channel = this.client.channels.cache.get(
              action.channelId ?? context.channelId ?? "",
            );

            if (channel?.isSendable() === true && !channel.isDMBased()) {
              await channel.send({
                allowedMentions,
                content: renderAutomationText(action.text, values),
              });
            }

            break;
          }
          case "send-dm":
            await context.member?.send({
              allowedMentions: { parse: [] },
              content: renderAutomationText(action.text, values),
            });
            break;
          case "add-role":
            await context.member?.roles.add(action.roleId, `Automation: ${rule.name}`);
            break;
          case "remove-role":
            await context.member?.roles.remove(action.roleId, `Automation: ${rule.name}`);
            break;
          case "react":
            await context.message?.react(action.emoji);
            break;
        }
      } catch (error) {
        this.logger.debug(
          { action: action.kind, err: toError(error), guildId: rule.guildId, ruleId: rule.id },
          "Automation action failed",
        );
      }
    }
  }
}

export function createAutomationModule(context: ModuleContext, database: LunaDatabase): BotModule {
  const rules = new AutomationService(database);
  const runner = new AutomationRunner(
    rules,
    context.client,
    (guildId) => context.moduleRuns(guildId, "automation"),
    context.logger.child({ component: "automation" }),
  );

  return {
    invalidate: (guildId) => {
      rules.invalidate(guildId);
    },
    listeners: [
      listen("guildMemberAdd", "automation.member-join", (member) => runner.onMemberJoin(member)),
    ],
    messageHandlers: [
      {
        handle: async (message) => {
          if (message.inGuild()) {
            await runner.onMessage(message);
          }

          return "continue";
        },
      },
    ],
    name: "automation",
    onReady: () => {
      runner.start();
      return Promise.resolve();
    },
    resources: [runner],
  };
}
