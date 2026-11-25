import { Request, Response, NextFunction } from "express";
import { initRequestAuthState } from "@server/lib/requestAuthState";

// Runs first on every server so the per-request auth cache fields are own
// properties and can never be read from a polluted Object.prototype.
export function initRequestAuthStateMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction
) {
    initRequestAuthState(req);
    next();
}
