import { monitorEventLoopDelay, performance } from "node:perf_hooks";

/** Bucket bounds grow by 5 %, so a reported percentile is within 5 % of the true value. */
const bucketGrowth = 1.05;
const smallestBucketMs = 0.01;
const bucketCount = 400;

/**
 * Records durations in a fixed-size log-scale histogram per operation. Memory stays constant
 * however long a soak test runs; keeping every sample made the harness itself look like a leak.
 */
class Histogram {
  public count = 0;
  public maximum = 0;
  private readonly buckets = new Float64Array(bucketCount);

  public add(milliseconds: number): void {
    const index =
      milliseconds <= smallestBucketMs
        ? 0
        : Math.min(
            bucketCount - 1,
            Math.ceil(Math.log(milliseconds / smallestBucketMs) / Math.log(bucketGrowth)),
          );
    this.buckets[index] = (this.buckets[index] ?? 0) + 1;
    this.count += 1;
    this.maximum = Math.max(this.maximum, milliseconds);
  }

  /** The upper bound of the bucket holding the given quantile. */
  public percentile(quantile: number): number {
    const target = quantile * this.count;
    let seen = 0;

    for (let index = 0; index < bucketCount; index += 1) {
      seen += this.buckets[index] ?? 0;

      if (seen >= target) {
        return Math.min(this.maximum, smallestBucketMs * bucketGrowth ** index);
      }
    }

    return this.maximum;
  }
}

export class LatencyRecorder {
  private readonly histograms = new Map<string, Histogram>();
  private readonly failures = new Map<string, number>();

  public async measure<Result>(operation: string, task: () => Promise<Result>): Promise<Result> {
    const started = performance.now();

    try {
      return await task();
    } catch (error) {
      this.failures.set(operation, (this.failures.get(operation) ?? 0) + 1);
      throw error;
    } finally {
      let histogram = this.histograms.get(operation);

      if (histogram === undefined) {
        histogram = new Histogram();
        this.histograms.set(operation, histogram);
      }

      histogram.add(performance.now() - started);
    }
  }

  public summary(): OperationSummary[] {
    return [...this.histograms.entries()]
      .map(([operation, histogram]) => ({
        count: histogram.count,
        failures: this.failures.get(operation) ?? 0,
        maxMs: round(histogram.maximum),
        operation,
        p50Ms: round(histogram.percentile(0.5)),
        p95Ms: round(histogram.percentile(0.95)),
        p99Ms: round(histogram.percentile(0.99)),
      }))
      .sort((left, right) => left.operation.localeCompare(right.operation));
  }
}

export type OperationSummary = Readonly<{
  count: number;
  failures: number;
  maxMs: number;
  operation: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}>;

export type ProcessSample = Readonly<{
  cpuPercent: number;
  elapsedSeconds: number;
  eventLoopDelayP99Ms: number;
  heapUsedMb: number;
  rssMb: number;
  /** Application state such as open rooms or queued songs, to tell growth from leaks. */
  state: Readonly<Record<string, number>>;
}>;

/** Named readings of application state, registered by each load scenario. */
export type StateProbes = Map<string, () => number>;

/** Samples CPU, memory, and event loop delay of this process at a fixed interval. */
export class ProcessSampler {
  public readonly samples: ProcessSample[] = [];
  private readonly delay = monitorEventLoopDelay({ resolution: 10 });
  private lastCpu = process.cpuUsage();
  private lastTime = performance.now();
  private readonly started = performance.now();
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(private readonly probes: StateProbes = new Map()) {}

  public start(intervalMilliseconds: number, onSample?: (sample: ProcessSample) => void): void {
    this.delay.enable();
    this.timer = setInterval(() => {
      const sample = this.sample();
      this.samples.push(sample);
      onSample?.(sample);
    }, intervalMilliseconds);
  }

  public stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }

    this.delay.disable();
  }

  private sample(): ProcessSample {
    const now = performance.now();
    const cpu = process.cpuUsage(this.lastCpu);
    const wallMicroseconds = (now - this.lastTime) * 1_000;
    const memory = process.memoryUsage();
    const sample = {
      cpuPercent: round(((cpu.user + cpu.system) / wallMicroseconds) * 100),
      elapsedSeconds: round((now - this.started) / 1_000),
      eventLoopDelayP99Ms: round(this.delay.percentile(99) / 1_000_000),
      heapUsedMb: round(memory.heapUsed / 1_048_576),
      rssMb: round(memory.rss / 1_048_576),
      state: Object.fromEntries([...this.probes].map(([name, probe]) => [name, probe()])),
    };

    this.lastCpu = process.cpuUsage();
    this.lastTime = now;
    this.delay.reset();
    return sample;
  }
}

/**
 * Least-squares slope of heap usage in MB per hour, ignoring the warm-up phase. A clearly
 * positive slope over a long run points to a memory leak.
 */
export function heapGrowthPerHour(
  samples: readonly ProcessSample[],
  warmupSeconds: number,
): number {
  const points = samples.filter((sample) => sample.elapsedSeconds >= warmupSeconds);

  if (points.length < 3) {
    return 0;
  }

  const meanX = points.reduce((total, point) => total + point.elapsedSeconds, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.heapUsedMb, 0) / points.length;
  const covariance = points.reduce(
    (total, point) => total + (point.elapsedSeconds - meanX) * (point.heapUsedMb - meanY),
    0,
  );
  const variance = points.reduce((total, point) => total + (point.elapsedSeconds - meanX) ** 2, 0);

  return variance === 0 ? 0 : round((covariance / variance) * 3_600);
}

/** Small seeded generator so a stress run can be repeated exactly. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
