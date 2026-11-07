import { request } from "node:http";

export class DockerError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

export type ContainerSummary = Readonly<{
  Id: string;
  Labels: Readonly<Record<string, string>>;
  Names: readonly string[];
  State: string;
  Status: string;
}>;

export type ContainerDetails = Readonly<{
  Id: string;
  RestartCount: number;
  State: Readonly<{
    ExitCode: number;
    Restarting: boolean;
    Running: boolean;
    StartedAt: string;
    Status: string;
  }>;
}>;

/** The parts of the Docker Engine API the orchestrator uses, so tests can stand in for it. */
export interface DockerApi {
  listContainers(label: string): Promise<readonly ContainerSummary[]>;
  inspectContainer(id: string): Promise<ContainerDetails | undefined>;
  createContainer(name: string, spec: Readonly<Record<string, unknown>>): Promise<string>;
  startContainer(id: string): Promise<void>;
  stopContainer(id: string): Promise<void>;
  removeContainer(id: string): Promise<void>;
  /** The local image's id (sha256:…), or undefined when Docker does not have it. */
  imageId(reference: string): Promise<string | undefined>;
}

/** A small Docker Engine API client over the Unix socket; no third-party dependency. */
export class DockerClient implements DockerApi {
  public constructor(private readonly socketPath = "/var/run/docker.sock") {}

  public async listContainers(label: string): Promise<readonly ContainerSummary[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
    return (await this.call(
      "GET",
      `/containers/json?all=true&filters=${filters}`,
    )) as ContainerSummary[];
  }

  public async inspectContainer(id: string): Promise<ContainerDetails | undefined> {
    try {
      return (await this.call(
        "GET",
        `/containers/${encodeURIComponent(id)}/json`,
      )) as ContainerDetails;
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) {
        return undefined;
      }

      throw error;
    }
  }

  public async createContainer(
    name: string,
    spec: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const created = (await this.call(
      "POST",
      `/containers/create?name=${encodeURIComponent(name)}`,
      spec,
    )) as { Id: string };
    return created.Id;
  }

  public async startContainer(id: string): Promise<void> {
    await this.call("POST", `/containers/${encodeURIComponent(id)}/start`, undefined, [304]);
  }

  public async stopContainer(id: string): Promise<void> {
    await this.call("POST", `/containers/${encodeURIComponent(id)}/stop?t=15`, undefined, [304]);
  }

  public async removeContainer(id: string): Promise<void> {
    await this.call("DELETE", `/containers/${encodeURIComponent(id)}?force=true`, undefined, [404]);
  }

  public async imageId(reference: string): Promise<string | undefined> {
    try {
      const image = (await this.call("GET", `/images/${encodeURIComponent(reference)}/json`)) as {
        Id: string;
      };
      return image.Id;
    } catch (error) {
      if (error instanceof DockerError && error.status === 404) {
        return undefined;
      }

      throw error;
    }
  }

  private call(
    method: string,
    path: string,
    body?: unknown,
    acceptedStatuses: readonly number[] = [],
  ): Promise<unknown> {
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return new Promise((resolve, reject) => {
      const outgoing = request(
        {
          headers: payload === undefined ? {} : { "Content-Type": "application/json" },
          method,
          path: `/v1.45${path}`,
          socketPath: this.socketPath,
          timeout: 30_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const status = response.statusCode ?? 0;
            const text = Buffer.concat(chunks).toString("utf8");

            if (status >= 200 && status < 300) {
              resolve(text === "" ? undefined : (JSON.parse(text) as unknown));
            } else if (acceptedStatuses.includes(status)) {
              resolve(undefined);
            } else {
              let message = text;

              try {
                message = (JSON.parse(text) as { message?: string }).message ?? text;
              } catch {
                // Not JSON; keep the raw text.
              }

              reject(
                new DockerError(status, `Docker ${method} ${path.split("?")[0] ?? ""}: ${message}`),
              );
            }
          });
        },
      );
      outgoing.on("timeout", () => outgoing.destroy(new Error("Docker API timed out")));
      outgoing.on("error", reject);
      outgoing.end(payload);
    });
  }
}
