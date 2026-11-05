import {
  automodActionNames,
  automodProfileDescriptions,
  automodProfileNames,
  automodRuleActions,
  automodRuleCatalog,
  formatAutomodThreshold,
  getAutomodThresholdConstraints,
  maximumBannedWordsPerGuild,
} from "@lunaecho/modules";

import { requireManageableGuild } from "@/lib/access";
import { channelTypes, fetchGuildChannels, fetchGuildRoles } from "@/lib/discord";
import { services } from "@/lib/services";

import {
  addBannedWord,
  applyAutomodProfile,
  removeBannedWord,
  setExemption,
  setModerationFlag,
  updateAutomodRule,
} from "../actions";
import { Icon } from "@/components/icon";

import {
  Button,
  Card,
  Chip,
  Field,
  HiddenGuild,
  InputChip,
  inputClass,
  Notice,
  Switch,
  SwitchField,
} from "../ui";

export const dynamic = "force-dynamic";

const configurableProfiles = ["off", "relaxed", "balanced", "strict"] as const;

function FlagForm({
  description,
  enabled,
  flag,
  guildId,
  label,
}: Readonly<{
  description: string;
  enabled: boolean;
  flag: string;
  guildId: string;
  label: string;
}>) {
  return (
    <form action={setModerationFlag} className="flex items-center justify-between gap-4">
      <HiddenGuild guildId={guildId} />
      <input type="hidden" name="flag" value={flag} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <Switch label={`${label}: ${enabled ? "on" : "off"}`} on={enabled} />
    </form>
  );
}

export default async function ModerationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ notice?: string }>;
}>) {
  const { guildId } = await params;
  await requireManageableGuild(guildId);
  const app = await services();
  const [settings, cases, channels, roles] = await Promise.all([
    app.moderationSettings.getSettings(guildId),
    app.moderationCases.listRecent(guildId, 20),
    fetchGuildChannels(guildId),
    fetchGuildRoles(guildId),
  ]);
  const channelName = new Map(channels.map((channel) => [channel.id, channel.name]));
  const roleName = new Map(roles.map((role) => [role.id, role.name]));
  const exemptableChannels = channels.filter(
    (channel) =>
      (channel.type === channelTypes.text || channel.type === channelTypes.voice) &&
      !settings.exemptChannelIds.includes(channel.id),
  );
  const exemptableRoles = roles.filter((role) => !settings.exemptRoleIds.includes(role.id));

  return (
    <div className="flex flex-col gap-4">
      <Notice code={(await searchParams).notice} />

      <Card
        icon="tune"
        title="AutoMod profile"
        description={automodProfileDescriptions[settings.automodProfile]}
      >
        <form action={applyAutomodProfile} className="flex flex-col gap-3">
          <HiddenGuild guildId={guildId} />
          {/* An M3 connected button group: each button applies its profile at once. */}
          <div role="group" aria-label="AutoMod profile" className="flex flex-wrap gap-1">
            {configurableProfiles.map((profile) => {
              const selected = settings.automodProfile === profile;

              return (
                <button
                  key={profile}
                  type="submit"
                  name="profile"
                  value={profile}
                  aria-pressed={selected}
                  className={`m3-button inline-flex h-10 items-center gap-2 px-5 text-sm font-semibold ${
                    selected
                      ? "bg-secondary-container text-on-secondary-container"
                      : "bg-surface text-muted hover:bg-surface-high hover:text-on-surface"
                  }`}
                >
                  {selected && <Icon name="checkCircle" className="-ml-1 size-[18px]" />}
                  {automodProfileNames[profile]}
                </button>
              );
            })}
            {settings.automodProfile === "custom" && (
              <span className="inline-flex h-10 items-center rounded-m3-md bg-secondary-container px-5 text-sm font-semibold text-on-secondary-container">
                Custom
              </span>
            )}
          </div>
          <p className="text-xs text-faint">
            Choosing a profile replaces the settings of every rule below.
          </p>
        </form>
      </Card>

      <Card
        icon="rule"
        title="AutoMod rules"
        description={`${settings.automodRules.filter((rule) => rule.enabled).length} of ${settings.automodRules.length} rules are on. Open a rule to change how it reacts.`}
      >
        <ul className="flex flex-col gap-2">
          {settings.automodRules.map((rule) => {
            const presentation = automodRuleCatalog[rule.kind];

            return (
              <li key={rule.kind}>
                <details className="group rounded-m3-lg bg-surface transition-colors open:bg-surface-high/60">
                  <summary className="flex cursor-pointer items-center gap-3 rounded-m3-lg px-4 py-3 hover:bg-surface-high/70">
                    <span
                      aria-hidden
                      className={`size-2.5 shrink-0 rounded-full ${rule.enabled ? "bg-success" : "bg-outline-strong/60"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{presentation.label}</p>
                      <p className="truncate text-sm text-muted">{formatAutomodThreshold(rule)}</p>
                    </div>
                    {rule.enabled ? (
                      <Chip tone="primary">{automodActionNames[rule.action]}</Chip>
                    ) : (
                      <Chip>Off</Chip>
                    )}
                    <Icon name="expandMore" className="m3-chevron size-6 text-muted" />
                  </summary>

                  <form
                    action={updateAutomodRule}
                    className="flex flex-col gap-4 border-t border-outline/50 px-4 pt-4 pb-4"
                  >
                    <HiddenGuild guildId={guildId} />
                    <input type="hidden" name="kind" value={rule.kind} />
                    <p className="text-sm text-muted">{presentation.description}</p>
                    <SwitchField
                      name="enabled"
                      label="Rule is on"
                      description="When off, LunaEcho ignores this kind of message."
                      defaultChecked={rule.enabled}
                    />
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Response">
                        <select name="action" defaultValue={rule.action} className={inputClass}>
                          {automodRuleActions.map((action) => (
                            <option key={action} value={action}>
                              {automodActionNames[action]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {getAutomodThresholdConstraints(rule.kind).map((constraint) => (
                        <Field
                          key={constraint.field}
                          label={constraint.label}
                          hint={constraint.description}
                        >
                          <input
                            name={constraint.field}
                            type="number"
                            min={constraint.minimum}
                            max={constraint.maximum}
                            defaultValue={rule.threshold[constraint.field] ?? constraint.minimum}
                            className={inputClass}
                          />
                        </Field>
                      ))}
                      <Field
                        label="Timeout (minutes)"
                        hint="Used by the “Delete + timeout” response."
                      >
                        <input
                          name="timeoutMinutes"
                          type="number"
                          min={5}
                          max={1440}
                          defaultValue={rule.timeoutSeconds / 60}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end">
                      <Button icon="checkCircle">Save rule</Button>
                    </div>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-8 xl:grid-cols-2">
        <Card
          collapsible
          icon="block"
          title="Banned words"
          description={`${settings.bannedWords.length}/${maximumBannedWordsPerGuild} entries. Matching messages are deleted.`}
        >
          <FlagForm
            description="Delete messages that contain a listed word."
            enabled={settings.bannedWordsEnabled}
            flag="bannedWords"
            guildId={guildId}
            label="Word filter"
          />
          <form action={addBannedWord} className="flex gap-2">
            <HiddenGuild guildId={guildId} />
            <input
              name="word"
              required
              minLength={2}
              maxLength={64}
              placeholder="Word or phrase"
              className={`${inputClass} flex-1`}
            />
            <Button>Add</Button>
          </form>
          <ul className="flex flex-wrap gap-2">
            {settings.bannedWords.map((word) => (
              <li key={word.normalizedValue}>
                <form action={removeBannedWord}>
                  <HiddenGuild guildId={guildId} />
                  <input type="hidden" name="word" value={word.displayValue} />
                  <InputChip removeLabel={`Remove ${word.displayValue}`}>
                    {word.displayValue}
                  </InputChip>
                </form>
              </li>
            ))}
          </ul>
        </Card>

        <Card collapsible icon="settings" title="Behaviour">
          <FlagForm
            description="Members who can moderate are never acted on by AutoMod."
            enabled={settings.staffExempt}
            flag="staffExempt"
            guildId={guildId}
            label="Staff bypass AutoMod"
          />
          <FlagForm
            description="Tell members privately when they are warned, timed out, or removed."
            enabled={settings.dmNotificationsEnabled}
            flag="dmNotifications"
            guildId={guildId}
            label="Notify members by DM"
          />
        </Card>
      </div>

      <Card
        collapsible
        icon="visibilityOff"
        title="Exceptions"
        description="AutoMod ignores these channels and roles."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {(
            [
              ["channel", settings.exemptChannelIds, channelName, exemptableChannels],
              ["role", settings.exemptRoleIds, roleName, exemptableRoles],
            ] as const
          ).map(([kind, exemptIds, names, options]) => (
            <div key={kind} className="flex flex-col gap-3">
              <h3 className="font-medium">{kind === "channel" ? "Channels" : "Roles"}</h3>
              <form action={setExemption} className="flex gap-2">
                <HiddenGuild guildId={guildId} />
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="exempt" value="true" />
                <select name="targetId" required className={`${inputClass} flex-1`}>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {kind === "channel" ? `#${option.name}` : `@${option.name}`}
                    </option>
                  ))}
                </select>
                <Button tone="neutral">Add</Button>
              </form>
              <ul className="flex flex-wrap gap-2">
                {exemptIds.map((id) => (
                  <li key={id}>
                    <form action={setExemption}>
                      <HiddenGuild guildId={guildId} />
                      <input type="hidden" name="kind" value={kind} />
                      <input type="hidden" name="targetId" value={id} />
                      <input type="hidden" name="exempt" value="false" />
                      <InputChip removeLabel={`Remove exception for ${names.get(id) ?? id}`}>
                        {kind === "channel" ? "#" : "@"}
                        {names.get(id) ?? id}
                      </InputChip>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card
        collapsible
        defaultOpen={false}
        icon="history"
        title="Recent cases"
        description={`The newest ${cases.length} moderation cases.`}
      >
        {cases.length === 0 ? (
          <p className="text-sm text-muted">No cases yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Member</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline">
                {cases.map((moderationCase) => (
                  <tr key={moderationCase.caseNumber}>
                    <td className="py-2 pr-4">{moderationCase.caseNumber}</td>
                    <td className="py-2 pr-4">{moderationCase.action}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {moderationCase.targetUserId ?? "—"}
                    </td>
                    <td className="max-w-xs truncate py-2 pr-4">{moderationCase.reason}</td>
                    <td className="py-2 pr-4">{moderationCase.status}</td>
                    <td className="py-2 whitespace-nowrap">
                      {moderationCase.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
