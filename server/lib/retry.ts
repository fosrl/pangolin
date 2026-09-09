import logger from "@lib/logger";

export async function withRetry<T>(
    fn: () => Promise<T>,
    options: {
        retries?: number;
        baseDelayMs?: number;
        label?: string;
        // Called with each caught error to decide whether it's worth
        // retrying. Defaults to retrying everything (existing behavior) -
        // pass this to exclude errors that are known to be permanent (e.g.
        // an upstream rate limit or validation rejection) rather than
        // transient, so they fail fast instead of wasting retry attempts.
        shouldRetry?: (error: unknown) => boolean;
    } = {}
): Promise<T> {
    const {
        retries = 3,
        baseDelayMs = 250,
        label = "operation",
        shouldRetry = () => true
    } = options;

    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            attempt++;
            if (attempt > retries || !shouldRetry(error)) {
                throw error;
            }

            // Exponential backoff with jitter so retries don't all land at once.
            const delay =
                baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());

            logger.warn(
                `${label} failed (attempt ${attempt}/${retries + 1}), retrying in ${delay.toFixed(0)}ms`,
                error
            );

            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

// Bounds an operation that has no timeout of its own (e.g. acme-client's
// axios instance never sets one, so a stalled TCP connection to the ACME
// server hangs forever instead of erroring). Without this, a single hung
// call can leave its caller's promise permanently unsettled - fatal for
// code that gates future work on that promise resolving, like the
// scheduler's runExclusive() waiting on a batch's Promise.all.
export async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label = "operation"
): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${ms}ms`)),
            ms
        );
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer!);
    }
}
