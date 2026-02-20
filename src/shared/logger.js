const { v4: uuidv4 } = require("uuid");

/**
 * Shared logger with structured JSON logs and correlation IDs.
 */

const getHeaderCaseInsensitive = (headers, key) => {
    if (!headers) return undefined;
    const foundKey = Object.keys(headers).find(
        (k) => k.toLowerCase() === key.toLowerCase()
    );
    return foundKey ? headers[foundKey] : undefined;
};

/**
 * Extracts or generates a correlationId for HTTP events.
 */
const getCorrelationIdFromHttpEvent = (event) => {
    const headers = event?.headers || {};
    const existing =
        getHeaderCaseInsensitive(headers, "x-correlation-id") ||
        getHeaderCaseInsensitive(headers, "x-request-id");

    return existing || uuidv4();
};

/**
 * Extracts correlationId from an EventBridge event detail, if present.
 */
const getCorrelationIdFromEventBridge = (record) => {
    if (!record) return uuidv4();

    const detail =
        typeof record.detail === "string"
            ? safeJsonParse(record.detail)
            : record.detail;

    return (detail && detail.correlationId) || uuidv4();
};

const safeJsonParse = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
};

const createLogger = (serviceName) => {
    const base = { service: serviceName };

    const log = (level, message, meta = {}) => {
        const { correlationId, error, ...rest } = meta;

        const payload = {
            level,
            message,
            correlationId: correlationId || null,
            service: serviceName,
            timestamp: new Date().toISOString(),
            ...rest,
        };

        if (error instanceof Error) {
            payload.error = {
                name: error.name,
                message: error.message,
                stack: error.stack,
            };
        } else if (error) {
            payload.error = error;
        }

        // Structured JSON log
        console.log(JSON.stringify(payload));
    };

    return {
        info: (message, meta) => log("INFO", message, meta),
        warn: (message, meta) => log("WARN", message, meta),
        error: (message, meta) => log("ERROR", message, meta),
    };
};

module.exports = {
    createLogger,
    getCorrelationIdFromHttpEvent,
    getCorrelationIdFromEventBridge,
};

