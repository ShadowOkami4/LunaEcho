import type { Message } from "discord.js";

export type MessageCreateHandlingResult = "continue" | "stop";

export interface MessageCreateHandler {
  handle(message: Message): Promise<MessageCreateHandlingResult>;
}
