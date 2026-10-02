import type { ButtonInteraction } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
  ComponentInteractionRegistry,
  DuplicateComponentHandlerError,
  type ComponentInteractionHandler,
} from "../../src/infrastructure/discord/commands/component-interaction-registry.js";

function createHandler(customIdPrefix: string): ComponentInteractionHandler {
  return {
    customIdPrefix,
    handle: vi.fn<(interaction: ButtonInteraction) => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe("ComponentInteractionRegistry", () => {
  it("routes to the most specific matching prefix", () => {
    const general = createHandler("moderation:");
    const specific = createHandler("moderation:v1:");
    const registry = new ComponentInteractionRegistry([general, specific]);

    expect(registry.find("moderation:v1:add")).toBe(specific);
    expect(registry.find("tickets:v1:open")).toBeUndefined();
  });

  it("rejects duplicate prefixes", () => {
    expect(
      () =>
        new ComponentInteractionRegistry([
          createHandler("duplicate:"),
          createHandler("duplicate:"),
        ]),
    ).toThrow(DuplicateComponentHandlerError);
  });
});
