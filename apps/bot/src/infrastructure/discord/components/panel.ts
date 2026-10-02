import {
  Colors,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ActionRowBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";

export type PanelTone = "danger" | "info" | "neutral" | "success" | "warning";

export type PanelOptions = Readonly<{
  body: string;
  footer?: string;
  /** Buttons and select menus shown below the text, one row each. */
  rows?: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[];
  title: string;
  tone?: PanelTone;
}>;

const accentColors = {
  danger: Colors.Red,
  info: Colors.Blurple,
  neutral: Colors.Greyple,
  success: Colors.Green,
  warning: Colors.Yellow,
} as const satisfies Readonly<Record<PanelTone, number>>;

/** Creates a Components V2 container for consistent bot responses. */
export function createPanel(options: PanelOptions): ContainerBuilder {
  const container = new ContainerBuilder()
    .setAccentColor(accentColors[options.tone ?? "info"])
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${options.title}\n${options.body}`),
    );

  if (options.rows !== undefined && options.rows.length > 0) {
    container.addActionRowComponents(...options.rows);
  }

  if (options.footer !== undefined) {
    container
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${options.footer}`));
  }

  return container;
}
