import { toError, type AppLogger } from "@lunaecho/core";
import type { BotTask, BotTaskQueue } from "@lunaecho/modules";

/** Handles one kind of task; returning normally marks the task completed. */
export type BotTaskHandler = (task: BotTask) => Promise<void>;

const pollMilliseconds = 2_000;
const batchSize = 20;
const pruneEveryMilliseconds = 3_600_000;
const keepCompletedMilliseconds = 7 * 24 * 3_600_000;

/**
 * Picks up work the dashboard queued, such as posting a panel or reloading settings. Polling
 * every two seconds keeps it simple and works with any number of bot and dashboard processes.
 */
export class BotTaskRunner {
  private lastPrune = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly queue: BotTaskQueue,
    private readonly handlers: ReadonlyMap<string, BotTaskHandler>,
    private readonly logger: AppLogger,
  ) {}

  public start(): void {
    this.running = true;
    this.schedule(0);
  }

  public close(): Promise<void> {
    this.running = false;

    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }

    return Promise.resolve();
  }

  /** Runs one polling round; public so tests can drive it without timers. */
  public async poll(now: Date = new Date()): Promise<number> {
    const tasks = await this.queue.claim(batchSize, now);

    for (const task of tasks) {
      const handler = this.handlers.get(task.kind);

      if (handler === undefined) {
        await this.queue.fail(task.id, `No handler for task kind '${task.kind}'`);
        continue;
      }

      try {
        await handler(task);
        await this.queue.complete(task.id);
      } catch (error) {
        const message = toError(error).message;
        this.logger.warn(
          { attempts: task.attempts, err: toError(error), kind: task.kind, taskId: task.id },
          "Bot task failed",
        );
        await this.queue.fail(task.id, message);
      }
    }

    if (now.getTime() - this.lastPrune > pruneEveryMilliseconds) {
      this.lastPrune = now.getTime();
      await this.queue.prune(new Date(now.getTime() - keepCompletedMilliseconds));
    }

    return tasks.length;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.poll()
        .catch((error: unknown) => {
          this.logger.error({ err: toError(error) }, "Polling bot tasks failed");
        })
        .finally(() => {
          if (this.running) {
            this.schedule(pollMilliseconds);
          }
        });
    }, delay);
    this.timer.unref();
  }
}
