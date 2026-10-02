"use server";

import {
  AutomationInputError,
  maximumAutomationActions,
  type AutomationAction,
  type AutomationTrigger,
} from "@lunaecho/modules";
import { z } from "zod";

import { channelTypes } from "@/lib/discord";

import { SettingsForm } from "../form";

const page = "/automation";

function readTrigger(form: SettingsForm): AutomationTrigger {
  switch (z.enum(["member-join", "message-keyword", "schedule"]).parse(form.text("trigger"))) {
    case "member-join":
      return { kind: "member-join" };
    case "message-keyword":
      return {
        keywords: form.text("keywords").split(","),
        kind: "message-keyword",
        match: form.text("match") === "exact" ? "exact" : "contains",
      };
    case "schedule":
      return { intervalMinutes: Math.round(form.number("intervalHours") * 60), kind: "schedule" };
  }
}

/** Action slots left on "none" are skipped. */
async function readActions(form: SettingsForm): Promise<AutomationAction[]> {
  const actions: AutomationAction[] = [];

  for (let slot = 0; slot < maximumAutomationActions; slot += 1) {
    const field = (name: string) => `action-${slot}-${name}`;
    const kind = form.text(field("kind"));

    switch (kind) {
      case "send-message":
        actions.push({
          channelId: await form.channel(field("channel"), [channelTypes.text]),
          kind,
          text: form.text(field("text")),
        });
        break;
      case "send-dm":
        actions.push({ kind, text: form.text(field("text")) });
        break;
      case "add-role":
      case "remove-role":
        actions.push({ kind, roleId: await form.requiredRole(field("role")) });
        break;
      case "react":
        actions.push({ emoji: form.text(field("emoji")), kind });
        break;
      default:
        break;
    }
  }

  return actions;
}

export async function saveAutomationRule(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  const ruleId = form.optionalText("ruleId") ?? undefined;
  const trigger = readTrigger(form);
  const actions = await readActions(form);

  await form.attempt(async () => {
    await form.app.automation.save(
      {
        actions,
        conditions: {
          channelIds: await form.channels("channelIds", [channelTypes.text]),
          excludedRoleIds: await form.roles("excludedRoleIds"),
          requiredRoleIds: await form.roles("requiredRoleIds"),
        },
        cooldownSeconds: form.number("cooldownSeconds"),
        enabled: form.checked("enabled"),
        guildId: form.guildId,
        name: form.text("name"),
        trigger,
        ...(ruleId === undefined ? {} : { id: ruleId }),
      },
      form.actorId,
    );
  }, [AutomationInputError]);
  await form.saved("automation");
}

export async function deleteAutomationRule(formData: FormData): Promise<void> {
  const form = await SettingsForm.open(formData, page);
  await form.app.automation.delete(form.guildId, form.text("ruleId"));
  await form.saved("automation", "removed");
}
