import "server-only";

import type { BotTaskKind, BotTaskPayloads } from "@lunaecho/modules";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { DashboardServices } from "@/lib/services";
import { requireWorkspace, scopeFromForm, type Workspace } from "@/lib/workspace";

import { errorNoticeCookie } from "./ui";

/**
 * One submitted settings form. Every action builds one: it re-checks access, because a form can
 * be replayed long after the page was loaded, and validates ids against the live server.
 */
export class SettingsForm {
  private constructor(
    public readonly actorId: string,
    public readonly guildId: string,
    public readonly app: DashboardServices,
    /** Channels and roles as the bot of this form's scope sees them. */
    public readonly discord: Workspace["discord"],
    /** The settings pages this form belongs to, such as /servers/<server>. */
    private readonly base: string,
    private readonly formData: FormData,
    /** The page to return to, such as "/welcome". */
    private readonly page: string,
  ) {}

  public static async open(formData: FormData, page: string): Promise<SettingsForm> {
    const { botId, guildId } = scopeFromForm(formData);
    const { app, base, discord, session } = await requireWorkspace(guildId, botId);
    return new SettingsForm(session.user.id, guildId, app, discord, base, formData, page);
  }

  public text(field: string): string {
    const value = this.formData.get(field);
    return typeof value === "string" ? value : "";
  }

  public optionalText(field: string): string | null {
    const value = this.text(field).trim();
    return value.length === 0 ? null : value;
  }

  public number(field: string): number {
    return Number(this.text(field));
  }

  /** An uploaded file, or undefined when the field was left empty. */
  public file(field: string): File | undefined {
    const value = this.formData.get(field);
    return value instanceof File && value.size > 0 ? value : undefined;
  }

  public checked(field: string): boolean {
    return this.formData.get(field) === "on" || this.formData.get(field) === "true";
  }

  /** A channel of this server with one of the given types, or null when none was picked. */
  public async channel(field: string, types: readonly number[]): Promise<string | null> {
    const id = this.text(field);

    if (id === "") {
      return null;
    }

    const channel = (await this.discord.channels()).find((candidate) => candidate.id === id);

    if (channel === undefined || !types.includes(channel.type)) {
      this.finish("invalid");
    }

    return channel.id;
  }

  public async requiredChannel(field: string, types: readonly number[]): Promise<string> {
    return (await this.channel(field, types)) ?? this.finish("invalid");
  }

  public async channels(field: string, types: readonly number[]): Promise<string[]> {
    const wanted = new Set(this.formData.getAll(field).filter((id) => typeof id === "string"));
    return (await this.discord.channels())
      .filter((channel) => wanted.has(channel.id) && types.includes(channel.type))
      .map((channel) => channel.id);
  }

  public async role(field: string): Promise<string | null> {
    const id = this.text(field);

    if (id === "") {
      return null;
    }

    if (!(await this.discord.roles()).some((role) => role.id === id)) {
      this.finish("invalid");
    }

    return id;
  }

  public async requiredRole(field: string): Promise<string> {
    return (await this.role(field)) ?? this.finish("invalid");
  }

  /** Roles in the order the server lists them; unknown and integration roles are dropped. */
  public async roles(field: string): Promise<string[]> {
    const wanted = new Set(this.formData.getAll(field).filter((id) => typeof id === "string"));
    return (await this.discord.roles())
      .filter((role) => wanted.has(role.id))
      .map((role) => role.id);
  }

  /** Tells the bot to reload this guild's settings, then shows the page with a notice. */
  public async saved(module: string, notice = "saved"): Promise<never> {
    await this.app.tasks.enqueue("settings-changed", this.guildId, { module });
    this.finish(notice);
  }

  public async queue<Kind extends BotTaskKind>(
    kind: Kind,
    payload: BotTaskPayloads[Kind],
  ): Promise<void> {
    await this.app.tasks.enqueue(kind, this.guildId, payload);
  }

  public finish(notice: string): never {
    const path = `${this.base}${this.page}`;
    revalidatePath(path);
    redirect(`${path}?notice=${encodeURIComponent(notice)}`);
  }

  /**
   * Runs a save and turns the service's input errors into a visible message instead of a
   * crash. Next's redirect is an exception too, so everything else is passed on.
   */
  public async attempt(
    save: () => Promise<void>,
    inputErrors: readonly (abstract new (...args: never[]) => Error)[],
  ): Promise<void> {
    try {
      await save();
    } catch (error) {
      const known = inputErrors.find((type) => error instanceof type);

      if (known !== undefined && error instanceof Error) {
        // The text travels in a short-lived cookie, never the URL, so links cannot inject text.
        (await cookies()).set(errorNoticeCookie, error.message.slice(0, 300), {
          httpOnly: true,
          maxAge: 60,
          path: "/",
          sameSite: "lax",
        });
        this.finish("error");
      }

      throw error;
    }
  }
}
