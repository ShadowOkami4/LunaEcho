import { randomBytes } from "node:crypto";

import { createLogger } from "@lunaecho/core";
import type { DatabaseConnection } from "@lunaecho/db";
import { createTestDatabase, resetTestDatabase } from "@lunaecho/db/testing";
import { CustomBotService, TokenVault, type BotTokenInspection } from "@lunaecho/modules";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseProvisioner } from "../src/database-provisioner.js";
import type { ContainerDetails, ContainerSummary, DockerApi } from "../src/docker-client.js";
import { containerName, Reconciler } from "../src/reconciler.js";
import type { SecretStore } from "../src/secret-store.js";

const token = "MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.not-a-real-token-but-shaped-like-one";
const otherToken = "OTg3NjU0MzIxMDk4NzY1NDMy.Gxyzab.another-fake-token-shaped-like-one";
const inspection: BotTokenInspection = {
  applicationId: "app-1",
  avatarHash: null,
  botUserId: "user-1",
  hasMembersIntent: true,
  hasMessageContentIntent: true,
  name: "Kitty",
};

interface FakeContainer {
  id: string;
  labels: Record<string, string>;
  restartCount: number;
  running: boolean;
  spec: Record<string, unknown>;
  startedAt: string;
}

/** An in-memory Docker that keeps containers by name. */
class FakeDocker implements DockerApi {
  public readonly containers = new Map<string, FakeContainer>();
  /** The id behind the bot image's tag; a new value stands for a newly loaded image. */
  public image = "sha256:first";
  public now = new Date("2026-01-01T00:00:00.000Z");

  public listContainers(label: string): Promise<readonly ContainerSummary[]> {
    const [key, value] = label.split("=");
    return Promise.resolve(
      [...this.containers.entries()]
        .filter(
          ([, container]) =>
            key !== undefined &&
            key in container.labels &&
            (value === undefined || container.labels[key] === value),
        )
        .map(([name, container]) => ({
          Id: name,
          Labels: container.labels,
          Names: [`/${name}`],
          State: container.running ? "running" : "exited",
          Status: "",
        })),
    );
  }

  public inspectContainer(id: string): Promise<ContainerDetails | undefined> {
    const container = this.containers.get(id);
    return Promise.resolve(
      container === undefined
        ? undefined
        : {
            Id: id,
            RestartCount: container.restartCount,
            State: {
              ExitCode: container.running ? 0 : 1,
              Restarting: false,
              Running: container.running,
              StartedAt: container.startedAt,
              Status: container.running ? "running" : "exited",
            },
          },
    );
  }

  public createContainer(name: string, spec: Readonly<Record<string, unknown>>): Promise<string> {
    this.containers.set(name, {
      id: name,
      labels: { ...(spec["Labels"] as Record<string, string>) },
      restartCount: 0,
      running: false,
      spec: { ...spec },
      startedAt: "0001-01-01T00:00:00Z",
    });
    return Promise.resolve(name);
  }

  public startContainer(id: string): Promise<void> {
    const container = this.containers.get(id);

    if (container !== undefined) {
      container.running = true;
      container.startedAt = this.now.toISOString();
    }

    return Promise.resolve();
  }

  public stopContainer(id: string): Promise<void> {
    const container = this.containers.get(id);

    if (container !== undefined) {
      container.running = false;
    }

    return Promise.resolve();
  }

  public removeContainer(id: string): Promise<void> {
    this.containers.delete(id);
    return Promise.resolve();
  }

  public imageId(): Promise<string | undefined> {
    return Promise.resolve(this.image);
  }
}

class FakeDatabases implements DatabaseProvisioner {
  public readonly databases = new Set<string>();

  public ensure(name: string, password: string): Promise<string> {
    this.databases.add(name);
    return Promise.resolve(`postgres://${name}:${password}@custom-postgres:5432/${name}`);
  }

  public drop(name: string): Promise<void> {
    this.databases.delete(name);
    return Promise.resolve();
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeSecrets implements SecretStore {
  public readonly folders = new Map<string, Record<string, string>>();

  public databasePassword(botId: string): Promise<string> {
    const folder = this.folders.get(botId) ?? {};
    folder["database-password"] ??= "db-password";
    this.folders.set(botId, folder);
    return Promise.resolve(folder["database-password"]);
  }

  public write(botId: string, files: Readonly<Record<string, string>>): Promise<void> {
    this.folders.set(botId, { ...this.folders.get(botId), ...files });
    return Promise.resolve();
  }

  public remove(botId: string): Promise<void> {
    this.folders.delete(botId);
    return Promise.resolve();
  }
}

describe("Reconciler", () => {
  let connection: DatabaseConnection;
  let bots: CustomBotService;
  let docker: FakeDocker;
  let databases: FakeDatabases;
  let secrets: FakeSecrets;
  let reconciler: Reconciler;

  beforeAll(async () => {
    connection = await createTestDatabase();
    bots = new CustomBotService(connection.db, new TokenVault(randomBytes(32)));
  });

  beforeEach(async () => {
    docker = new FakeDocker();
    databases = new FakeDatabases();
    secrets = new FakeSecrets();
    reconciler = new Reconciler(
      bots,
      docker,
      databases,
      secrets,
      {
        image: "lunaecho-bot:test",
        lavalink: { password: "lavalink-secret", url: "lavalink:2333" },
        memoryBytes: 256 * 1024 * 1024,
        network: "lunaecho-custom",
        secretsVolume: "lunaecho-custom-secrets",
      },
      createLogger({ logLevel: "silent", nodeEnvironment: "test", service: "test" }),
      () => docker.now,
    );
    await bots.grant("alice", 2, "operator");
  });

  afterEach(async () => {
    await resetTestDatabase(connection.db);
  });

  afterAll(async () => {
    await connection.close();
  });

  async function status(botId: string) {
    return (await bots.getOwned("alice", botId)).status;
  }

  it("starts a new bot with its own database and the token only in its secrets", async () => {
    const bot = await bots.create("alice", token, inspection);

    await reconciler.reconcileOnce();
    const container = docker.containers.get(containerName(bot.id));
    const spec = JSON.stringify(container?.spec);

    expect(container?.running).toBe(true);
    expect(databases.databases.size).toBe(1);
    expect(secrets.folders.get(bot.id)?.["discord-token"]).toBe(token);
    expect(spec).not.toContain(token);
    expect(spec).not.toContain("lavalink-secret");
    expect(spec).toContain("LUNA_RUNTIME_MODE=cloud-custom");
    expect(spec).toContain(`"Subpath":"${bot.id}"`);
    await expect(status(bot.id)).resolves.toBe("starting");

    docker.now = new Date(docker.now.getTime() + 30_000);
    await reconciler.reconcileOnce();
    await expect(status(bot.id)).resolves.toBe("running");
  });

  it("stops a bot and reports a crash loop as failed", async () => {
    const bot = await bots.create("alice", token, inspection);
    await reconciler.reconcileOnce();

    await bots.setDesiredState("alice", bot.id, "stopped");
    await reconciler.reconcileOnce();
    expect(docker.containers.get(containerName(bot.id))?.running).toBe(false);
    await expect(status(bot.id)).resolves.toBe("stopped");

    await bots.setDesiredState("alice", bot.id, "running");
    const container = docker.containers.get(containerName(bot.id));

    if (container !== undefined) {
      container.restartCount = 3;
    }

    await reconciler.reconcileOnce();
    const failed = await bots.getOwned("alice", bot.id);
    expect(failed.status).toBe("failed");
    expect(failed.statusMessage).toContain("keeps stopping");
  });

  it("recreates the container when the token changes", async () => {
    const bot = await bots.create("alice", token, inspection);
    await reconciler.reconcileOnce();
    const before = docker.containers.get(containerName(bot.id))?.labels["lunaecho.custom.revision"];

    await bots.replaceToken("alice", bot.id, otherToken, inspection);
    await reconciler.reconcileOnce();

    expect(
      docker.containers.get(containerName(bot.id))?.labels["lunaecho.custom.revision"],
    ).not.toBe(before);
    expect(secrets.folders.get(bot.id)?.["discord-token"]).toBe(otherToken);
  });

  it("rolls a bot over to a newly loaded image under the same tag", async () => {
    const bot = await bots.create("alice", token, inspection);
    await reconciler.reconcileOnce();
    const revision = () =>
      docker.containers.get(containerName(bot.id))?.labels["lunaecho.custom.revision"];
    const before = revision();

    await reconciler.reconcileOnce();
    expect(revision()).toBe(before);

    docker.image = "sha256:second";
    await reconciler.reconcileOnce();
    expect(revision()).not.toBe(before);
    expect(docker.containers.get(containerName(bot.id))?.running).toBe(true);
  });

  it("removes everything of a deleted bot, and containers that have no bot", async () => {
    const bot = await bots.create("alice", token, inspection);
    await reconciler.reconcileOnce();
    await docker.createContainer("stray", { Labels: { "lunaecho.custom.bot": "gone" } });

    await bots.setDesiredState("alice", bot.id, "deleted");
    await reconciler.reconcileOnce();

    expect(docker.containers.size).toBe(0);
    expect(databases.databases.size).toBe(0);
    expect(secrets.folders.has(bot.id)).toBe(false);
    await expect(bots.listDeployments()).resolves.toEqual([]);
  });
});
