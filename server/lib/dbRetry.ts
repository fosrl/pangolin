import logger from "@server/logger";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;

/**
 * Detect transient errors that are safe to retry (connection drops, deadlocks,
 * serialization failures). PostgreSQL deadlocks (40P01) are always safe to
 * retry: the database guarantees exactly one winner per deadlock pair, so the
 * loser just needs to try again.
 */
export function isTransientError(error: any): boolean {
    if (!error) return false;

    const message = (error.message || "").toLowerCase();
    const causeMessage = (error.cause?.message || "").toLowerCase();
    const code = error.code || error.cause?.code || "";

    // Connection timeout / terminated
    if (
        message.includes("connection timeout") ||
        message.includes("connection terminated") ||
        message.includes("timeout exceeded when trying to connect") ||
        causeMessage.includes("connection terminated unexpectedly") ||
        causeMessage.includes("connection timeout")
    ) {
        return true;
    }

    // PostgreSQL deadlock detected - always safe to retry (one winner guaranteed)
    if (code === "40P01" || message.includes("deadlock")) {
        return true;
    }

    // PostgreSQL serialization failure
    if (code === "40001") {
        return true;
    }

    // ECONNRESET, ECONNREFUSED, EPIPE, ETIMEDOUT
    if (
        code === "ECONNRESET" ||
        code === "ECONNREFUSED" ||
        code === "EPIPE" ||
        code === "ETIMEDOUT"
    ) {
        return true;
    }

    return false;
}

/**
 * Simple retry wrapper with exponential backoff for transient errors
 * (deadlocks, connection timeouts, unexpected disconnects).
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    context: string,
    maxRetries: number = MAX_RETRIES,
    baseDelayMs: number = BASE_DELAY_MS
): Promise<T> {
    let attempt = 0;
    while (true) {
        try {
            return await operation();
        } catch (error: any) {
            if (isTransientError(error) && attempt < maxRetries) {
                attempt++;
                const baseDelay = Math.pow(2, attempt - 1) * baseDelayMs;
                const jitter = Math.random() * baseDelay;
                const delay = baseDelay + jitter;
                logger.warn(
                    `Transient DB error in ${context}, retrying attempt ${attempt}/${maxRetries} after ${delay.toFixed(0)}ms`,
                    { code: error?.code ?? error?.cause?.code }
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
}
