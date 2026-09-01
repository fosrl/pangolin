import * as site from "./site";
import * as org from "./org";
import * as blueprints from "./blueprints";
import * as resource from "./resource";
import * as policy from "./policy";
import * as domain from "./domain";
import * as target from "./target";
import * as user from "./user";
import * as role from "./role";
import * as client from "./client";
import * as accessToken from "./accessToken";
import * as apiKeys from "./apiKeys";
import * as idp from "./idp";
import * as logs from "./auditLogs";
import * as siteResource from "./siteResource";
import * as aiProvider from "./aiProvider";
import * as aiBudget from "./aiBudget";
import * as virtualApiKey from "./virtualApiKey";
import {
    verifyApiKey,
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction,
    verifyApiKeySiteAccess,
    verifyApiKeyResourceAccess,
    verifyApiKeyTargetAccess,
    verifyApiKeyRoleAccess,
    verifyApiKeyUserAccess,
    verifyApiKeySetResourceUsers,
    verifyApiKeyAccessTokenAccess,
    verifyApiKeyIsRoot,
    verifyApiKeyClientAccess,
    verifyApiKeySiteResourceAccess,
    verifyApiKeySetResourceClients,
    verifyLimits,
    verifyApiKeyDomainAccess,
    verifyApiKeyResourcePolicyAccess,
    verifyApiKeyAiProviderAccess,
    verifyApiKeyAiModelAccess,
    verifyApiKeyAiBudgetAccess,
    verifyApiKeyVirtualApiKeyAccess,
    verifyUserHasAction
} from "@server/middlewares";
import HttpCode from "@server/types/HttpCode";
import { Router } from "express";
import { ActionsEnum } from "@server/auth/actions";
import { logActionAudit } from "#dynamic/middlewares";

export const unauthenticated = Router();

unauthenticated.get("/", (_, res) => {
    res.status(HttpCode.OK).json({ message: "Healthy" });
});

export const authenticated = Router();
authenticated.use(verifyApiKey);

authenticated.get(
    "/org/checkId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.checkOrgId),
    org.checkId
);

authenticated.put(
    "/org",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.createOrg),
    logActionAudit(ActionsEnum.createOrg),
    org.createOrg
);

authenticated.get(
    "/orgs",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.listOrgs),
    org.listOrgs
); // TODO we need to check the orgs here

authenticated.get(
    "/org/:orgId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getOrg),
    org.getOrg
);

authenticated.post(
    "/org/:orgId",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateOrg),
    logActionAudit(ActionsEnum.updateOrg),
    org.updateOrg
);

authenticated.delete(
    "/org/:orgId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.deleteOrg),
    logActionAudit(ActionsEnum.deleteOrg),
    org.deleteOrg
);

authenticated.put(
    "/org/:orgId/site",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createSite),
    logActionAudit(ActionsEnum.createSite),
    site.createSite
);

authenticated.get(
    "/org/:orgId/sites",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listSites),
    site.listSites
);

authenticated.get(
    "/org/:orgId/site/:niceId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getSite),
    site.getSite
);

authenticated.get(
    "/org/:orgId/pick-site-defaults",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.createSite),
    site.pickSiteDefaults
);

authenticated.get(
    "/site/:siteId",
    verifyApiKeySiteAccess,
    verifyApiKeyHasAction(ActionsEnum.getSite),
    site.getSite
);

authenticated.post(
    "/site/:siteId",
    verifyApiKeySiteAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateSite),
    logActionAudit(ActionsEnum.updateSite),
    site.updateSite
);

authenticated.post(
    "/org/:orgId/reset-bandwidth",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.resetSiteBandwidth),
    logActionAudit(ActionsEnum.resetSiteBandwidth),
    org.resetOrgBandwidth
);

authenticated.delete(
    "/site/:siteId",
    verifyApiKeySiteAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteSite),
    logActionAudit(ActionsEnum.deleteSite),
    site.deleteSite
);

authenticated.get(
    "/org/:orgId/user-resources",
    verifyApiKeyOrgAccess,
    resource.getUserResources
);

// Site Resource endpoints
authenticated.put(
    ["/org/:orgId/site-resource", "/org/:orgId/private-resource"],
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createSiteResource),
    logActionAudit(ActionsEnum.createSiteResource),
    siteResource.createSiteResource
);

authenticated.get(
    [
        "/org/:orgId/site/:siteId/resources",
        "/org/:orgId/site/:siteId/private-resources"
    ],
    verifyApiKeyOrgAccess,
    verifyApiKeySiteAccess,
    verifyApiKeyHasAction(ActionsEnum.listSiteResources),
    siteResource.listSiteResources
);

authenticated.get(
    ["/org/:orgId/site-resources", "/org/:orgId/private-resources"],
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listSiteResources),
    siteResource.listAllSiteResourcesByOrg
);

authenticated.get(
    ["/site-resource/:siteResourceId", "/private-resource/:siteResourceId"],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.getSiteResource),
    siteResource.getSiteResource
);

authenticated.post(
    ["/site-resource/:siteResourceId", "/private-resource/:siteResourceId"],
    verifyApiKeySiteResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateSiteResource),
    logActionAudit(ActionsEnum.updateSiteResource),
    siteResource.updateSiteResource
);

authenticated.delete(
    ["/site-resource/:siteResourceId", "/private-resource/:siteResourceId"],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteSiteResource),
    logActionAudit(ActionsEnum.deleteSiteResource),
    siteResource.deleteSiteResource
);

authenticated.get(
    [
        "/site-resource/:siteResourceId/roles",
        "/private-resource/:siteResourceId/roles"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceRoles),
    siteResource.listSiteResourceRoles
);

authenticated.get(
    [
        "/site-resource/:siteResourceId/users",
        "/private-resource/:siteResourceId/users"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceUsers),
    siteResource.listSiteResourceUsers
);

authenticated.get(
    [
        "/site-resource/:siteResourceId/clients",
        "/private-resource/:siteResourceId/clients"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceUsers),
    siteResource.listSiteResourceClients
);

authenticated.get(
    [
        "/site-resource/:siteResourceId/ai-models",
        "/private-resource/:siteResourceId/ai-models"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceAiModels),
    siteResource.listSiteResourceAiModels
);

authenticated.get(
    [
        "/site-resource/:siteResourceId/ai-providers",
        "/private-resource/:siteResourceId/ai-providers"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceAiModels),
    siteResource.listSiteResourceAiProviders
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/roles",
        "/private-resource/:siteResourceId/roles"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceRoles),
    logActionAudit(ActionsEnum.setResourceRoles),
    siteResource.setSiteResourceRoles
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/users",
        "/private-resource/:siteResourceId/users"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeySetResourceUsers,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    siteResource.setSiteResourceUsers
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/roles/add",
        "/private-resource/:siteResourceId/roles/add"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceRoles),
    logActionAudit(ActionsEnum.setResourceRoles),
    siteResource.addRoleToSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/roles/remove",
        "/private-resource/:siteResourceId/roles/remove"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceRoles),
    logActionAudit(ActionsEnum.setResourceRoles),
    siteResource.removeRoleFromSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/ai-models",
        "/private-resource/:siteResourceId/ai-models"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    siteResource.setSiteResourceAiModels
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/ai-models/add",
        "/private-resource/:siteResourceId/ai-models/add"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    siteResource.addAiModelToSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/ai-models/remove",
        "/private-resource/:siteResourceId/ai-models/remove"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    siteResource.removeAiModelFromSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/ai-providers",
        "/private-resource/:siteResourceId/ai-providers"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    siteResource.setSiteResourceAiProviders
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/ai-providers/add",
        "/private-resource/:siteResourceId/ai-providers/add"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    siteResource.addAiProviderToSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/ai-providers/remove",
        "/private-resource/:siteResourceId/ai-providers/remove"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    siteResource.removeAiProviderFromSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/users/add",
        "/private-resource/:siteResourceId/users/add"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeySetResourceUsers,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    siteResource.addUserToSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/users/remove",
        "/private-resource/:siteResourceId/users/remove"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeySetResourceUsers,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    siteResource.removeUserFromSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/clients",
        "/private-resource/:siteResourceId/clients"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeySetResourceClients,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    siteResource.setSiteResourceClients
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/clients/add",
        "/private-resource/:siteResourceId/clients/add"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeySetResourceClients,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    siteResource.addClientToSiteResource
);

authenticated.post(
    [
        "/site-resource/:siteResourceId/clients/remove",
        "/private-resource/:siteResourceId/clients/remove"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeySetResourceClients,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    siteResource.removeClientFromSiteResource
);

authenticated.post(
    ["/client/:clientId/site-resources", "/client/:clientId/private-resources"],
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    siteResource.batchAddClientToSiteResources
);

authenticated.put(
    ["/org/:orgId/resource", "/org/:orgId/public-resource"],
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createResource),
    logActionAudit(ActionsEnum.createResource),
    resource.createResource
);

authenticated.put(
    [
        "/org/:orgId/site/:siteId/resource",
        "/org/:orgId/site/:siteId/public-resource"
    ],
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createResource),
    logActionAudit(ActionsEnum.createResource),
    resource.createResource
);

authenticated.get(
    ["/site/:siteId/resources", "/site/:siteId/public-resources"],
    verifyApiKeySiteAccess,
    verifyApiKeyHasAction(ActionsEnum.listResources),
    resource.listResources
);

authenticated.get(
    ["/org/:orgId/resources", "/org/:orgId/public-resources"],
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listResources),
    resource.listResources
);

authenticated.get(
    "/org/:orgId/domains",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listOrgDomains),
    domain.listDomains
);

authenticated.get(
    "/org/:orgId/domain/:domainId",
    verifyApiKeyOrgAccess,
    verifyApiKeyDomainAccess,
    verifyApiKeyHasAction(ActionsEnum.getDomain),
    domain.getDomain
);

authenticated.put(
    "/org/:orgId/domain",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.createOrgDomain),
    logActionAudit(ActionsEnum.createOrgDomain),
    domain.createOrgDomain
);

authenticated.post(
    "/org/:orgId/domain/:domainId",
    verifyApiKeyOrgAccess,
    verifyApiKeyDomainAccess,
    verifyApiKeyHasAction(ActionsEnum.updateOrgDomain),
    domain.updateOrgDomain
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.patch(
    "/org/:orgId/domain/:domainId",
    verifyApiKeyOrgAccess,
    verifyApiKeyDomainAccess,
    verifyApiKeyHasAction(ActionsEnum.updateOrgDomain),
    domain.updateOrgDomain
);

authenticated.delete(
    "/org/:orgId/domain/:domainId",
    verifyApiKeyOrgAccess,
    verifyApiKeyDomainAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteOrgDomain),
    logActionAudit(ActionsEnum.deleteOrgDomain),
    domain.deleteAccountDomain
);

authenticated.get(
    "/org/:orgId/domain/:domainId/dns-records",
    verifyApiKeyOrgAccess,
    verifyApiKeyDomainAccess,
    verifyApiKeyHasAction(ActionsEnum.getDNSRecords),
    domain.getDNSRecords
);

authenticated.post(
    "/org/:orgId/domain/:domainId/restart",
    verifyApiKeyOrgAccess,
    verifyApiKeyDomainAccess,
    verifyApiKeyHasAction(ActionsEnum.restartOrgDomain),
    logActionAudit(ActionsEnum.restartOrgDomain),
    domain.restartOrgDomain
);

authenticated.get(
    "/org/:orgId/invitations",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listInvitations),
    user.listInvitations
);

authenticated.post(
    "/org/:orgId/create-invite",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.inviteUser),
    logActionAudit(ActionsEnum.inviteUser),
    user.inviteUser
);

authenticated.delete(
    "/org/:orgId/invitations/:inviteId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.removeInvitation),
    logActionAudit(ActionsEnum.removeInvitation),
    user.removeInvitation
);

authenticated.get(
    ["/resource/:resourceId/roles", "/public-resource/:resourceId/roles"],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceRoles),
    resource.listResourceRoles
);

authenticated.get(
    ["/resource/:resourceId/users", "/public-resource/:resourceId/users"],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceUsers),
    resource.listResourceUsers
);

authenticated.get(
    [
        "/resource/:resourceId/ai-models",
        "/public-resource/:resourceId/ai-models"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceAiModels),
    resource.listResourceAiModels
);

authenticated.get(
    [
        "/resource/:resourceId/ai-providers",
        "/public-resource/:resourceId/ai-providers"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceAiModels),
    resource.listResourceAiProviders
);

authenticated.get(
    ["/resource/:resourceId", "/public-resource/:resourceId"],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.getResource),
    resource.getResource
);

authenticated.get(
    [
        "/resource-policy/:resourcePolicyId",
        "/public-resource-policy/:resourcePolicyId"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyApiKeyHasAction(ActionsEnum.getResourcePolicy),
    policy.getResourcePolicy
);

authenticated.get(
    ["/resource/:resourceId/policies", "/public-resource/:resourceId/policies"],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.getResourcePolicy),
    resource.getResourcePolicies
);

authenticated.post(
    ["/resource/:resourceId", "/public-resource/:resourceId"],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateResource),
    logActionAudit(ActionsEnum.updateResource),
    resource.updateResource
);

authenticated.post(
    [
        "/resource-policy/:resourcePolicyId",
        "/public-resource-policy/:resourcePolicyId"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyApiKeyHasAction(ActionsEnum.updateResourcePolicy),
    policy.updateResourcePolicy
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.put(
    [
        "/resource-policy/:resourcePolicyId",
        "/public-resource-policy/:resourcePolicyId"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyApiKeyHasAction(ActionsEnum.updateResourcePolicy),
    policy.updateResourcePolicy
);

authenticated.delete(
    ["/resource/:resourceId", "/public-resource/:resourceId"],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteResource),
    logActionAudit(ActionsEnum.deleteResource),
    resource.deleteResource
);

authenticated.put(
    ["/resource/:resourceId/target", "/public-resource/:resourceId/target"],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createTarget),
    logActionAudit(ActionsEnum.createTarget),
    target.createTarget
);

authenticated.get(
    ["/resource/:resourceId/targets", "/public-resource/:resourceId/targets"],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listTargets),
    target.listTargets
);

authenticated.put(
    ["/resource/:resourceId/rule", "/public-resource/:resourceId/rule"],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createResourceRule),
    logActionAudit(ActionsEnum.createResourceRule),
    resource.createResourceRule
);

authenticated.get(
    ["/resource/:resourceId/rules", "/public-resource/:resourceId/rules"],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listResourceRules),
    resource.listResourceRules
);

authenticated.post(
    [
        "/resource/:resourceId/rule/:ruleId",
        "/public-resource/:resourceId/rule/:ruleId"
    ],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateResourceRule),
    logActionAudit(ActionsEnum.updateResourceRule),
    resource.updateResourceRule
);

authenticated.delete(
    [
        "/resource/:resourceId/rule/:ruleId",
        "/public-resource/:resourceId/rule/:ruleId"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteResourceRule),
    logActionAudit(ActionsEnum.deleteResourceRule),
    resource.deleteResourceRule
);

authenticated.get(
    "/target/:targetId",
    verifyApiKeyTargetAccess,
    verifyApiKeyHasAction(ActionsEnum.getTarget),
    target.getTarget
);

authenticated.post(
    "/target/:targetId",
    verifyApiKeyTargetAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateTarget),
    logActionAudit(ActionsEnum.updateTarget),
    target.updateTarget
);

authenticated.delete(
    "/target/:targetId",
    verifyApiKeyTargetAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteTarget),
    logActionAudit(ActionsEnum.deleteTarget),
    target.deleteTarget
);

authenticated.put(
    "/org/:orgId/role",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createRole),
    logActionAudit(ActionsEnum.createRole),
    role.createRole
);

authenticated.post(
    "/role/:roleId",
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateRole),
    logActionAudit(ActionsEnum.updateRole),
    role.updateRole
);

authenticated.get(
    "/org/:orgId/roles",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listRoles),
    role.listRoles
);

authenticated.delete(
    "/role/:roleId",
    verifyApiKeyRoleAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteRole),
    logActionAudit(ActionsEnum.deleteRole),
    role.deleteRole
);

authenticated.get(
    "/role/:roleId",
    verifyApiKeyRoleAccess,
    verifyApiKeyHasAction(ActionsEnum.getRole),
    role.getRole
);

authenticated.post(
    "/role/:roleId/add/:userId",
    verifyApiKeyRoleAccess,
    verifyApiKeyUserAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.addUserRole),
    logActionAudit(ActionsEnum.addUserRole),
    user.addUserRoleLegacy
);

authenticated.post(
    ["/resource/:resourceId/roles", "/public-resource/:resourceId/roles"],
    verifyApiKeyResourceAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceRoles),
    logActionAudit(ActionsEnum.setResourceRoles),
    resource.setResourceRoles
);

authenticated.post(
    [
        "/resource/:resourceId/ai-models",
        "/public-resource/:resourceId/ai-models"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    resource.setResourceAiModels
);

authenticated.post(
    [
        "/resource/:resourceId/ai-providers",
        "/public-resource/:resourceId/ai-providers"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    resource.setResourceAiProviders
);

authenticated.post(
    ["/resource/:resourceId/users", "/public-resource/:resourceId/users"],
    verifyApiKeyResourceAccess,
    verifyApiKeySetResourceUsers,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    resource.setResourceUsers
);

authenticated.post(
    [
        "/resource-policy/:resourcePolicyId/access-control",
        "/public-resource-policy/:resourcePolicyId/access-control"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyUsers),
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyRoles),
    logActionAudit(ActionsEnum.setResourcePolicyUsers),
    logActionAudit(ActionsEnum.setResourcePolicyRoles),
    policy.setResourcePolicyAccessControl
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.put(
    [
        "/resource-policy/:resourcePolicyId/access-control",
        "/public-resource-policy/:resourcePolicyId/access-control"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyUsers),
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyRoles),
    logActionAudit(ActionsEnum.setResourcePolicyUsers),
    logActionAudit(ActionsEnum.setResourcePolicyRoles),
    policy.setResourcePolicyAccessControl
);

authenticated.post(
    [
        "/resource-policy/:resourcePolicyId/password",
        "/public-resource-policy/:resourcePolicyId/password"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyPassword),
    logActionAudit(ActionsEnum.setResourcePolicyPassword),
    policy.setResourcePolicyPassword
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.put(
    [
        "/resource-policy/:resourcePolicyId/password",
        "/public-resource-policy/:resourcePolicyId/password"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyPassword),
    logActionAudit(ActionsEnum.setResourcePolicyPassword),
    policy.setResourcePolicyPassword
);

authenticated.post(
    [
        "/resource-policy/:resourcePolicyId/pincode",
        "/public-resource-policy/:resourcePolicyId/pincode"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyPincode),
    logActionAudit(ActionsEnum.setResourcePolicyPincode),
    policy.setResourcePolicyPincode
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.put(
    [
        "/resource-policy/:resourcePolicyId/pincode",
        "/public-resource-policy/:resourcePolicyId/pincode"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyPincode),
    logActionAudit(ActionsEnum.setResourcePolicyPincode),
    policy.setResourcePolicyPincode
);

authenticated.post(
    [
        "/resource-policy/:resourcePolicyId/header-auth",
        "/public-resource-policy/:resourcePolicyId/header-auth"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyHeaderAuth),
    logActionAudit(ActionsEnum.setResourcePolicyHeaderAuth),
    policy.setResourcePolicyHeaderAuth
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.put(
    [
        "/resource-policy/:resourcePolicyId/header-auth",
        "/public-resource-policy/:resourcePolicyId/header-auth"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyHeaderAuth),
    logActionAudit(ActionsEnum.setResourcePolicyHeaderAuth),
    policy.setResourcePolicyHeaderAuth
);

authenticated.post(
    [
        "/resource-policy/:resourcePolicyId/whitelist",
        "/public-resource-policy/:resourcePolicyId/whitelist"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyWhitelist),
    logActionAudit(ActionsEnum.setResourcePolicyWhitelist),
    policy.setResourcePolicyWhitelist
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.put(
    [
        "/resource-policy/:resourcePolicyId/whitelist",
        "/public-resource-policy/:resourcePolicyId/whitelist"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyWhitelist),
    logActionAudit(ActionsEnum.setResourcePolicyWhitelist),
    policy.setResourcePolicyWhitelist
);

authenticated.post(
    [
        "/resource-policy/:resourcePolicyId/rules",
        "/public-resource-policy/:resourcePolicyId/rules"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyRules),
    logActionAudit(ActionsEnum.setResourcePolicyRules),
    policy.setResourcePolicyRules
);

// Deprecated: use POST instead. Kept for backward compatibility.
authenticated.put(
    [
        "/resource-policy/:resourcePolicyId/rules",
        "/public-resource-policy/:resourcePolicyId/rules"
    ],
    verifyApiKeyResourcePolicyAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePolicyRules),
    logActionAudit(ActionsEnum.setResourcePolicyRules),
    policy.setResourcePolicyRules
);

authenticated.post(
    [
        "/resource/:resourceId/roles/add",
        "/public-resource/:resourceId/roles/add"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceRoles),
    logActionAudit(ActionsEnum.setResourceRoles),
    resource.addRoleToResource
);

authenticated.post(
    [
        "/resource/:resourceId/roles/remove",
        "/public-resource/:resourceId/roles/remove"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyRoleAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceRoles),
    logActionAudit(ActionsEnum.setResourceRoles),
    resource.removeRoleFromResource
);

authenticated.post(
    [
        "/resource/:resourceId/ai-models/add",
        "/public-resource/:resourceId/ai-models/add"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    resource.addAiModelToResource
);

authenticated.post(
    [
        "/resource/:resourceId/ai-models/remove",
        "/public-resource/:resourceId/ai-models/remove"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    resource.removeAiModelFromResource
);

authenticated.post(
    [
        "/resource/:resourceId/ai-providers/add",
        "/public-resource/:resourceId/ai-providers/add"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    resource.addAiProviderToResource
);

authenticated.post(
    [
        "/resource/:resourceId/ai-providers/remove",
        "/public-resource/:resourceId/ai-providers/remove"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.setResourceAiModels),
    logActionAudit(ActionsEnum.setResourceAiModels),
    resource.removeAiProviderFromResource
);

authenticated.post(
    [
        "/resource/:resourceId/users/add",
        "/public-resource/:resourceId/users/add"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeySetResourceUsers,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    resource.addUserToResource
);

authenticated.post(
    [
        "/resource/:resourceId/users/remove",
        "/public-resource/:resourceId/users/remove"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeySetResourceUsers,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    resource.removeUserFromResource
);

authenticated.post(
    [`/resource/:resourceId/password`, `/public-resource/:resourceId/password`],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePassword),
    logActionAudit(ActionsEnum.setResourcePassword),
    resource.setResourcePassword
);

authenticated.post(
    [`/resource/:resourceId/pincode`, `/public-resource/:resourceId/pincode`],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourcePincode),
    logActionAudit(ActionsEnum.setResourcePincode),
    resource.setResourcePincode
);

authenticated.post(
    [
        `/resource/:resourceId/header-auth`,
        `/public-resource/:resourceId/header-auth`
    ],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceHeaderAuth),
    logActionAudit(ActionsEnum.setResourceHeaderAuth),
    resource.setResourceHeaderAuth
);

authenticated.post(
    [
        `/resource/:resourceId/whitelist`,
        `/public-resource/:resourceId/whitelist`
    ],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceWhitelist),
    logActionAudit(ActionsEnum.setResourceWhitelist),
    resource.setResourceWhitelist
);

authenticated.post(
    [
        `/resource/:resourceId/whitelist/add`,
        `/public-resource/:resourceId/whitelist/add`
    ],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceWhitelist),
    resource.addEmailToResourceWhitelist
);

authenticated.post(
    [
        `/resource/:resourceId/whitelist/remove`,
        `/public-resource/:resourceId/whitelist/remove`
    ],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setResourceWhitelist),
    resource.removeEmailFromResourceWhitelist
);

authenticated.get(
    [
        `/resource/:resourceId/whitelist`,
        `/public-resource/:resourceId/whitelist`
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.getResourceWhitelist),
    resource.getResourceWhitelist
);

authenticated.post(
    [
        `/resource/:resourceId/access-token`,
        `/public-resource/:resourceId/access-token`
    ],
    verifyApiKeyResourceAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.generateAccessToken),
    logActionAudit(ActionsEnum.generateAccessToken),
    accessToken.generateAccessToken
);

authenticated.delete(
    `/access-token/:accessTokenId`,
    verifyApiKeyAccessTokenAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteAcessToken),
    logActionAudit(ActionsEnum.deleteAcessToken),
    accessToken.deleteAccessToken
);

authenticated.get(
    `/org/:orgId/access-tokens`,
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listAccessTokens),
    accessToken.listAccessTokens
);

authenticated.get(
    [
        `/resource/:resourceId/access-tokens`,
        `/public-resource/:resourceId/access-tokens`
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listAccessTokens),
    accessToken.listAccessTokens
);

authenticated.get(
    "/org/:orgId/user/:userId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getOrgUser),
    user.getOrgUser
);

authenticated.get(
    "/org/:orgId/user-by-username",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getOrgUser),
    user.getOrgUserByUsername
);

authenticated.post(
    "/user/:userId/2fa",
    verifyApiKeyIsRoot,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateUser),
    logActionAudit(ActionsEnum.updateUser),
    user.updateUser2FA
);

authenticated.get(
    "/user/:userId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.getUser),
    user.adminGetUser
);

authenticated.get(
    "/org/:orgId/users",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listUsers),
    user.listUsers
);

authenticated.put(
    "/org/:orgId/user",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createOrgUser),
    logActionAudit(ActionsEnum.createOrgUser),
    user.createOrgUser
);

authenticated.post(
    "/org/:orgId/user/:userId",
    verifyApiKeyOrgAccess,
    verifyApiKeyUserAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateOrgUser),
    logActionAudit(ActionsEnum.updateOrgUser),
    user.updateOrgUser
);

authenticated.delete(
    "/org/:orgId/user/:userId",
    verifyApiKeyOrgAccess,
    verifyApiKeyUserAccess,
    verifyApiKeyHasAction(ActionsEnum.removeUser),
    logActionAudit(ActionsEnum.removeUser),
    user.removeUserOrg
);

authenticated.get(
    `/org/:orgId/api-keys`,
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.listApiKeys),
    apiKeys.listOrgApiKeys
);

authenticated.post(
    `/org/:orgId/api-key/:apiKeyId/actions`,
    verifyApiKeyIsRoot,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.setApiKeyActions),
    logActionAudit(ActionsEnum.setApiKeyActions),
    apiKeys.setApiKeyActions
);

authenticated.get(
    `/org/:orgId/api-key/:apiKeyId/actions`,
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.listApiKeyActions),
    apiKeys.listApiKeyActions
);

authenticated.put(
    `/org/:orgId/api-key`,
    verifyApiKeyIsRoot,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createApiKey),
    logActionAudit(ActionsEnum.createApiKey),
    apiKeys.createOrgApiKey
);

authenticated.delete(
    `/org/:orgId/api-key/:apiKeyId`,
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.deleteApiKey),
    logActionAudit(ActionsEnum.deleteApiKey),
    apiKeys.deleteApiKey
);

authenticated.put(
    "/idp/oidc",
    verifyApiKeyIsRoot,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createIdp),
    logActionAudit(ActionsEnum.createIdp),
    idp.createOidcIdp
);

authenticated.post(
    "/idp/:idpId/oidc",
    verifyApiKeyIsRoot,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateIdp),
    logActionAudit(ActionsEnum.updateIdp),
    idp.updateOidcIdp
);

authenticated.get(
    "/idp", // no guards on this because anyone can list idps for login purposes
    // we do the same for the external api
    // verifyApiKeyIsRoot,
    // verifyApiKeyHasAction(ActionsEnum.listIdps),
    idp.listIdps
);

authenticated.get(
    "/idp/:idpId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.getIdp),
    idp.getIdp
);

authenticated.delete(
    "/idp/:idpId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.deleteIdp),
    idp.deleteIdp
);

authenticated.put(
    "/idp/:idpId/org/:orgId",
    verifyApiKeyIsRoot,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createIdpOrg),
    logActionAudit(ActionsEnum.createIdpOrg),
    idp.createIdpOrgPolicy
);

authenticated.post(
    "/idp/:idpId/org/:orgId",
    verifyApiKeyIsRoot,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateIdpOrg),
    logActionAudit(ActionsEnum.updateIdpOrg),
    idp.updateIdpOrgPolicy
);

authenticated.delete(
    "/idp/:idpId/org/:orgId",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.deleteIdpOrg),
    logActionAudit(ActionsEnum.deleteIdpOrg),
    idp.deleteIdpOrgPolicy
);

authenticated.get(
    "/idp/:idpId/org",
    verifyApiKeyIsRoot,
    verifyApiKeyHasAction(ActionsEnum.listIdpOrgs),
    idp.listIdpOrgPolicies
);

authenticated.get(
    "/org/:orgId/pick-client-defaults",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.createClient),
    client.pickClientDefaults
);

authenticated.get(
    "/org/:orgId/clients",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listClients),
    client.listClients
);

authenticated.get(
    "/org/:orgId/user-devices",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listClients),
    client.listUserDevices
);

authenticated.get(
    "/client/:clientId",
    verifyApiKeyClientAccess,
    verifyApiKeyHasAction(ActionsEnum.getClient),
    client.getClient
);

authenticated.put(
    "/org/:orgId/client",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createClient),
    logActionAudit(ActionsEnum.createClient),
    client.createClient
);

// authenticated.put(
//     "/org/:orgId/user/:userId/client",
//     verifyClientsEnabled,
//     verifyApiKeyOrgAccess,
//     verifyApiKeyUserAccess,
//     verifyApiKeyHasAction(ActionsEnum.createClient),
//     logActionAudit(ActionsEnum.createClient),
//     client.createUserClient
// );

authenticated.delete(
    "/client/:clientId",
    verifyApiKeyClientAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteClient),
    logActionAudit(ActionsEnum.deleteClient),
    client.deleteClient
);

authenticated.post(
    "/client/:clientId/archive",
    verifyApiKeyClientAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.archiveClient),
    logActionAudit(ActionsEnum.archiveClient),
    client.archiveClient
);

authenticated.post(
    "/client/:clientId/unarchive",
    verifyApiKeyClientAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.unarchiveClient),
    logActionAudit(ActionsEnum.unarchiveClient),
    client.unarchiveClient
);

authenticated.post(
    "/client/:clientId/block",
    verifyApiKeyClientAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.blockClient),
    logActionAudit(ActionsEnum.blockClient),
    client.blockClient
);

authenticated.post(
    "/client/:clientId/unblock",
    verifyApiKeyClientAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.unblockClient),
    logActionAudit(ActionsEnum.unblockClient),
    client.unblockClient
);

authenticated.post(
    "/client/:clientId",
    verifyApiKeyClientAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.updateClient),
    logActionAudit(ActionsEnum.updateClient),
    client.updateClient
);

authenticated.put(
    "/org/:orgId/blueprint",
    verifyApiKeyOrgAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.applyBlueprint),
    logActionAudit(ActionsEnum.applyBlueprint),
    blueprints.applyJSONBlueprint
);

authenticated.get(
    "/org/:orgId/blueprint/:blueprintId",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getBlueprint),
    blueprints.getBlueprint
);

authenticated.get(
    "/org/:orgId/blueprints",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listBlueprints),
    blueprints.listBlueprints
);

authenticated.get(
    "/org/:orgId/logs/request",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryRequestAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/request/export",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportRequestAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/ai/usage/filters",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryAiUsageFilterOptions
);

authenticated.get(
    "/org/:orgId/logs/ai/usage/overview",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryAiUsageOverview
);

authenticated.get(
    "/org/:orgId/logs/ai/usage/providers",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryAiUsageProviders
);

authenticated.get(
    "/org/:orgId/logs/ai/usage/resources",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryAiUsageResources
);

authenticated.get(
    "/org/:orgId/logs/ai/usage/users-roles",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryAiUsageUsersRoles
);

authenticated.get(
    "/org/:orgId/logs/ai/usage/virtual-api-keys",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryAiUsageVirtualApiKeys
);

authenticated.get(
    "/org/:orgId/logs/analytics",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.viewLogs),
    logs.queryRequestAnalytics
);

authenticated.get(
    ["/org/:orgId/resource-names", "/org/:orgId/public-resource-names"],
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listResources),
    resource.listAllResourceNames
);

authenticated.put(
    "/org/:orgId/ai-provider",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.createAiProvider),
    logActionAudit(ActionsEnum.createAiProvider),
    aiProvider.createAiProvider
);

authenticated.get(
    "/org/:orgId/ai-providers",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiProviders),
    aiProvider.listAiProviders
);

authenticated.get(
    "/ai-provider/:providerId",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.getAiProvider),
    aiProvider.getAiProvider
);
authenticated.get(
    "/org/:orgId/ai-provider/:niceId",
    verifyApiKeyOrgAccess,
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.getAiProvider),
    aiProvider.getAiProvider
);

authenticated.put(
    "/ai-provider/:providerId/target",
    verifyApiKeyAiProviderAccess,
    verifyLimits,
    verifyApiKeyHasAction(ActionsEnum.createTarget),
    logActionAudit(ActionsEnum.createTarget),
    target.createTarget
);

authenticated.get(
    "/ai-provider/:providerId/targets",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.listTargets),
    target.listTargets
);

authenticated.post(
    "/ai-provider/:providerId",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.updateAiProvider),
    logActionAudit(ActionsEnum.updateAiProvider),
    aiProvider.updateAiProvider
);

authenticated.delete(
    "/ai-provider/:providerId",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteAiProvider),
    logActionAudit(ActionsEnum.deleteAiProvider),
    aiProvider.deleteAiProvider
);

authenticated.put(
    "/ai-provider/:providerId/model",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.createAiModel),
    logActionAudit(ActionsEnum.createAiModel),
    aiProvider.createAiModel
);

authenticated.get(
    "/ai-provider/:providerId/models",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiModels),
    aiProvider.listAiModels
);

authenticated.get(
    "/ai-provider/:providerId/catalog-models",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiModels),
    aiProvider.listCatalogModels
);

authenticated.get(
    "/org/:orgId/ai-catalog-models",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiModels),
    aiProvider.listCatalogModelsByType
);

authenticated.get(
    "/ai-model/:modelId",
    verifyApiKeyAiModelAccess,
    verifyApiKeyHasAction(ActionsEnum.getAiModel),
    aiProvider.getAiModel
);

authenticated.post(
    "/ai-model/:modelId",
    verifyApiKeyAiModelAccess,
    verifyApiKeyHasAction(ActionsEnum.updateAiModel),
    logActionAudit(ActionsEnum.updateAiModel),
    aiProvider.updateAiModel
);

authenticated.delete(
    "/ai-model/:modelId",
    verifyApiKeyAiModelAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteAiModel),
    logActionAudit(ActionsEnum.deleteAiModel),
    aiProvider.deleteAiModel
);

authenticated.put(
    "/org/:orgId/ai-budget",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.createAiBudget),
    logActionAudit(ActionsEnum.createAiBudget),
    aiBudget.createAiBudget
);

authenticated.get(
    "/org/:orgId/ai-budgets",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiBudgets),
    aiBudget.listAiBudgets
);

authenticated.get(
    "/ai-budget/:budgetId",
    verifyApiKeyAiBudgetAccess,
    verifyApiKeyHasAction(ActionsEnum.getAiBudget),
    aiBudget.getAiBudget
);

authenticated.post(
    "/ai-budget/:budgetId",
    verifyApiKeyAiBudgetAccess,
    verifyApiKeyHasAction(ActionsEnum.updateAiBudget),
    logActionAudit(ActionsEnum.updateAiBudget),
    aiBudget.updateAiBudget
);

authenticated.delete(
    "/ai-budget/:budgetId",
    verifyApiKeyAiBudgetAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteAiBudget),
    logActionAudit(ActionsEnum.deleteAiBudget),
    aiBudget.deleteAiBudget
);

authenticated.put(
    "/org/:orgId/virtual-api-key",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.createVirtualApiKey),
    logActionAudit(ActionsEnum.createVirtualApiKey),
    virtualApiKey.createVirtualApiKey
);

authenticated.get(
    "/org/:orgId/virtual-api-keys",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.listVirtualApiKeys),
    virtualApiKey.listVirtualApiKeys
);

authenticated.post(
    "/org/:orgId/virtual-api-keys/email-identity-keys",
    verifyApiKeyOrgAccess,
    verifyApiKeyHasAction(ActionsEnum.getVirtualApiKey),
    virtualApiKey.emailIdentityKeysRateLimit,
    logActionAudit(ActionsEnum.getVirtualApiKey),
    virtualApiKey.emailIdentityKeys
);

authenticated.get(
    "/virtual-api-key/:virtualApiKeyId",
    verifyApiKeyVirtualApiKeyAccess,
    verifyApiKeyHasAction(ActionsEnum.getVirtualApiKey),
    virtualApiKey.getVirtualApiKey
);

authenticated.post(
    "/virtual-api-key/:virtualApiKeyId",
    verifyApiKeyVirtualApiKeyAccess,
    verifyApiKeyHasAction(ActionsEnum.updateVirtualApiKey),
    logActionAudit(ActionsEnum.updateVirtualApiKey),
    virtualApiKey.updateVirtualApiKey
);

authenticated.delete(
    "/virtual-api-key/:virtualApiKeyId",
    verifyApiKeyVirtualApiKeyAccess,
    verifyApiKeyHasAction(ActionsEnum.deleteVirtualApiKey),
    logActionAudit(ActionsEnum.deleteVirtualApiKey),
    virtualApiKey.deleteVirtualApiKey
);

authenticated.get(
    "/ai-provider/:providerId/ai-budgets",
    verifyApiKeyAiProviderAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiBudgets),
    aiBudget.listAiBudgetsForProvider
);

authenticated.get(
    "/ai-model/:modelId/ai-budgets",
    verifyApiKeyAiModelAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiBudgets),
    aiBudget.listAiBudgetsForModel
);

authenticated.get(
    [
        "/resource/:resourceId/ai-budgets",
        "/public-resource/:resourceId/ai-budgets"
    ],
    verifyApiKeyResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiBudgets),
    aiBudget.listAiBudgetsForResource
);

authenticated.get(
    [
        "/site-resource/:siteResourceId/ai-budgets",
        "/private-resource/:siteResourceId/ai-budgets"
    ],
    verifyApiKeySiteResourceAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiBudgets),
    aiBudget.listAiBudgetsForSiteResource
);

authenticated.get(
    "/role/:roleId/ai-budgets",
    verifyApiKeyRoleAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiBudgets),
    aiBudget.listAiBudgetsForRole
);

authenticated.get(
    "/virtual-api-key/:virtualApiKeyId/ai-budgets",
    verifyApiKeyVirtualApiKeyAccess,
    verifyApiKeyHasAction(ActionsEnum.listAiBudgets),
    aiBudget.listAiBudgetsForVirtualApiKey
);
