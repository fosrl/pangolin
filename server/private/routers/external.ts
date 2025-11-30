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

import * as certificates from "#private/routers/certificates";
import { createStore } from "#private/lib/rateLimitStore";
import * as billing from "#private/routers/billing";
import * as remoteExitNode from "#private/routers/remoteExitNode";
import * as loginPage from "#private/routers/loginPage";
import * as orgIdp from "#private/routers/orgIdp";
import * as domain from "#private/routers/domain";
import * as auth from "#private/routers/auth";
import * as license from "#private/routers/license";
import * as generateLicense from "./generatedLicense";
import * as logs from "#private/routers/auditLogs";
import * as misc from "#private/routers/misc";

import {
    verifyOrgAccess,
    verifyUserHasAction,
    verifyUserIsServerAdmin
} from "@server/middlewares";
import { ActionsEnum } from "@server/auth/actions";
import {
    logActionAudit,
    verifyCertificateAccess,
    verifyIdpAccess,
    verifyLoginPageAccess,
    verifyRemoteExitNodeAccess,
    verifyValidSubscription
} from "#private/middlewares";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { verifyValidLicense } from "../middlewares/verifyValidLicense";
import { build } from "@server/build";
import {
    unauthenticated as ua,
    authenticated as a,
    authRouter as aa
} from "@server/routers/external";

export const authenticated = a;
export const unauthenticated = ua;
export const authRouter = aa;

unauthenticated.post(
    "/remote-exit-node/quick-start",
    verifyValidLicense,
    rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 5,
        keyGenerator: (req) => `${req.path}:${ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only create 5 remote exit nodes every hour. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    remoteExitNode.quickStartRemoteExitNode
);

authenticated.put(
    "/org/:orgId/idp/oidc",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createIdp),
    logActionAudit(ActionsEnum.createIdp),
    orgIdp.createOrgOidcIdp
);

authenticated.post(
    "/org/:orgId/idp/:idpId/oidc",
    verifyValidLicense,
    verifyOrgAccess,
    verifyIdpAccess,
    verifyUserHasAction(ActionsEnum.updateIdp),
    logActionAudit(ActionsEnum.updateIdp),
    orgIdp.updateOrgOidcIdp
);

authenticated.delete(
    "/org/:orgId/idp/:idpId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyIdpAccess,
    verifyUserHasAction(ActionsEnum.deleteIdp),
    logActionAudit(ActionsEnum.deleteIdp),
    orgIdp.deleteOrgIdp
);

authenticated.get(
    "/org/:orgId/idp/:idpId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyIdpAccess,
    verifyUserHasAction(ActionsEnum.getIdp),
    orgIdp.getOrgIdp
);

authenticated.get(
    "/org/:orgId/idp",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listIdps),
    orgIdp.listOrgIdps
);

authenticated.get("/org/:orgId/idp", orgIdp.listOrgIdps); // anyone can see this; it's just a list of idp names and ids

authenticated.get(
    "/org/:orgId/certificate/:domainId/:domain",
    verifyValidLicense,
    verifyOrgAccess,
    verifyCertificateAccess,
    verifyUserHasAction(ActionsEnum.getCertificate),
    certificates.getCertificate
);

authenticated.post(
    "/org/:orgId/certificate/:certId/restart",
    verifyValidLicense,
    verifyOrgAccess,
    verifyCertificateAccess,
    verifyUserHasAction(ActionsEnum.restartCertificate),
    logActionAudit(ActionsEnum.restartCertificate),
    certificates.restartCertificate
);

if (build === "saas") {
    unauthenticated.post(
        "/quick-start",
        rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 100,
            keyGenerator: (req) => req.path,
            handler: (req, res, next) => {
                const message = `We're too busy right now. Please try again later.`;
                return next(
                    createHttpError(HttpCode.TOO_MANY_REQUESTS, message)
                );
            },
            store: createStore()
        }),
        auth.quickStart
    );

    authenticated.post(
        "/org/:orgId/billing/create-checkout-session",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        logActionAudit(ActionsEnum.billing),
        billing.createCheckoutSession
    );

    authenticated.post(
        "/org/:orgId/billing/create-portal-session",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        logActionAudit(ActionsEnum.billing),
        billing.createPortalSession
    );

    authenticated.get(
        "/org/:orgId/billing/subscription",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        billing.getOrgSubscription
    );

    authenticated.get(
        "/org/:orgId/billing/usage",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        billing.getOrgUsage
    );

    authenticated.get(
        "/org/:orgId/license",
        verifyOrgAccess,
        generateLicense.listSaasLicenseKeys
    );

    authenticated.put(
        "/org/:orgId/license",
        verifyOrgAccess,
        generateLicense.generateNewLicense
    );

    authenticated.post(
        "/send-support-request",
        rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 3,
            keyGenerator: (req) =>
                `sendSupportRequest:${req.user?.userId || ipKeyGenerator(req.ip || "")}`,
            handler: (req, res, next) => {
                const message = `You can only send 3 support requests every 15 minutes. Please try again later.`;
                return next(
                    createHttpError(HttpCode.TOO_MANY_REQUESTS, message)
                );
            },
            store: createStore()
        }),
        misc.sendSupportEmail
    );
}

authenticated.get(
    "/domain/namespaces",
    verifyValidLicense,
    domain.listDomainNamespaces
);

authenticated.get(
    "/domain/check-namespace-availability",
    verifyValidLicense,
    domain.checkDomainNamespaceAvailability
);

authenticated.put(
    "/org/:orgId/remote-exit-node",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createRemoteExitNode),
    logActionAudit(ActionsEnum.createRemoteExitNode),
    remoteExitNode.createRemoteExitNode
);

authenticated.get(
    "/org/:orgId/remote-exit-nodes",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listRemoteExitNode),
    remoteExitNode.listRemoteExitNodes
);

authenticated.get(
    "/org/:orgId/remote-exit-node/:remoteExitNodeId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyRemoteExitNodeAccess,
    verifyUserHasAction(ActionsEnum.getRemoteExitNode),
    remoteExitNode.getRemoteExitNode
);

authenticated.get(
    "/org/:orgId/pick-remote-exit-node-defaults",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createRemoteExitNode),
    remoteExitNode.pickRemoteExitNodeDefaults
);

authenticated.delete(
    "/org/:orgId/remote-exit-node/:remoteExitNodeId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyRemoteExitNodeAccess,
    verifyUserHasAction(ActionsEnum.deleteRemoteExitNode),
    logActionAudit(ActionsEnum.deleteRemoteExitNode),
    remoteExitNode.deleteRemoteExitNode
);

authenticated.put(
    "/org/:orgId/login-page",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createLoginPage),
    logActionAudit(ActionsEnum.createLoginPage),
    loginPage.createLoginPage
);

authenticated.post(
    "/org/:orgId/login-page/:loginPageId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyLoginPageAccess,
    verifyUserHasAction(ActionsEnum.updateLoginPage),
    logActionAudit(ActionsEnum.updateLoginPage),
    loginPage.updateLoginPage
);

authenticated.delete(
    "/org/:orgId/login-page/:loginPageId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyLoginPageAccess,
    verifyUserHasAction(ActionsEnum.deleteLoginPage),
    logActionAudit(ActionsEnum.deleteLoginPage),
    loginPage.deleteLoginPage
);

authenticated.get(
    "/org/:orgId/login-page",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getLoginPage),
    loginPage.getLoginPage
);

authRouter.post(
    "/remoteExitNode/get-token",
    verifyValidLicense,
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 900,
        keyGenerator: (req) =>
            `remoteExitNodeGetToken:${req.body.newtId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only request an remoteExitNodeToken token ${900} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    remoteExitNode.getRemoteExitNodeToken
);

authRouter.post(
    "/transfer-session-token",
    verifyValidLicense,
    rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 60,
        keyGenerator: (req) =>
            `transferSessionToken:${ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only transfer a session token ${5} times every ${1} minute. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.transferSession
);

authenticated.post(
    "/license/activate",
    verifyUserIsServerAdmin,
    license.activateLicense
);

authenticated.get(
    "/license/keys",
    verifyUserIsServerAdmin,
    license.listLicenseKeys
);

authenticated.delete(
    "/license/:licenseKey",
    verifyUserIsServerAdmin,
    license.deleteLicenseKey
);

authenticated.post(
    "/license/recheck",
    verifyUserIsServerAdmin,
    license.recheckStatus
);

authenticated.get(
    "/org/:orgId/logs/action",
    verifyValidLicense,
    verifyValidSubscription,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logs.queryActionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/action/export",
    verifyValidLicense,
    verifyValidSubscription,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportActionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/access",
    verifyValidLicense,
    verifyValidSubscription,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logs.queryAccessAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/access/export",
    verifyValidLicense,
    verifyValidSubscription,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportAccessAuditLogs
);
