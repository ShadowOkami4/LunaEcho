import type { Ticket } from "@lunaecho/modules";

export type TranscriptMessage = Readonly<{
  attachments: readonly string[];
  authorName: string;
  bot: boolean;
  content: string;
  createdAt: Date;
}>;

/** Plain text, oldest message first, so it reads like the conversation did. */
export function formatTranscript(
  ticket: Ticket,
  guildName: string,
  messages: readonly TranscriptMessage[],
): string {
  const header = [
    `Ticket #${ticket.number} · ${guildName}`,
    `Topic: ${ticket.topic}`,
    `Opened by ${ticket.openerId} at ${ticket.createdAt.toISOString()}`,
    `Closed by ${ticket.closedBy ?? "unknown"}${ticket.closeReason === null ? "" : `: ${ticket.closeReason}`}`,
    "",
  ];
  const lines = messages.map((message) => {
    const files = message.attachments.map((url) => `\n    [file] ${url}`).join("");
    const author = message.bot ? `${message.authorName} [bot]` : message.authorName;
    return `[${message.createdAt.toISOString()}] ${author}: ${message.content}${files}`;
  });
  return [...header, ...lines].join("\n");
}
