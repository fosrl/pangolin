import { NextFunction, Request, Response } from "express";

const csrfExemptPaths = new Set([
    "/api/v1/oauth/token",
    "/api/v1/oauth/revoke",
    "/api/v1/oauth/userinfo"
]);

export function csrfProtectionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const csrfToken = req.headers["x-csrf-token"];

    // Skip CSRF check for GET requests as they should be idempotent
    if (req.method === "GET") {
        next();
        return;
    }

    if (csrfExemptPaths.has(req.path)) {
        next();
        return;
    }

    if (!csrfToken || csrfToken !== "x-csrf-protection") {
        res.status(403).json({
            error: "CSRF token missing or invalid"
        });
        return;
    }

    next();
}
