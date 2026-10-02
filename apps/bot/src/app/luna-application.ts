import type { AppLogger, EntitlementService } from "@lunaecho/core";

import type { BotGateway } from "../infrastructure/discord/discord-gateway.js";
import type { ModerationActionService } from "@lunaecho/modules";
import type { ModerationSettingsService } from "@lunaecho/modules";
import type { ModuleSettingsService } from "@lunaecho/modules";

export type ApplicationState = "created" | "starting" | "running" | "stopping" | "stopped";

export type ApplicationServices = Readonly<{
  entitlements: EntitlementService;
  moderationActions: ModerationActionService;
  moderationSettings: ModerationSettingsService;
  moduleSettings: ModuleSettingsService;
}>;

export interface CloseableResource {
  close(): Promise<void>;
}

export class LunaApplication {
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private currentState: ApplicationState = "created";
  private resourcesClosed = false;

  public constructor(
    private readonly gateway: BotGateway,
    private readonly logger: AppLogger,
    public readonly services: ApplicationServices,
    private readonly resources: readonly CloseableResource[] = [],
  ) {}

  public get state(): ApplicationState {
    return this.currentState;
  }

  public start(): Promise<void> {
    if (this.currentState === "stopped" || this.currentState === "stopping") {
      return Promise.reject(new Error(`Cannot start application while it is ${this.currentState}`));
    }

    this.startPromise ??= this.startInternal();
    return this.startPromise;
  }

  public stop(): Promise<void> {
    this.stopPromise ??= this.stopInternal();
    return this.stopPromise;
  }

  private async startInternal(): Promise<void> {
    this.currentState = "starting";
    this.logger.info("Starting LunaEcho");

    try {
      await this.gateway.connect();
      this.currentState = "running";
      this.logger.info("LunaEcho started");
    } catch (error) {
      this.currentState = "stopped";
      this.logger.error({ err: error }, "LunaEcho failed to start");
      throw error;
    }
  }

  private async stopInternal(): Promise<void> {
    if (this.currentState === "stopped") {
      await this.closeResources();
      return;
    }

    if (this.currentState === "starting" && this.startPromise !== undefined) {
      try {
        await this.startPromise;
      } catch {
        return;
      }
    }

    this.currentState = "stopping";
    this.logger.info("Stopping LunaEcho");

    try {
      await this.gateway.disconnect();
    } finally {
      try {
        await this.closeResources();
      } finally {
        this.currentState = "stopped";
        this.logger.info("LunaEcho stopped");
      }
    }
  }

  private async closeResources(): Promise<void> {
    if (this.resourcesClosed) {
      return;
    }

    this.resourcesClosed = true;
    await Promise.all(this.resources.map((resource) => resource.close()));
  }
}
