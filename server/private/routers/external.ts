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
import * as reKey from "#private/routers/re-key";
import * as approval from "#private/routers/approvals";
import * as ssh from "#private/routers/ssh";
import * as user from "#private/routers/user";
import * as siteProvisioning from "#private/routers/siteProvisioning";
import * as eventStreamingDestination from "#private/routers/eventStreamingDestination";
import * as alertRule from "#private/routers/alertRule";
import * as healthChecks from "#private/routers/healthChecks";
import * as labels from "#private/routers/labels";
import * as client from "@server/routers/client";
import * as resource from "#private/routers/resource";
import * as policy from "#private/routers/policy";

import {
    verifyOrgAccess,
    verifyUserHasAction,
    verifyUserIsServerAdmin,
    verifySiteAccess,
    verifyClientAccess,
    verifyLimits,
    verifyRoleAccess,
    verifyUserAccess,
    verifyUserCanSetUserOrgRoles,
    verifySiteProvisioningKeyAccess,
    verifyIsLoggedInUser,
    verifyAdmin,
    verifyResourcePolicyAccess
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
import { tierMatrix } from "@server/lib/billing/tierMatrix";

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
    verifyValidSubscription(tierMatrix.orgOidc),
    orgIdp.requireOrgIdentityProviderMode,
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.createIdp),
    logActionAudit(ActionsEnum.createIdp),
    orgIdp.createOrgOidcIdp
);

authenticated.post(
    "/org/:orgId/idp/:idpId/import",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.orgOidc),
    orgIdp.requireOrgIdentityProviderMode,
    verifyOrgAccess,
    verifyLimits,
    verifyAdmin,
    logActionAudit(ActionsEnum.createIdp),
    orgIdp.importOrgIdp
);

authenticated.post(
    "/org/:orgId/idp/:idpId/oidc",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.orgOidc),
    orgIdp.requireOrgIdentityProviderMode,
    verifyOrgAccess,
    verifyIdpAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.updateIdp),
    logActionAudit(ActionsEnum.updateIdp),
    orgIdp.updateOrgOidcIdp
);

authenticated.delete(
    "/org/:orgId/idp/:idpId",
    verifyValidLicense,
    orgIdp.requireOrgIdentityProviderMode,
    verifyOrgAccess,
    verifyIdpAccess,
    verifyUserHasAction(ActionsEnum.deleteIdp),
    logActionAudit(ActionsEnum.deleteIdp),
    orgIdp.deleteOrgIdp
);

authenticated.delete(
    "/org/:orgId/idp/:idpId/association",
    verifyValidLicense,
    orgIdp.requireOrgIdentityProviderMode,
    verifyOrgAccess,
    verifyIdpAccess,
    verifyUserHasAction(ActionsEnum.deleteIdp),
    logActionAudit(ActionsEnum.deleteIdp),
    orgIdp.unassociateOrgIdp
);

authenticated.get(
    "/org/:orgId/idp/:idpId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyIdpAccess,
    verifyUserHasAction(ActionsEnum.getIdp),
    orgIdp.getOrgIdp
);

authenticated.get("/org/:orgId/idp", orgIdp.listOrgIdps); // anyone can see this; it's just a list of idp names and ids

authenticated.get(
    "/user/:userId/admin-org-idps",
    verifyIsLoggedInUser,
    orgIdp.listUserAdminOrgIdps
);

authenticated.get(
    "/org/:orgId/certificate/:domainId/:domain",
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
    verifyLimits,
    verifyUserHasAction(ActionsEnum.restartCertificate),
    logActionAudit(ActionsEnum.restartCertificate),
    certificates.restartCertificate
);

if (build === "saas") {
    authenticated.post(
        "/org/:orgId/billing/create-checkout-session",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        logActionAudit(ActionsEnum.billing),
        billing.createCheckoutSession
    );

    authenticated.post(
        "/org/:orgId/billing/change-tier",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        logActionAudit(ActionsEnum.billing),
        billing.changeTier
    );

    authenticated.post(
        "/org/:orgId/billing/create-portal-session",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        logActionAudit(ActionsEnum.billing),
        billing.createPortalSession
    );

    authenticated.get(
        "/org/:orgId/billing/subscriptions",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        billing.getOrgSubscriptions
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

    authenticated.put(
        "/org/:orgId/license/enterprise",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        logActionAudit(ActionsEnum.billing),
        generateLicense.generateNewEnterpriseLicense
    );

    authenticated.post(
        "/org/:orgId/license/:licenseKey/clear-instance-name",
        verifyOrgAccess,
        verifyUserHasAction(ActionsEnum.billing),
        generateLicense.clearInstanceName
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
    verifyLimits,
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

authenticated.get(
    "/org/:orgId/remote-exit-node/:remoteExitNodeId/resources",
    verifyValidLicense,
    verifyOrgAccess,
    verifyRemoteExitNodeAccess,
    verifyUserHasAction(ActionsEnum.getRemoteExitNode),
    remoteExitNode.listRemoteExitNodeResources
);

authenticated.post(
    "/org/:orgId/remote-exit-node/:remoteExitNodeId/resources",
    verifyValidLicense,
    verifyOrgAccess,
    verifyRemoteExitNodeAccess,
    verifyUserHasAction(ActionsEnum.updateRemoteExitNode),
    logActionAudit(ActionsEnum.updateRemoteExitNode),
    remoteExitNode.setRemoteExitNodeResources
);

authenticated.get(
    "/org/:orgId/remote-exit-node/:remoteExitNodeId/preference-labels",
    verifyValidLicense,
    verifyOrgAccess,
    verifyRemoteExitNodeAccess,
    verifyUserHasAction(ActionsEnum.getRemoteExitNode),
    remoteExitNode.listRemoteExitNodePreferenceLabels
);

authenticated.post(
    "/org/:orgId/remote-exit-node/:remoteExitNodeId/preference-labels",
    verifyValidLicense,
    verifyOrgAccess,
    verifyRemoteExitNodeAccess,
    verifyUserHasAction(ActionsEnum.updateRemoteExitNode),
    logActionAudit(ActionsEnum.updateRemoteExitNode),
    remoteExitNode.setRemoteExitNodePreferenceLabels
);

authenticated.put(
    "/org/:orgId/login-page",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.loginPageDomain),
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.createLoginPage),
    logActionAudit(ActionsEnum.createLoginPage),
    loginPage.createLoginPage
);

authenticated.post(
    "/org/:orgId/login-page/:loginPageId",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.loginPageDomain),
    verifyOrgAccess,
    verifyLoginPageAccess,
    verifyLimits,
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

authenticated.get(
    "/org/:orgId/approvals",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.deviceApprovals),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listApprovals),
    logActionAudit(ActionsEnum.listApprovals),
    approval.listApprovals
);

authenticated.get(
    "/org/:orgId/approvals/count",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listApprovals),
    approval.countApprovals
);

authenticated.delete(
    "/resource-policy/:resourcePolicyId",
    verifyResourcePolicyAccess,
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.resourcePolicies),
    verifyLimits,
    verifyUserHasAction(ActionsEnum.deleteResourcePolicy),
    logActionAudit(ActionsEnum.deleteResourcePolicy),
    policy.deleteResourcePolicy
);

authenticated.get(
    "/org/:orgId/resource-policies",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.resourcePolicies),
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.listResourcePolicies),
    logActionAudit(ActionsEnum.listResourcePolicies),
    policy.listResourcePolicies
);

authenticated.post(
    "/org/:orgId/resource-policy",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.resourcePolicies),
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.createResourcePolicy),
    logActionAudit(ActionsEnum.createResourcePolicy),
    policy.createResourcePolicy
);

authenticated.put(
    "/org/:orgId/approvals/:approvalId",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.deviceApprovals),
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.updateApprovals),
    logActionAudit(ActionsEnum.updateApprovals),
    approval.processPendingApproval
);

authenticated.get(
    "/org/:orgId/login-page-branding",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.loginPageBranding),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getLoginPage),
    logActionAudit(ActionsEnum.getLoginPage),
    loginPage.getLoginPageBranding
);

authenticated.put(
    "/org/:orgId/login-page-branding",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.loginPageBranding),
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.updateLoginPage),
    logActionAudit(ActionsEnum.updateLoginPage),
    loginPage.upsertLoginPageBranding
);

authenticated.delete(
    "/org/:orgId/login-page-branding",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.deleteLoginPage),
    logActionAudit(ActionsEnum.deleteLoginPage),
    loginPage.deleteLoginPageBranding
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

if (build !== "saas") {
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
}

authenticated.get(
    "/org/:orgId/logs/action",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.actionLogs),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logs.queryActionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/action/export",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.logExport),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportActionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/access",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.accessLogs),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logs.queryAccessAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/access/export",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.logExport),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportAccessAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/connection",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.connectionLogs),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logs.queryConnectionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/connection/export",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.logExport),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportConnectionAuditLogs
);

authenticated.post(
    "/re-key/:clientId/regenerate-client-secret",
    verifyClientAccess, // this is first to set the org id
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.rotateCredentials),
    verifyLimits,
    verifyUserHasAction(ActionsEnum.reGenerateSecret),
    reKey.reGenerateClientSecret
);

authenticated.post(
    "/re-key/:siteId/regenerate-site-secret",
    verifySiteAccess, // this is first to set the org id
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.rotateCredentials),
    verifyLimits,
    verifyUserHasAction(ActionsEnum.reGenerateSecret),
    reKey.reGenerateSiteSecret
);

authenticated.put(
    "/re-key/:orgId/regenerate-remote-exit-node-secret",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.rotateCredentials),
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.reGenerateSecret),
    reKey.reGenerateExitNodeSecret
);

authenticated.post(
    "/org/:orgId/ssh/sign-key",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.advancedPrivateResources),
    verifyOrgAccess,
    verifyLimits,
    // verifyUserHasAction(ActionsEnum.signSshKey), // this check happens inside of the function now
    // logActionAudit(ActionsEnum.signSshKey), // it is handled inside of the function below so we can include more metadata
    ssh.signSshKey
);

authenticated.post(
    "/user/:userId/add-role/:roleId",
    verifyRoleAccess,
    verifyUserAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.addUserRole),
    logActionAudit(ActionsEnum.addUserRole),
    user.addUserRole
);

authenticated.delete(
    "/user/:userId/remove-role/:roleId",
    verifyRoleAccess,
    verifyUserAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.removeUserRole),
    logActionAudit(ActionsEnum.removeUserRole),
    user.removeUserRole
);

authenticated.post(
    "/user/:userId/org/:orgId/roles",
    verifyOrgAccess,
    verifyUserAccess,
    verifyLimits,
    verifyUserCanSetUserOrgRoles(),
    logActionAudit(ActionsEnum.setUserOrgRoles),
    user.setUserOrgRoles
);

authenticated.put(
    "/org/:orgId/site-provisioning-key",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.createSiteProvisioningKey),
    logActionAudit(ActionsEnum.createSiteProvisioningKey),
    siteProvisioning.createSiteProvisioningKey
);

authenticated.get(
    "/org/:orgId/site-provisioning-keys",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listSiteProvisioningKeys),
    siteProvisioning.listSiteProvisioningKeys
);

authenticated.delete(
    "/org/:orgId/site-provisioning-key/:siteProvisioningKeyId",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyOrgAccess,
    verifySiteProvisioningKeyAccess,
    verifyUserHasAction(ActionsEnum.deleteSiteProvisioningKey),
    logActionAudit(ActionsEnum.deleteSiteProvisioningKey),
    siteProvisioning.deleteSiteProvisioningKey
);

authenticated.patch(
    "/org/:orgId/site-provisioning-key/:siteProvisioningKeyId",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyOrgAccess,
    verifySiteProvisioningKeyAccess,
    verifyUserHasAction(ActionsEnum.updateSiteProvisioningKey),
    logActionAudit(ActionsEnum.updateSiteProvisioningKey),
    siteProvisioning.updateSiteProvisioningKey
);

authenticated.put(
    "/org/:orgId/event-streaming-destination",
    verifyValidLicense,
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.createEventStreamingDestination),
    logActionAudit(ActionsEnum.createEventStreamingDestination),
    eventStreamingDestination.createEventStreamingDestination
);

authenticated.post(
    "/org/:orgId/event-streaming-destination/:destinationId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.updateEventStreamingDestination),
    logActionAudit(ActionsEnum.updateEventStreamingDestination),
    eventStreamingDestination.updateEventStreamingDestination
);

authenticated.delete(
    "/org/:orgId/event-streaming-destination/:destinationId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.deleteEventStreamingDestination),
    logActionAudit(ActionsEnum.deleteEventStreamingDestination),
    eventStreamingDestination.deleteEventStreamingDestination
);

authenticated.get(
    "/org/:orgId/event-streaming-destinations",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listEventStreamingDestinations),
    eventStreamingDestination.listEventStreamingDestinations
);

authenticated.put(
    "/org/:orgId/alert-rule",
    verifyValidLicense,
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.createAlertRule),
    logActionAudit(ActionsEnum.createAlertRule),
    alertRule.createAlertRule
);

authenticated.post(
    "/org/:orgId/alert-rule/:alertRuleId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.updateAlertRule),
    logActionAudit(ActionsEnum.updateAlertRule),
    alertRule.updateAlertRule
);

authenticated.delete(
    "/org/:orgId/alert-rule/:alertRuleId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.deleteAlertRule),
    logActionAudit(ActionsEnum.deleteAlertRule),
    alertRule.deleteAlertRule
);

authenticated.get(
    "/org/:orgId/alert-rules",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listAlertRules),
    alertRule.listAlertRules
);

authenticated.get(
    "/org/:orgId/alert-rule/:alertRuleId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getAlertRule),
    alertRule.getAlertRule
);

authenticated.get(
    "/org/:orgId/labels",
    verifyValidLicense,
    verifyOrgAccess,
    verifyValidSubscription(tierMatrix.labels),
    verifyUserHasAction(ActionsEnum.listOrgLabels),
    labels.listOrgLabels
);

authenticated.post(
    "/org/:orgId/labels",
    verifyValidLicense,
    verifyOrgAccess,
    verifyValidSubscription(tierMatrix.labels),
    verifyUserHasAction(ActionsEnum.createOrgLabel),
    labels.createOrgLabel
);

authenticated.patch(
    "/org/:orgId/label/:labelId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyValidSubscription(tierMatrix.labels),
    verifyUserHasAction(ActionsEnum.updateOrgLabel),
    labels.updateOrgLabel
);

authenticated.delete(
    "/org/:orgId/label/:labelId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.deleteOrgLabel),
    labels.deleteOrgLabel
);

authenticated.put(
    "/org/:orgId/label/:labelId/attach",
    verifyValidLicense,
    verifyOrgAccess,
    verifyValidSubscription(tierMatrix.labels),
    verifyUserHasAction(ActionsEnum.attachLabelToItem),
    labels.attachLabelToItem
);

authenticated.put(
    "/org/:orgId/label/:labelId/detach",
    verifyValidLicense,
    verifyOrgAccess,
    verifyValidSubscription(tierMatrix.labels),
    verifyUserHasAction(ActionsEnum.detachLabelFromItem),
    labels.detachLabelFromItem
);

authenticated.get(
    "/org/:orgId/health-checks",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listHealthChecks),
    healthChecks.listHealthChecks
);

authenticated.put(
    "/org/:orgId/health-check",
    verifyValidLicense,
    verifyOrgAccess,
    verifyLimits,
    verifyUserHasAction(ActionsEnum.createHealthCheck),
    logActionAudit(ActionsEnum.createHealthCheck),
    healthChecks.createHealthCheck
);

authenticated.post(
    "/org/:orgId/health-check/:healthCheckId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.updateHealthCheck),
    logActionAudit(ActionsEnum.updateHealthCheck),
    healthChecks.updateHealthCheck
);

authenticated.delete(
    "/org/:orgId/health-check/:healthCheckId",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.deleteHealthCheck),
    logActionAudit(ActionsEnum.deleteHealthCheck),
    healthChecks.deleteHealthCheck
);

authenticated.get(
    "/org/:orgId/health-check/:healthCheckId/status-history",
    verifyValidLicense,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getTarget),
    healthChecks.getHealthCheckStatusHistory
);

authenticated.get(
    "/client/:clientId/verify-associations-cache",
    verifyClientAccess,
    client.verifyClientAssociationsCache
);

authenticated.post(
    "/client/:clientId/rebuild-associations-cache",
    verifyClientAccess,
    client.rebuildClientAssociationsCacheRoute
);

authenticated.post(
    "/org/:orgId/logs/access/attempt",
    verifyOrgAccess,
    logs.logAccessAuditAttempt
);
