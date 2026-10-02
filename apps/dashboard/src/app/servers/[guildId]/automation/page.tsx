import {
  maximumAutomationActions,
  maximumAutomationRulesPerGuild,
  type AutomationAction,
  type AutomationRule,
} from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import {
  channelTypes,
  fetchGuildChannels,
  fetchGuildRoles,
  type DiscordChannel,
  type DiscordRole,
} from "@/lib/discord";
import { services } from "@/lib/services";

import { Button, Card, Field, HiddenGuild, inputClass, MultiPicker, Notice, Picker } from "../ui";
import { deleteAutomationRule, saveAutomationRule } from "./actions";

export const dynamic = "force-dynamic";

type Choices = Readonly<{ channels: readonly DiscordChannel[]; roles: readonly DiscordRole[] }>;

function describeTrigger(rule: AutomationRule): string {
  switch (rule.trigger.kind) {
    case "member-join":
      return "When a member joins";
    case "message-keyword":
      return `When a message ${rule.trigger.match === "exact" ? "is" : "contains"} ${rule.trigger.keywords.map((keyword) => `“${keyword}”`).join(" or ")}`;
    case "schedule":
      return `Every ${rule.trigger.intervalMinutes / 60} hours`;
  }
}

function ActionSlot({
  action,
  choices,
  slot,
}: Readonly<{ action: AutomationAction | undefined; choices: Choices; slot: number }>) {
  const field = (name: string) => `action-${slot}-${name}`;

  return (
    <fieldset className="grid gap-2 rounded-xl border border-outline p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm">Action {slot + 1}</legend>
      <Field label="Do">
        <select name={field("kind")} defaultValue={action?.kind ?? ""} className={inputClass}>
          <option value="">Nothing</option>
          <option value="send-message">Send a message</option>
          <option value="send-dm">Send the member a direct message</option>
          <option value="add-role">Give the member a role</option>
          <option value="remove-role">Take a role from the member</option>
          <option value="react">React to the message</option>
        </select>
      </Field>
      <Field label="Message channel" hint="Messages: empty means the channel of the trigger.">
        <Picker
          name={field("channel")}
          defaultValue={action?.kind === "send-message" ? action.channelId : null}
          none="Same channel"
          options={choices.channels}
          prefix="#"
        />
      </Field>
      <Field label="Text" hint="Placeholders: {user}, {username}, {server}, {channel}">
        <input
          name={field("text")}
          maxLength={1500}
          defaultValue={
            action?.kind === "send-message" || action?.kind === "send-dm" ? action.text : ""
          }
          className={inputClass}
        />
      </Field>
      <Field label="Role">
        <Picker
          name={field("role")}
          defaultValue={
            action?.kind === "add-role" || action?.kind === "remove-role" ? action.roleId : null
          }
          none="None"
          options={choices.roles}
          prefix="@"
        />
      </Field>
      <Field label="Emoji">
        <input
          name={field("emoji")}
          defaultValue={action?.kind === "react" ? action.emoji : ""}
          className={inputClass}
        />
      </Field>
    </fieldset>
  );
}

function RuleForm({
  choices,
  guildId,
  rule,
}: Readonly<{ choices: Choices; guildId: string; rule: AutomationRule | undefined }>) {
  const trigger = rule?.trigger;

  return (
    <form action={saveAutomationRule} className="grid gap-3 sm:grid-cols-2">
      <HiddenGuild guildId={guildId} />
      {rule !== undefined && <input type="hidden" name="ruleId" value={rule.id} />}
      <Field label="Name">
        <input
          name="name"
          maxLength={80}
          required
          defaultValue={rule?.name ?? ""}
          className={inputClass}
        />
      </Field>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />
        Rule is on
      </label>
      <Field label="When">
        <select
          name="trigger"
          defaultValue={trigger?.kind ?? "message-keyword"}
          className={inputClass}
        >
          <option value="message-keyword">A message matches keywords</option>
          <option value="member-join">A member joins</option>
          <option value="schedule">On a schedule</option>
        </select>
      </Field>
      <Field label="Keywords" hint="Comma separated, for keyword rules. Case does not matter.">
        <input
          name="keywords"
          defaultValue={trigger?.kind === "message-keyword" ? trigger.keywords.join(", ") : ""}
          className={inputClass}
        />
      </Field>
      <Field label="Keyword match">
        <select
          name="match"
          defaultValue={trigger?.kind === "message-keyword" ? trigger.match : "contains"}
          className={inputClass}
        >
          <option value="contains">The message contains a keyword</option>
          <option value="exact">The whole message is a keyword</option>
        </select>
      </Field>
      <Field label="Every … hours" hint="For scheduled rules: 1 to 168 hours.">
        <input
          name="intervalHours"
          type="number"
          min={1}
          max={168}
          step={1}
          defaultValue={trigger?.kind === "schedule" ? trigger.intervalMinutes / 60 : 24}
          className={inputClass}
        />
      </Field>
      <Field label="Only in channels" hint="Keyword rules only. None picked = everywhere.">
        <MultiPicker
          name="channelIds"
          defaultValue={rule?.conditions.channelIds ?? []}
          options={choices.channels}
          prefix="#"
        />
      </Field>
      <Field label="Cooldown per member (seconds)">
        <input
          name="cooldownSeconds"
          type="number"
          min={0}
          max={86400}
          defaultValue={rule?.cooldownSeconds ?? 60}
          className={inputClass}
        />
      </Field>
      <Field label="Member must have">
        <MultiPicker
          name="requiredRoleIds"
          defaultValue={rule?.conditions.requiredRoleIds ?? []}
          options={choices.roles}
          prefix="@"
        />
      </Field>
      <Field label="Member must not have">
        <MultiPicker
          name="excludedRoleIds"
          defaultValue={rule?.conditions.excludedRoleIds ?? []}
          options={choices.roles}
          prefix="@"
        />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        {Array.from({ length: maximumAutomationActions }, (_, slot) => (
          <ActionSlot key={slot} action={rule?.actions[slot]} choices={choices} slot={slot} />
        ))}
        <p className="text-xs text-muted">
          Scheduled rules can only send messages to a fixed channel. Join rules cannot react or use
          “same channel”.
        </p>
      </div>
      <div className="sm:col-span-2">
        <Button>{rule === undefined ? "Create rule" : "Save rule"}</Button>
      </div>
    </form>
  );
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
  const choices: Choices = {
    channels: channels.filter((channel) => channel.type === channelTypes.text),
    roles,
  };

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      <Card
        title="Automation"
        description={`Rules run actions when something happens. ${rules.length}/${maximumAutomationRulesPerGuild} rules.`}
      >
        {rules.length === 0 ? (
          <p className="text-sm text-muted">No rules yet. Create one below.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rules.map((rule) => (
              <li key={rule.id} className="rounded-xl border border-outline p-3">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{rule.name}</span>{" "}
                    <span className="text-sm text-muted">
                      · {describeTrigger(rule)} · {rule.actions.length} actions ·{" "}
                      {rule.enabled ? "on" : "off"}
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <RuleForm choices={choices} guildId={guildId} rule={rule} />
                    <form action={deleteAutomationRule}>
                      <HiddenGuild guildId={guildId} />
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <Button tone="danger">Delete rule</Button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {rules.length < maximumAutomationRulesPerGuild && (
        <Card title="New rule">
          <RuleForm choices={choices} guildId={guildId} rule={undefined} />
        </Card>
      )}
    </div>
  );
}
