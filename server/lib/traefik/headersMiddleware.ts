import logger from "@server/logger";

function parseHeaders(
    headers: string,
    label: string,
    resourceId: number
): { name: string; value: string }[] {
    try {
        return JSON.parse(headers) as {
            name: string;
            value: string;
        }[];
    } catch (e) {
        logger.warn(
            `Failed to parse ${label} for resource ${resourceId}: ${e}`
        );
        return [];
    }
}

/**
 * Build the custom headers middleware definition for a resource's
 * custom request/response headers + setHostHeader config. Returns null when
 * there are no headers to set, so the caller can skip attaching the
 * middleware.
 */
export function buildCustomHeadersMiddleware(
    requestHeaders: string | null | undefined,
    responseHeaders: string | null | undefined,
    setHostHeader: string | null | undefined,
    resourceId: number
): {
    headers: {
        customRequestHeaders?: { [key: string]: string };
        customResponseHeaders?: { [key: string]: string };
    };
} | null {
    const requestHeadersObj: { [key: string]: string } = {};
    const responseHeadersObj: { [key: string]: string } = {};

    if (requestHeaders) {
        parseHeaders(requestHeaders, "requestHeaders", resourceId).forEach(
            (header) => {
                requestHeadersObj[header.name] = header.value;
            }
        );
    }

    if (setHostHeader) {
        requestHeadersObj["Host"] = setHostHeader;
    }

    if (responseHeaders) {
        parseHeaders(responseHeaders, "responseHeaders", resourceId).forEach(
            (header) => {
                responseHeadersObj[header.name] = header.value;
            }
        );
    }

    const hasRequestHeaders = Object.keys(requestHeadersObj).length > 0;
    const hasResponseHeaders = Object.keys(responseHeadersObj).length > 0;

    if (!hasRequestHeaders && !hasResponseHeaders) {
        return null;
    }

    return {
        headers: {
            ...(hasRequestHeaders && {
                customRequestHeaders: requestHeadersObj
            }),
            ...(hasResponseHeaders && {
                customResponseHeaders: responseHeadersObj
            })
        }
    };
}
