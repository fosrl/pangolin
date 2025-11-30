/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import * as orgIdp from "#private/routers/orgIdp";
import * as org from "#private/routers/org";

import { Router } from "express";
import {
    verifyApiKey,
    verifyApiKeyHasAction,
    verifyApiKeyIsRoot,
} from "@server/middlewares";
import { ActionsEnum } from "@server/auth/actions";

import { unauthenticated as ua, authenticated as a } from "@server/routers/integration";
import { logActionAudit } from "#private/middlewares";

export const unauthenticated = ua;
export const authenticated = a;

authenticated.post(
    `/org/:orgId/send-usage-notification`,
    verifyApiKeyIsRoot, // We are the only ones who can use root key so its fine
    verifyApiKeyHasAction(ActionsEnum.sendUsageNotification),
    logActionAudit(ActionsEnum.sendUsageNotification),
    org.sendUsageNotification,
);

authenticated.delete(
    "/idp/:idpId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.deleteIdp),
    logActionAudit(ActionsEnum.deleteIdp),
    orgIdp.deleteOrgIdp,
);