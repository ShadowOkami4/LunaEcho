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
import { Button, Card, HiddenGuild, inputClass, Notice } from "../ui";

export const dynamic = "force-dynamic";

const configurableProfiles = ["off", "relaxed", "balanced", "strict"] as const;

function FlagForm({
  enabled,
  flag,
  guildId,
  label,
}: Readonly<{ enabled: boolean; flag: string; guildId: string; label: string }>) {
  return (
    <form action={setModerationFlag} className="flex items-center justify-between gap-4">
      <HiddenGuild guildId={guildId} />
      <input type="hidden" name="flag" value={flag} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <span>
        {label}:{" "}
        <strong className={enabled ? "text-success" : "text-muted"}>
          {enabled ? "on" : "off"}
        </strong>
      </span>
      <Button tone="neutral">{enabled ? "Turn off" : "Turn on"}</Button>
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
        title="AutoMod profile"
        description={`Current: ${automodProfileNames[settings.automodProfile]} — ${automodProfileDescriptions[settings.automodProfile]}`}
      >
        <form action={applyAutomodProfile} className="flex flex-wrap items-center gap-3">
          <HiddenGuild guildId={guildId} />
          <select name="profile" defaultValue="balanced" className={inputClass}>
            {configurableProfiles.map((profile) => (
              <option key={profile} value={profile}>
                {automodProfileNames[profile]}
              </option>
            ))}
          </select>
          <Button>Apply profile</Button>
          <span className="text-sm text-muted">Replaces all rule settings below.</span>
        </form>
      </Card>

      <Card title="AutoMod rules" description="Each rule has its own response.">
        <ul className="divide-y divide-outline">
          {settings.automodRules.map((rule) => {
            const presentation = automodRuleCatalog[rule.kind];

            return (
              <li key={rule.kind} className="py-3">
                <form
                  action={updateAutomodRule}
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <HiddenGuild guildId={guildId} />
                  <input type="hidden" name="kind" value={rule.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {presentation.emoji} {presentation.label}
                    </p>
                    <p className="text-sm text-muted">
                      {presentation.description} · {formatAutomodThreshold(rule)}
                    </p>
                  </div>
                  <select name="enabled" defaultValue={String(rule.enabled)} className={inputClass}>
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                  <select name="action" defaultValue={rule.action} className={inputClass}>
                    {automodRuleActions.map((action) => (
                      <option key={action} value={action}>
                        {automodActionNames[action]}
                      </option>
                    ))}
                  </select>
                  <Button tone="neutral">Save</Button>
                  <div className="flex w-full flex-wrap gap-3 text-xs text-muted">
                    {getAutomodThresholdConstraints(rule.kind).map((constraint) => (
                      <label
                        key={constraint.field}
                        className="flex items-center gap-2"
                        title={constraint.description}
                      >
                        {constraint.label}
                        <input
                          name={constraint.field}
                          type="number"
                          min={constraint.minimum}
                          max={constraint.maximum}
                          defaultValue={rule.threshold[constraint.field] ?? constraint.minimum}
                          className={`${inputClass} w-20`}
                        />
                      </label>
                    ))}
                    <label
                      className="flex items-center gap-2"
                      title="Used by the delete and timeout response"
                    >
                      Timeout (minutes)
                      <input
                        name="timeoutMinutes"
                        type="number"
                        min={5}
                        max={1440}
                        defaultValue={rule.timeoutSeconds / 60}
                        className={`${inputClass} w-20`}
                      />
                    </label>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Banned words"
          description={`${settings.bannedWords.length}/${maximumBannedWordsPerGuild} entries. Matching messages are deleted.`}
        >
          <FlagForm
            enabled={settings.bannedWordsEnabled}
            flag="bannedWords"
            guildId={guildId}
            label="Filter"
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
                <form
                  action={removeBannedWord}
                  className="flex items-center gap-1 rounded-full bg-surface-highest py-1 pr-1 pl-3 text-sm"
                >
                  <HiddenGuild guildId={guildId} />
                  <input type="hidden" name="word" value={word.displayValue} />
                  {word.displayValue}
                  <button
                    type="submit"
                    aria-label={`Remove ${word.displayValue}`}
                    className="rounded-full px-2 text-muted hover:bg-danger-container hover:text-danger"
                  >
                    ×
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Behaviour">
          <FlagForm
            enabled={settings.staffExempt}
            flag="staffExempt"
            guildId={guildId}
            label="Staff bypass AutoMod"
          />
          <FlagForm
            enabled={settings.dmNotificationsEnabled}
            flag="dmNotifications"
            guildId={guildId}
            label="Notify members by DM"
          />
        </Card>
      </div>

      <Card title="Exceptions" description="AutoMod ignores these channels and roles.">
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
                    <form
                      action={setExemption}
                      className="flex items-center gap-1 rounded-full bg-surface-highest py-1 pr-1 pl-3 text-sm"
                    >
                      <HiddenGuild guildId={guildId} />
                      <input type="hidden" name="kind" value={kind} />
                      <input type="hidden" name="targetId" value={id} />
                      <input type="hidden" name="exempt" value="false" />
                      {names.get(id) ?? id}
                      <button
                        type="submit"
                        aria-label="Remove exception"
                        className="rounded-full px-2 text-muted hover:bg-danger-container hover:text-danger"
                      >
                        ×
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Recent cases" description="The newest 20 moderation cases.">
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
