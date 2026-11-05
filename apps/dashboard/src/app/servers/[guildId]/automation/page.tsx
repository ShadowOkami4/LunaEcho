import { maximumAutomationRulesPerGuild, type AutomationRule } from "@lunaecho/modules";

import { Icon, type IconName } from "@/components/icon";
import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels, fetchGuildRoles } from "@/lib/discord";
import { services } from "@/lib/services";

import { Button, Card, Chip, HiddenGuild, Notice } from "../ui";
import { deleteAutomationRule, saveAutomationRule } from "./actions";
import { emptyRule, RuleBuilder, type RuleDraft } from "./rule-builder";

export const dynamic = "force-dynamic";

const triggerIcons: Readonly<Record<AutomationRule["trigger"]["kind"], IconName>> = {
  "member-join": "personAdd",
  "message-keyword": "chat",
  schedule: "schedule",
};

function describeTrigger(rule: AutomationRule): string {
  switch (rule.trigger.kind) {
    case "member-join":
      return "When a member joins";
    case "message-keyword": {
      const words = rule.trigger.keywords.slice(0, 3).map((keyword) => `“${keyword}”`);
      const more = rule.trigger.keywords.length > 3 ? ` +${rule.trigger.keywords.length - 3}` : "";
      return `When a message ${rule.trigger.match === "exact" ? "is" : "contains"} ${words.join(", ")}${more}`;
    }
    case "schedule":
      return `Every ${rule.trigger.intervalMinutes / 60} hours`;
  }
}

/** The stored rule in the shape the builder edits. */
function toDraft(rule: AutomationRule): RuleDraft {
  return {
    actions: rule.actions.map((action) => ({ ...action })),
    conditions: rule.conditions,
    cooldownSeconds: rule.cooldownSeconds,
    enabled: rule.enabled,
    id: rule.id,
    intervalHours: rule.trigger.kind === "schedule" ? rule.trigger.intervalMinutes / 60 : 24,
    keywords: rule.trigger.kind === "message-keyword" ? rule.trigger.keywords : [],
    match: rule.trigger.kind === "message-keyword" ? rule.trigger.match : "contains",
    name: rule.name,
    trigger: rule.trigger.kind,
  };
}

export default async function AutomationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  app.automation.invalidate(guildId);
  const [rules, channels, roles] = await Promise.all([
    app.automation.list(guildId),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ]);
  const channelOptions = channels
    .filter((channel) => channel.type === channelTypes.text)
    .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));
  const roleOptions = roles.map((role) => ({ color: role.color, id: role.id, name: role.name }));
  const full = rules.length >= maximumAutomationRulesPerGuild;

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      <Card
        icon="bolt"
        title="Rules"
        description={`Rules do something when a keyword appears, a member joins, or on a schedule. ${rules.length} of ${maximumAutomationRulesPerGuild} rules.`}
      >
        {rules.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-m3-lg bg-surface px-6 py-8 text-center">
            <Icon name="bolt" className="size-8 text-faint" />
            <p className="font-medium">No rules yet</p>
            <p className="max-w-md text-sm text-muted">
              Start with something simple, like reacting to “hello” or greeting new members in a
              channel.
            </p>
          </div>
        ) : (
          <ul className="stagger flex flex-col gap-2">
            {rules.map((rule) => (
              <li key={rule.id}>
                <details className="rounded-m3-lg bg-surface open:bg-surface-high/50">
                  <summary className="flex cursor-pointer items-center gap-3 rounded-m3-lg px-4 py-3 hover:bg-surface-high/70">
                    <span
                      className={`shape-cookie9 grid size-10 shrink-0 place-items-center ${
                        rule.enabled ? "icon-tile-on" : "icon-tile-off"
                      }`}
                    >
                      <Icon name={triggerIcons[rule.trigger.kind]} className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{rule.name}</p>
                      <p className="truncate text-sm text-muted">
                        {describeTrigger(rule)} · {rule.actions.length} action
                        {rule.actions.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {rule.enabled ? (
                      <Chip tone="success" icon="checkCircle">
                        On
                      </Chip>
                    ) : (
                      <Chip>Off</Chip>
                    )}
                    <Icon name="expandMore" className="m3-chevron size-6 text-muted" />
                  </summary>
                  <div className="flex flex-col gap-2 border-t border-outline/50 p-4">
                    <RuleBuilder
                      action={saveAutomationRule}
                      channels={channelOptions}
                      guildId={guildId}
                      initial={toDraft(rule)}
                      roles={roleOptions}
                    />
                    <form action={deleteAutomationRule} className="-mt-11 self-start">
                      <HiddenGuild guildId={guildId} />
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <Button tone="remove" icon="delete">
                        Delete rule
                      </Button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!full && (
        <Card
          collapsible
          defaultOpen={rules.length === 0}
          icon="add"
          title="New rule"
          description="Pick when it runs, add conditions if you need them, then choose what it does."
        >
          <RuleBuilder
            action={saveAutomationRule}
            channels={channelOptions}
            guildId={guildId}
            initial={emptyRule}
            roles={roleOptions}
          />
        </Card>
      )}
    </div>
  );
}
