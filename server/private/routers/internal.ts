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

import * as loginPage from "#private/routers/loginPage";
import * as auth from "#private/routers/auth";
import * as orgIdp from "#private/routers/orgIdp";
import * as billing from "#private/routers/billing";
import * as license from "#private/routers/license";

import { verifySessionUserMiddleware } from "@server/middlewares";

import { internalRouter as ir } from "@server/routers/internal";

export const internalRouter = ir;

internalRouter.get("/org/:orgId/idp", orgIdp.listOrgIdps);

internalRouter.get("/org/:orgId/billing/tier", billing.getOrgTier);

internalRouter.get("/login-page", loginPage.loadLoginPage);
internalRouter.get("/login-page-branding", loginPage.loadLoginPageBranding);

internalRouter.post(
    "/get-session-transfer-token",
    verifySessionUserMiddleware,
    auth.getSessionTransferToken
);

internalRouter.get(`/license/status`, license.getLicenseStatus);
