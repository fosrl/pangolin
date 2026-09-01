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

import * as orgIdp from "#private/routers/orgIdp";
import * as org from "#private/routers/org";
import * as logs from "#private/routers/auditLogs";
import * as alertEvents from "#private/routers/alertEvents";
import * as certificates from "@server/routers/certificates";
import * as siteProvisioning from "#private/routers/siteProvisioning";
import * as policy from "#private/routers/policy";
import * as eventStreamingDestination from "#private/routers/eventStreamingDestination";
import * as alertRule from "#private/routers/alertRule";
import * as healthChecks from "#private/routers/healthChecks";

import {
    verifyApiKeyHasAction,
    verifyApiKeyIsRoot,
    verifyApiKeyOrgAccess,
    verifyApiKeyIdpAccess,
    verifyApiKeyRoleAccess,
    verifyApiKeyUserAccess,
    verifyApiKeySiteProvisioningKeyAccess,
    verifyApiKeyResourcePolicyAccess,
    verifyLimits
} from "@server/middlewares";
import * as user from "#private/routers/user";
import {
    verifyValidSubscription,
    verifyValidLicense
} from "#private/middlewares";
import { ActionsEnum } from "@server/auth/actions";
import {
    unauthenticated as ua,
    authenticated as a
} from "@server/routers/integration";
import {
    queryAiSessionLogs,
    exportAiSessionLogs
} from "@server/routers/auditLogs";
import { logActionAudit } from "#private/middlewares";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { build } from "@server/build";

export const unauthenticated = ua;
export const authenticated = a;

if (build == "saas") {
    authenticated.post(
        "/org/:orgId/site/:siteId/trigger-alert",
        verifyApiKeyIsRoot,
        alertEvents.triggerSiteAlert
    );

    authenticated.post(
        "/org/:orgId/resource/:resourceId/trigger-alert",
        verifyApiKeyIsRoot,
        alertEvents.triggerResourceAlert
    );

    authenticated.post(
        "/org/:orgId/health-check/:healthCheckId/trigger-alert",
        verifyApiKeyIsRoot,
        alertEvents.triggerHealthCheckAlert
    );

    authenticated.post(
        "/cert/sync-to-newts",
        verifyApiKeyIsRoot,
        certificates.syncCertToNewts
    );

    authenticated.post(
        `/org/:orgId/send-usage-notification`,
        verifyApiKeyIsRoot, // We are the only ones who can use root key so its fine
        org.sendUsageNotification
    );

    authenticated.post(
        `/org/:orgId/send-trial-notification`,
        verifyApiKeyIsRoot,
        org.sendTrialNotification
    );
}

authenticated.delete(
    "/idp/:idpId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.deleteIdp),
    logActionAudit(ActionsEnum.deleteIdp),
    orgIdp.deleteOrgIdp
);

authenticated.get(
    "/org/:orgId/logs/action",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.actionLogs),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logs.queryActionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/action/export",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.logExport),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportActionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/access",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.accessLogs),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logs.queryAccessAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/access/export",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.logExport),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportAccessAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/connection",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.connectionLogs),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logs.queryConnectionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/connection/export",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.logExport),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportConnectionAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/ai",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.aiSessionLogs),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    queryAiSessionLogs
);

authenticated.get(
    "/org/:orgId/logs/ai/export",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.aiSessionLogs),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    exportAiSessionLogs
);

authenticated.put(
    "/org/:orgId/idp/oidc",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.orgOidc),
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createIdp),
    logActionAudit(ActionsEnum.createIdp),
    orgIdp.createOrgOidcIdp
);

authenticated.post(
    "/org/:orgId/idp/:idpId/oidc",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.orgOidc),
    verifyApiKeyOrgAccess,
    verifyApiKeyIdpAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateIdp),
    logActionAudit(ActionsEnum.updateIdp),
    orgIdp.updateOrgOidcIdp
);

authenticated.delete(
    "/org/:orgId/idp/:idpId",
    verifyValidLicense,
    verifyApiKeyOrgAccess,
    verifyApiKeyIdpAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteIdp),
    logActionAudit(ActionsEnum.deleteIdp),
    orgIdp.deleteOrgIdp
);

authenticated.get(
    "/org/:orgId/idp/:idpId",
    verifyValidLicense,
    verifyApiKeyOrgAccess,
    verifyApiKeyIdpAccess,
    verifyApiKeyHasAction(ActionsEnum.getIdp),
    orgIdp.getOrgIdp
);

authenticated.get(
    "/org/:orgId/idp",
    verifyValidLicense,
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listIdps),
    orgIdp.listOrgIdps
);

authenticated.post(
    "/user/:userId/add-role/:roleId",
    verifyApiKeyRoleAccess,
    verifyApiKeyUserAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.addUserRole),
    logActionAudit(ActionsEnum.addUserRole),
    user.addUserRole
);

authenticated.delete(
    "/user/:userId/remove-role/:roleId",
    verifyApiKeyRoleAccess,
    verifyApiKeyUserAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.removeUserRole),
    logActionAudit(ActionsEnum.removeUserRole),
    user.removeUserRole
);

authenticated.put(
    "/org/:orgId/site-provisioning-key",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createSiteProvisioningKey),
    logActionAudit(ActionsEnum.createSiteProvisioningKey),
    siteProvisioning.createSiteProvisioningKey
);

authenticated.get(
    "/org/:orgId/site-provisioning-keys",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listSiteProvisioningKeys),
    siteProvisioning.listSiteProvisioningKeys
);

authenticated.delete(
    "/org/:orgId/site-provisioning-key/:siteProvisioningKeyId",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyApiKeyOrgAccess,
    verifyApiKeySiteProvisioningKeyAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteSiteProvisioningKey),
    logActionAudit(ActionsEnum.deleteSiteProvisioningKey),
    siteProvisioning.deleteSiteProvisioningKey
);

authenticated.patch(
    "/org/:orgId/site-provisioning-key/:siteProvisioningKeyId",
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.siteProvisioningKeys),
    verifyApiKeyOrgAccess,
    verifyApiKeySiteProvisioningKeyAccess,
    verifyApiKeyHasAction(ActionsEnum.updateSiteProvisioningKey),
    logActionAudit(ActionsEnum.updateSiteProvisioningKey),
    siteProvisioning.updateSiteProvisioningKey
);

authenticated.get(
    ["/org/:orgId/resource-policies", "/org/:orgId/public-resource-policies"],
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.resourcePolicies),
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.listResourcePolicies),
    logActionAudit(ActionsEnum.listResourcePolicies),
    policy.listResourcePolicies
);

authenticated.post(
    ["/org/:orgId/resource-policy", "/org/:orgId/public-resource-policy"],
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.resourcePolicies),
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createResourcePolicy),
    logActionAudit(ActionsEnum.createResourcePolicy),
    policy.createResourcePolicy
);

authenticated.delete(
    [
        "/resource-policy/:resourcePolicyId",
        "/public-resource-policy/:resourcePolicyId"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyValidLicense,
    verifyValidSubscription(tierMatrix.resourcePolicies),
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.deleteResourcePolicy),
    logActionAudit(ActionsEnum.deleteResourcePolicy),
    policy.deleteResourcePolicy
);

authenticated.put(
    "/org/:orgId/event-streaming-destination",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createEventStreamingDestination),
    logActionAudit(ActionsEnum.createEventStreamingDestination),
    eventStreamingDestination.createEventStreamingDestination
);

authenticated.post(
    "/org/:orgId/event-streaming-destination/:destinationId",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateEventStreamingDestination),
    logActionAudit(ActionsEnum.updateEventStreamingDestination),
    eventStreamingDestination.updateEventStreamingDestination
);

authenticated.delete(
    "/org/:orgId/event-streaming-destination/:destinationId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteEventStreamingDestination),
    logActionAudit(ActionsEnum.deleteEventStreamingDestination),
    eventStreamingDestination.deleteEventStreamingDestination
);

authenticated.get(
    "/org/:orgId/event-streaming-destinations",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listEventStreamingDestinations),
    eventStreamingDestination.listEventStreamingDestinations
);

authenticated.put(
    "/org/:orgId/alert-rule",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createAlertRule),
    logActionAudit(ActionsEnum.createAlertRule),
    alertRule.createAlertRule
);

authenticated.post(
    "/org/:orgId/alert-rule/:alertRuleId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.updateAlertRule),
    logActionAudit(ActionsEnum.updateAlertRule),
    alertRule.updateAlertRule
);

authenticated.delete(
    "/org/:orgId/alert-rule/:alertRuleId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteAlertRule),
    logActionAudit(ActionsEnum.deleteAlertRule),
    alertRule.deleteAlertRule
);

authenticated.get(
    "/org/:orgId/alert-rules",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listAlertRules),
    alertRule.listAlertRules
);

authenticated.get(
    "/org/:orgId/alert-rule/:alertRuleId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getAlertRule),
    alertRule.getAlertRule
);

authenticated.get(
    "/org/:orgId/health-checks",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listHealthChecks),
    healthChecks.listHealthChecks
);

authenticated.put(
    "/org/:orgId/health-check",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createHealthCheck),
    logActionAudit(ActionsEnum.createHealthCheck),
    healthChecks.createHealthCheck
);

authenticated.post(
    "/org/:orgId/health-check/:healthCheckId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.updateHealthCheck),
    logActionAudit(ActionsEnum.updateHealthCheck),
    healthChecks.updateHealthCheck
);

authenticated.delete(
    "/org/:orgId/health-check/:healthCheckId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteHealthCheck),
    logActionAudit(ActionsEnum.deleteHealthCheck),
    healthChecks.deleteHealthCheck
);

authenticated.get(
    "/org/:orgId/health-check/:healthCheckId/status-history",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getTarget),
    healthChecks.getHealthCheckStatusHistory
);
