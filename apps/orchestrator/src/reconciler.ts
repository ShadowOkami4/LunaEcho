import { createHash } from "node:crypto";

import { toError, type AppLogger } from "@lunaecho/core";
import type { CustomBotDeployment, CustomBotService, CustomBotStatus } from "@lunaecho/modules";

import type { DatabaseProvisioner } from "./database-provisioner.js";
import type { DockerApi } from "./docker-client.js";
import type { SecretStore } from "./secret-store.js";

export type ReconcilerConfig = Readonly<{
  /** The bot image every Custom bot runs, for example lunaecho-bot:latest. */
  image: string;
  lavalink: Readonly<{ password: string; url: string }> | undefined;
  /** Memory limit per bot in bytes. */
  memoryBytes: number;
  /** The Docker network shared with the Custom database and Lavalink. */
  network: string;
  /** The Docker volume holding one secrets folder per bot. */
  secretsVolume: string;
}>;

const managedLabel = "lunaecho.custom.bot";
const revisionLabel = "lunaecho.custom.revision";
const secretsMount = "/run/secrets/lunaecho";
/** A bot that crashed this often in a row is reported as failed instead of starting forever. */
const crashLimit = 3;
/** A bot only counts as running once it stayed up this long. */
const settleMilliseconds = 20_000;

export function containerName(botId: string): string {
  return `lunaecho-custom-${botId}`;
}

/**
 * Brings Docker in line with what customers asked for in the dashboard: one container and one
 * database per running bot, nothing for deleted ones. Runs again and again, so a failed step is
 * simply retried on the next pass.
 */
export class Reconciler {
  public constructor(
    private readonly bots: CustomBotService,
    private readonly docker: DockerApi,
    private readonly databases: DatabaseProvisioner,
    private readonly secrets: SecretStore,
    private readonly config: ReconcilerConfig,
    private readonly logger: AppLogger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async reconcileOnce(): Promise<void> {
    const deployments = await this.bots.listDeployments();
    const known = new Set(deployments.map((deployment) => deployment.id));
    // The tag stays lunaecho-bot:latest across releases; its id changes with every new image, so
    // loading a new image rolls every bot over to it on the next pass.
    const imageId = (await this.docker.imageId(this.config.image)) ?? this.config.image;

    for (const deployment of deployments) {
      try {
        await this.reconcile(deployment, imageId);
      } catch (error) {
        this.logger.warn({ botId: deployment.id, err: toError(error) }, "Reconciling a bot failed");
        await this.report(deployment, "failed", "LunaEcho could not start this bot. It retries.");
      }
    }

    // Containers whose bot no longer exists, for example after a database restore.
    for (const container of await this.docker.listContainers(managedLabel)) {
      const botId = container.Labels[managedLabel];

      if (botId !== undefined && !known.has(botId)) {
        this.logger.info({ botId }, "Removing a container without a bot");
        await this.docker.removeContainer(container.Id);
      }
    }
  }

  private async reconcile(deployment: CustomBotDeployment, imageId: string): Promise<void> {
    const name = containerName(deployment.id);

    if (deployment.desiredState === "deleted") {
      await this.docker.removeContainer(name);
      await this.databases.drop(deployment.databaseName);
      await this.secrets.remove(deployment.id);
      await this.bots.forget(deployment.id);
      this.logger.info({ botId: deployment.id }, "Custom bot removed");
      return;
    }

    if (deployment.desiredState === "stopped") {
      const details = await this.docker.inspectContainer(name);

      if (details?.State.Running === true || details?.State.Restarting === true) {
        await this.docker.stopContainer(name);
      }

      await this.report(deployment, "stopped");
      return;
    }

    let token: string;

    try {
      token = this.bots.openToken(deployment);
    } catch {
      await this.report(deployment, "failed", "The stored token cannot be read. Enter it again.");
      return;
    }

    const password = await this.secrets.databasePassword(deployment.id);
    const databaseUrl = await this.databases.ensure(deployment.databaseName, password);
    await this.secrets.write(deployment.id, {
      "database-url": databaseUrl,
      "discord-token": token,
      ...(this.config.lavalink === undefined
        ? {}
        : { "lavalink-password": this.config.lavalink.password }),
    });

    const revision = this.revisionOf(deployment, imageId);
    const existing = (await this.docker.listContainers(`${managedLabel}=${deployment.id}`))[0];

    const current = existing?.Labels[revisionLabel] === revision;

    if (existing !== undefined && !current) {
      // A new token, image, or setting: replace the container rather than patch it.
      await this.docker.removeContainer(existing.Id);
    }

    if (!current) {
      await this.docker.createContainer(name, this.containerSpec(deployment, revision));
      await this.docker.startContainer(name);
      await this.report(deployment, "starting");
      return;
    }

    const details = await this.docker.inspectContainer(name);

    if (details === undefined) {
      return;
    }

    if (details.RestartCount >= crashLimit && !details.State.Running) {
      await this.report(
        deployment,
        "failed",
        "The bot keeps stopping. Check that the token is current and that the Server Members and Message Content intents are enabled.",
      );
      return;
    }

    if (!details.State.Running && !details.State.Restarting) {
      await this.docker.startContainer(name);
      await this.report(deployment, "starting");
      return;
    }

    const startedAt = Date.parse(details.State.StartedAt);
    const settled =
      details.State.Running &&
      Number.isFinite(startedAt) &&
      this.clock().getTime() - startedAt >= settleMilliseconds;
    await this.report(deployment, settled ? "running" : "starting");
  }

  private async report(
    deployment: CustomBotDeployment,
    status: CustomBotStatus,
    message: string | null = null,
  ): Promise<void> {
    if (deployment.status !== status || deployment.statusMessage !== message) {
      await this.bots.reportStatus(deployment.id, status, message);
    }
  }

  /** Changes whenever the container must be recreated. */
  private revisionOf(deployment: CustomBotDeployment, imageId: string): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          imageId,
          this.config.memoryBytes,
          this.config.lavalink?.url ?? null,
          deployment.applicationId,
          deployment.sealedToken,
        ]),
      )
      .digest("hex")
      .slice(0, 16);
  }

  private containerSpec(
    deployment: CustomBotDeployment,
    revision: string,
  ): Readonly<Record<string, unknown>> {
    const lavalink =
      this.config.lavalink === undefined
        ? []
        : [
            `LAVALINK_URL=${this.config.lavalink.url}`,
            `LAVALINK_PASSWORD_FILE=${secretsMount}/lavalink-password`,
          ];

    return {
      Env: [
        "NODE_ENV=production",
        "LOG_LEVEL=info",
        "LUNA_RUNTIME_MODE=cloud-custom",
        `DISCORD_APPLICATION_ID=${deployment.applicationId}`,
        `DISCORD_TOKEN_FILE=${secretsMount}/discord-token`,
        `DATABASE_URL_FILE=${secretsMount}/database-url`,
        ...lavalink,
      ],
      HostConfig: {
        LogConfig: { Config: { "max-file": "3", "max-size": "10m" }, Type: "json-file" },
        Memory: this.config.memoryBytes,
        Mounts: [
          {
            ReadOnly: true,
            Source: this.config.secretsVolume,
            Target: secretsMount,
            Type: "volume",
            VolumeOptions: { Subpath: deployment.id },
          },
        ],
        NetworkMode: this.config.network,
        RestartPolicy: { MaximumRetryCount: crashLimit, Name: "on-failure" },
      },
      Image: this.config.image,
      Labels: { [managedLabel]: deployment.id, [revisionLabel]: revision },
    };
  }
}
