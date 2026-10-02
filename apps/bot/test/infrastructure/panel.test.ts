import { Colors, ComponentType, SeparatorSpacingSize } from "discord.js";
import { describe, expect, it } from "vitest";

import { createPanel } from "../../src/infrastructure/discord/components/panel.js";

describe("createPanel", () => {
  it("builds a Components V2 container with title, body, and footer", () => {
    const panel = createPanel({
      body: "Everything is operational.",
      footer: "Live diagnostics",
      title: "LunaEcho",
      tone: "success",
    }).toJSON();

    expect(panel.type).toBe(ComponentType.Container);
    expect(panel.accent_color).toBe(Colors.Green);

    const textComponents = panel.components.filter(
      (component) => component.type === ComponentType.TextDisplay,
    );
    const separator = panel.components.find(
      (component) => component.type === ComponentType.Separator,
    );

    expect(textComponents).toHaveLength(2);
    expect(textComponents[0]?.content).toContain("# LunaEcho");
    expect(textComponents[0]?.content).toContain("Everything is operational.");
    expect(textComponents[1]?.content).toBe("-# Live diagnostics");
    expect(separator).toMatchObject({ divider: true, spacing: SeparatorSpacingSize.Small });
  });

  it("omits the separator when no footer is provided", () => {
    const panel = createPanel({ body: "Body", title: "Title" }).toJSON();

    expect(panel.components).toHaveLength(1);
    expect(panel.components[0]?.type).toBe(ComponentType.TextDisplay);
  });
});
