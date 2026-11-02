/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import privateConfig from "#private/lib/config";
import HttpCode from "@server/types/HttpCode";

export function requireOrgIdentityProviderMode(
    _req: Request,
    _res: Response,
    next: NextFunction
): void {
    if (
        privateConfig.getRawPrivateConfig().app.identity_provider_mode !== "org"
    ) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Organization-specific IdP creation is not allowed in the current identity provider mode. Set app.identity_provider_mode to 'org' in the private configuration to enable this feature."
            )
        );
    }

    return next();
}
