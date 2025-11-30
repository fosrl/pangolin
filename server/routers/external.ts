import { Router } from "express";
import config from "@server/lib/config";
import * as site from "./site";
import * as org from "./org";
import * as resource from "./resource";
import * as domain from "./domain";
import * as target from "./target";
import * as user from "./user";
import * as auth from "./auth";
import * as role from "./role";
import * as client from "./client";
import * as siteResource from "./siteResource";
import * as supporterKey from "./supporterKey";
import * as accessToken from "./accessToken";
import * as idp from "./idp";
import * as blueprints from "./blueprints";
import * as apiKeys from "./apiKeys";
import * as logs from "./auditLogs";
import HttpCode from "@server/types/HttpCode";
import {
    verifyAccessTokenAccess,
    verifySessionMiddleware,
    verifySessionUserMiddleware,
    verifyOrgAccess,
    verifySiteAccess,
    verifyResourceAccess,
    verifyTargetAccess,
    verifyRoleAccess,
    verifySetResourceUsers,
    verifyUserAccess,
    getUserOrgs,
    verifyUserIsServerAdmin,
    verifyIsLoggedInUser,
    verifyClientAccess,
    verifyApiKeyAccess,
    verifyDomainAccess,
    verifyClientsEnabled,
    verifyUserHasAction,
    verifyUserIsOrgOwner,
    verifySiteResourceAccess
} from "@server/middlewares";
import { ActionsEnum } from "@server/auth/actions";
import { createNewt, getNewtToken } from "./newt";
import { getOlmToken } from "./olm";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import createHttpError from "http-errors";
import { build } from "@server/build";
import { createStore } from "#dynamic/lib/rateLimitStore";
import { logActionAudit } from "#dynamic/middlewares";
import { log } from "console";

// Root routes
export const unauthenticated = Router();

unauthenticated.get("/", (_, res) => {
    res.status(HttpCode.OK).json({ message: "Healthy" });
});

// Authenticated Root routes
export const authenticated = Router();
authenticated.use(verifySessionUserMiddleware);

authenticated.get("/pick-org-defaults", org.pickOrgDefaults);
authenticated.get("/org/checkId", org.checkId);
if (build === "oss" || build === "enterprise") {
    authenticated.put("/org", getUserOrgs, org.createOrg);
}

authenticated.get("/orgs", verifyUserIsServerAdmin, org.listOrgs);
authenticated.get("/user/:userId/orgs", verifyIsLoggedInUser, org.listUserOrgs);

authenticated.get(
    "/org/:orgId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getOrg),
    org.getOrg
);
authenticated.post(
    "/org/:orgId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.updateOrg),
    logActionAudit(ActionsEnum.updateOrg),
    org.updateOrg,
);

if (build !== "saas") {
    authenticated.delete(
        "/org/:orgId",
        verifyOrgAccess,
        verifyUserIsOrgOwner,
        verifyUserHasAction(ActionsEnum.deleteOrg),
        logActionAudit(ActionsEnum.deleteOrg),
        org.deleteOrg,
    );
}

authenticated.put(
    "/org/:orgId/site",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createSite),
    logActionAudit(ActionsEnum.createSite),
    site.createSite
);
authenticated.get(
    "/org/:orgId/sites",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listSites),
    site.listSites
);
authenticated.get(
    "/org/:orgId/site/:niceId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getSite),
    site.getSite
);

authenticated.get(
    "/org/:orgId/pick-site-defaults",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createSite),
    site.pickSiteDefaults
);
authenticated.get(
    "/site/:siteId",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.getSite),
    site.getSite
);

authenticated.get(
    "/org/:orgId/pick-client-defaults",
    verifyClientsEnabled,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createClient),
    client.pickClientDefaults
);

authenticated.get(
    "/org/:orgId/clients",
    verifyClientsEnabled,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listClients),
    client.listClients
);

authenticated.get(
    "/client/:clientId",
    verifyClientsEnabled,
    verifyClientAccess,
    verifyUserHasAction(ActionsEnum.getClient),
    client.getClient
);

authenticated.put(
    "/org/:orgId/client",
    verifyClientsEnabled,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createClient),
    logActionAudit(ActionsEnum.createClient),
    client.createClient,
);

authenticated.delete(
    "/client/:clientId",
    verifyClientsEnabled,
    verifyClientAccess,
    verifyUserHasAction(ActionsEnum.deleteClient),
    logActionAudit(ActionsEnum.deleteClient),
    client.deleteClient,
);

authenticated.post(
    "/client/:clientId",
    verifyClientsEnabled,
    verifyClientAccess, // this will check if the user has access to the client
    verifyUserHasAction(ActionsEnum.updateClient), // this will check if the user has permission to update the client
    logActionAudit(ActionsEnum.updateClient),
    client.updateClient,
);

// authenticated.get(
//     "/site/:siteId/roles",
//     verifySiteAccess,
//     verifyUserHasAction(ActionsEnum.listSiteRoles),
//     site.listSiteRoles
// );
authenticated.post(
    "/site/:siteId",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.updateSite),
    logActionAudit(ActionsEnum.updateSite),
    site.updateSite,
);
authenticated.delete(
    "/site/:siteId",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.deleteSite),
    logActionAudit(ActionsEnum.deleteSite),
    site.deleteSite,
);

// TODO: BREAK OUT THESE ACTIONS SO THEY ARE NOT ALL "getSite"
authenticated.get(
    "/site/:siteId/docker/status",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.getSite),
    site.dockerStatus
);
authenticated.get(
    "/site/:siteId/docker/online",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.getSite),
    site.dockerOnline
);
authenticated.post(
    "/site/:siteId/docker/check",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.getSite),
    site.checkDockerSocket,
);
authenticated.post(
    "/site/:siteId/docker/trigger",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.getSite),
    site.triggerFetchContainers,
);
authenticated.get(
    "/site/:siteId/docker/containers",
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.getSite),
    site.listContainers
);

// Site Resource endpoints
authenticated.put(
    "/org/:orgId/site/:siteId/resource",
    verifyOrgAccess,
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.createSiteResource),
    logActionAudit(ActionsEnum.createSiteResource),
    siteResource.createSiteResource,
);

authenticated.get(
    "/org/:orgId/site/:siteId/resources",
    verifyOrgAccess,
    verifySiteAccess,
    verifyUserHasAction(ActionsEnum.listSiteResources),
    siteResource.listSiteResources
);

authenticated.get(
    "/org/:orgId/site-resources",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listSiteResources),
    siteResource.listAllSiteResourcesByOrg
);

authenticated.get(
    "/org/:orgId/site/:siteId/resource/:siteResourceId",
    verifyOrgAccess,
    verifySiteAccess,
    verifySiteResourceAccess,
    verifyUserHasAction(ActionsEnum.getSiteResource),
    siteResource.getSiteResource
);

authenticated.post(
    "/org/:orgId/site/:siteId/resource/:siteResourceId",
    verifyOrgAccess,
    verifySiteAccess,
    verifySiteResourceAccess,
    verifyUserHasAction(ActionsEnum.updateSiteResource),
    logActionAudit(ActionsEnum.updateSiteResource),
    siteResource.updateSiteResource,
);

authenticated.delete(
    "/org/:orgId/site/:siteId/resource/:siteResourceId",
    verifyOrgAccess,
    verifySiteAccess,
    verifySiteResourceAccess,
    verifyUserHasAction(ActionsEnum.deleteSiteResource),
    logActionAudit(ActionsEnum.deleteSiteResource),
    siteResource.deleteSiteResource,
);

authenticated.put(
    "/org/:orgId/resource",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createResource),
    logActionAudit(ActionsEnum.createResource),
    resource.createResource,
);

authenticated.get(
    "/site/:siteId/resources",
    verifyUserHasAction(ActionsEnum.listResources),
    resource.listResources
);

authenticated.get(
    "/org/:orgId/resources",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listResources),
    resource.listResources
);

authenticated.get(
    "/org/:orgId/user-resources",
    verifyOrgAccess,
    resource.getUserResources
);

authenticated.get(
    "/org/:orgId/domains",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listOrgDomains),
    domain.listDomains
);

authenticated.get(
    "/org/:orgId/domain/:domainId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getDomain),
    domain.getDomain
);

authenticated.patch(
    "/org/:orgId/domain/:domainId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.updateOrgDomain),
    domain.updateOrgDomain
);

authenticated.get(
    "/org/:orgId/domain/:domainId/dns-records",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getDNSRecords),
    domain.getDNSRecords
);

authenticated.get(
    "/org/:orgId/invitations",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listInvitations),
    user.listInvitations
);

authenticated.delete(
    "/org/:orgId/invitations/:inviteId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.removeInvitation),
    logActionAudit(ActionsEnum.removeInvitation),
    user.removeInvitation,
);

authenticated.post(
    "/org/:orgId/create-invite",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.inviteUser),
    logActionAudit(ActionsEnum.inviteUser),
    user.inviteUser,
); // maybe make this /invite/create instead

unauthenticated.post("/invite/accept", user.acceptInvite); // this is supposed to be unauthenticated

authenticated.get(
    "/resource/:resourceId/roles",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.listResourceRoles),
    resource.listResourceRoles
);

authenticated.get(
    "/resource/:resourceId/users",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.listResourceUsers),
    resource.listResourceUsers
);

authenticated.get(
    "/resource/:resourceId",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.getResource),
    resource.getResource
);
authenticated.get(
    "/org/:orgId/resource/:niceId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getResource),
    resource.getResource
);
authenticated.post(
    "/resource/:resourceId",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.updateResource),
    logActionAudit(ActionsEnum.updateResource),
    resource.updateResource,
);
authenticated.delete(
    "/resource/:resourceId",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.deleteResource),
    logActionAudit(ActionsEnum.deleteResource),
    resource.deleteResource,
);

authenticated.put(
    "/resource/:resourceId/target",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.createTarget),
    logActionAudit(ActionsEnum.createTarget),
    target.createTarget,
);
authenticated.get(
    "/resource/:resourceId/targets",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.listTargets),
    target.listTargets
);

authenticated.put(
    "/resource/:resourceId/rule",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.createResourceRule),
    logActionAudit(ActionsEnum.createResourceRule),
    resource.createResourceRule,
);
authenticated.get(
    "/resource/:resourceId/rules",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.listResourceRules),
    resource.listResourceRules
);
authenticated.post(
    "/resource/:resourceId/rule/:ruleId",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.updateResourceRule),
    logActionAudit(ActionsEnum.updateResourceRule),
    resource.updateResourceRule,
);
authenticated.delete(
    "/resource/:resourceId/rule/:ruleId",
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.deleteResourceRule),
    logActionAudit(ActionsEnum.deleteResourceRule),
    resource.deleteResourceRule,
);

authenticated.get(
    "/target/:targetId",
    verifyTargetAccess,
    verifyUserHasAction(ActionsEnum.getTarget),
    target.getTarget
);
authenticated.post(
    "/target/:targetId",
    verifyTargetAccess,
    verifyUserHasAction(ActionsEnum.updateTarget),
    logActionAudit(ActionsEnum.updateTarget),
    target.updateTarget,
);
authenticated.delete(
    "/target/:targetId",
    verifyTargetAccess,
    verifyUserHasAction(ActionsEnum.deleteTarget),
    logActionAudit(ActionsEnum.deleteTarget),
    target.deleteTarget,
);

authenticated.put(
    "/org/:orgId/role",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createRole),
    logActionAudit(ActionsEnum.createRole),
    role.createRole,
);
authenticated.get(
    "/org/:orgId/roles",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listRoles),
    role.listRoles
);
// authenticated.get(
//     "/role/:roleId",
//     verifyRoleAccess,
//     verifyUserInRole,
//     verifyUserHasAction(ActionsEnum.getRole),
//     role.getRole
// );
// authenticated.post(
//     "/role/:roleId",
//     verifyRoleAccess,
//     verifyUserHasAction(ActionsEnum.updateRole),
//     role.updateRole
// );
authenticated.delete(
    "/role/:roleId",
    verifyRoleAccess,
    verifyUserHasAction(ActionsEnum.deleteRole),
    logActionAudit(ActionsEnum.deleteRole),
    role.deleteRole,
);
authenticated.post(
    "/role/:roleId/add/:userId",
    verifyRoleAccess,
    verifyUserAccess,
    verifyUserHasAction(ActionsEnum.addUserRole),
    logActionAudit(ActionsEnum.addUserRole),
    user.addUserRole,
);

authenticated.post(
    "/resource/:resourceId/roles",
    verifyResourceAccess,
    verifyRoleAccess,
    verifyUserHasAction(ActionsEnum.setResourceRoles),
    logActionAudit(ActionsEnum.setResourceRoles),
    resource.setResourceRoles,
);

authenticated.post(
    "/resource/:resourceId/users",
    verifyResourceAccess,
    verifySetResourceUsers,
    verifyUserHasAction(ActionsEnum.setResourceUsers),
    logActionAudit(ActionsEnum.setResourceUsers),
    resource.setResourceUsers,
);

authenticated.post(
    `/resource/:resourceId/password`,
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.setResourcePassword),
    logActionAudit(ActionsEnum.setResourcePassword),
    resource.setResourcePassword,
);

authenticated.post(
    `/resource/:resourceId/pincode`,
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.setResourcePincode),
    logActionAudit(ActionsEnum.setResourcePincode),
    resource.setResourcePincode,
);

authenticated.post(
    `/resource/:resourceId/header-auth`,
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.setResourceHeaderAuth),
    logActionAudit(ActionsEnum.setResourceHeaderAuth),
    resource.setResourceHeaderAuth,
);

authenticated.post(
    `/resource/:resourceId/whitelist`,
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.setResourceWhitelist),
    logActionAudit(ActionsEnum.setResourceWhitelist),
    resource.setResourceWhitelist,
);

authenticated.get(
    `/resource/:resourceId/whitelist`,
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.getResourceWhitelist),
    resource.getResourceWhitelist
);

authenticated.post(
    `/resource/:resourceId/access-token`,
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.generateAccessToken),
    logActionAudit(ActionsEnum.generateAccessToken),
    accessToken.generateAccessToken,
);

authenticated.delete(
    `/access-token/:accessTokenId`,
    verifyAccessTokenAccess,
    verifyUserHasAction(ActionsEnum.deleteAcessToken),
    logActionAudit(ActionsEnum.deleteAcessToken),
    accessToken.deleteAccessToken,
);

authenticated.get(
    `/org/:orgId/access-tokens`,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listAccessTokens),
    accessToken.listAccessTokens
);

authenticated.get(
    `/resource/:resourceId/access-tokens`,
    verifyResourceAccess,
    verifyUserHasAction(ActionsEnum.listAccessTokens),
    accessToken.listAccessTokens
);

authenticated.get(`/org/:orgId/overview`, verifyOrgAccess, org.getOrgOverview);

authenticated.post(
    `/supporter-key/validate`,
    supporterKey.validateSupporterKey
);
authenticated.post(`/supporter-key/hide`, supporterKey.hideSupporterKey);

unauthenticated.get(
    "/resource/:resourceGuid/auth",
    resource.getResourceAuthInfo
);

// authenticated.get(
//     "/role/:roleId/resources",
//     verifyRoleAccess,
//     verifyUserInRole,
//     verifyUserHasAction(ActionsEnum.listRoleResources),
//     role.listRoleResources
// );
// authenticated.put(
//     "/role/:roleId/action",
//     verifyRoleAccess,
//     verifyUserInRole,
//     verifyUserHasAction(ActionsEnum.addRoleAction),
//     role.addRoleAction
// );
// authenticated.delete(
//     "/role/:roleId/action",
//     verifyRoleAccess,
//     verifyUserInRole,
//     verifyUserHasAction(ActionsEnum.removeRoleAction),
//     role.removeRoleAction
// );
// authenticated.get(
//     "/role/:roleId/actions",
//     verifyRoleAccess,
//     verifyUserInRole,
//     verifyUserHasAction(ActionsEnum.listRoleActions),
//     role.listRoleActions
// );

unauthenticated.get("/user", verifySessionMiddleware, user.getUser);

authenticated.get("/users", verifyUserIsServerAdmin, user.adminListUsers);
authenticated.get("/user/:userId", verifyUserIsServerAdmin, user.adminGetUser);
authenticated.delete(
    "/user/:userId",
    verifyUserIsServerAdmin,
    user.adminRemoveUser
);

authenticated.put(
    "/org/:orgId/user",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createOrgUser),
    logActionAudit(ActionsEnum.createOrgUser),
    user.createOrgUser,
);

authenticated.post(
    "/org/:orgId/user/:userId",
    verifyOrgAccess,
    verifyUserAccess,
    verifyUserHasAction(ActionsEnum.updateOrgUser),
    logActionAudit(ActionsEnum.updateOrgUser),
    user.updateOrgUser,
);

authenticated.get("/org/:orgId/user/:userId", verifyOrgAccess, user.getOrgUser);
authenticated.get("/org/:orgId/user/:userId/check", org.checkOrgUserAccess);

authenticated.post(
    "/user/:userId/2fa",
    verifyUserIsServerAdmin,
    user.updateUser2FA
);

authenticated.get(
    "/org/:orgId/users",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listUsers),
    user.listUsers
);
authenticated.delete(
    "/org/:orgId/user/:userId",
    verifyOrgAccess,
    verifyUserAccess,
    verifyUserHasAction(ActionsEnum.removeUser),
    logActionAudit(ActionsEnum.removeUser),
    user.removeUserOrg,
);

// authenticated.put(
//     "/user/:userId/site",
//     verifySiteAccess,
//     verifyUserAccess,
//     verifyUserHasAction(ActionsEnum.addRoleSite),
//     role.addRoleSite
// );
// authenticated.delete(
//     "/user/:userId/site",
//     verifySiteAccess,
//     verifyUserAccess,
//     verifyUserHasAction(ActionsEnum.removeRoleSite),
//     role.removeRoleSite
// );
// authenticated.put(
//     "/org/:orgId/user/:userId/action",
//     verifyOrgAccess,
//     verifyUserAccess,
//     verifyUserHasAction(ActionsEnum.addRoleAction),
//     role.addRoleAction
// );
// authenticated.delete(
//     "/org/:orgId/user/:userId/action",
//     verifyOrgAccess,
//     verifyUserAccess,
//     verifyUserHasAction(ActionsEnum.removeRoleAction),
//     role.removeRoleAction
// );

// authenticated.put(
//     "/newt",
//     verifyUserHasAction(ActionsEnum.createNewt),
//     createNewt
// );

authenticated.put(
    "/idp/oidc",
    verifyUserIsServerAdmin,
    // verifyUserHasAction(ActionsEnum.createIdp),
    idp.createOidcIdp
);

authenticated.post(
    "/idp/:idpId/oidc",
    verifyUserIsServerAdmin,
    idp.updateOidcIdp
);

authenticated.delete("/idp/:idpId", verifyUserIsServerAdmin, idp.deleteIdp);

authenticated.get("/idp/:idpId", verifyUserIsServerAdmin, idp.getIdp);

authenticated.put(
    "/idp/:idpId/org/:orgId",
    verifyUserIsServerAdmin,
    idp.createIdpOrgPolicy
);

authenticated.post(
    "/idp/:idpId/org/:orgId",
    verifyUserIsServerAdmin,
    idp.updateIdpOrgPolicy
);

authenticated.delete(
    "/idp/:idpId/org/:orgId",
    verifyUserIsServerAdmin,
    idp.deleteIdpOrgPolicy
);

authenticated.get(
    "/idp/:idpId/org",
    verifyUserIsServerAdmin,
    idp.listIdpOrgPolicies
);

authenticated.get("/idp", idp.listIdps); // anyone can see this; it's just a list of idp names and ids
authenticated.get("/idp/:idpId", verifyUserIsServerAdmin, idp.getIdp);

authenticated.get(
    `/api-key/:apiKeyId`,
    verifyUserIsServerAdmin,
    apiKeys.getApiKey
);

authenticated.put(
    `/api-key`,
    verifyUserIsServerAdmin,
    apiKeys.createRootApiKey
);

authenticated.delete(
    `/api-key/:apiKeyId`,
    verifyUserIsServerAdmin,
    apiKeys.deleteApiKey
);

authenticated.get(
    `/api-keys`,
    verifyUserIsServerAdmin,
    apiKeys.listRootApiKeys
);

authenticated.get(
    `/api-key/:apiKeyId/actions`,
    verifyUserIsServerAdmin,
    apiKeys.listApiKeyActions
);

authenticated.post(
    `/api-key/:apiKeyId/actions`,
    verifyUserIsServerAdmin,
    apiKeys.setApiKeyActions
);

authenticated.get(
    `/org/:orgId/api-keys`,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listApiKeys),
    apiKeys.listOrgApiKeys
);

authenticated.post(
    `/org/:orgId/api-key/:apiKeyId/actions`,
    verifyOrgAccess,
    verifyApiKeyAccess,
    verifyUserHasAction(ActionsEnum.setApiKeyActions),
    logActionAudit(ActionsEnum.setApiKeyActions),
    apiKeys.setApiKeyActions,
);

authenticated.get(
    `/org/:orgId/api-key/:apiKeyId/actions`,
    verifyOrgAccess,
    verifyApiKeyAccess,
    verifyUserHasAction(ActionsEnum.listApiKeyActions),
    apiKeys.listApiKeyActions
);

authenticated.put(
    `/org/:orgId/api-key`,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createApiKey),
    logActionAudit(ActionsEnum.createApiKey),
    apiKeys.createOrgApiKey,
);

authenticated.delete(
    `/org/:orgId/api-key/:apiKeyId`,
    verifyOrgAccess,
    verifyApiKeyAccess,
    verifyUserHasAction(ActionsEnum.deleteApiKey),
    logActionAudit(ActionsEnum.deleteApiKey),
    apiKeys.deleteOrgApiKey,
);

authenticated.get(
    `/org/:orgId/api-key/:apiKeyId`,
    verifyOrgAccess,
    verifyApiKeyAccess,
    verifyUserHasAction(ActionsEnum.getApiKey),
    apiKeys.getApiKey
);

authenticated.put(
    `/org/:orgId/domain`,
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.createOrgDomain),
    logActionAudit(ActionsEnum.createOrgDomain),
    domain.createOrgDomain,
);

authenticated.post(
    `/org/:orgId/domain/:domainId/restart`,
    verifyOrgAccess,
    verifyDomainAccess,
    verifyUserHasAction(ActionsEnum.restartOrgDomain),
    logActionAudit(ActionsEnum.restartOrgDomain),
    domain.restartOrgDomain,
);

authenticated.delete(
    `/org/:orgId/domain/:domainId`,
    verifyOrgAccess,
    verifyDomainAccess,
    verifyUserHasAction(ActionsEnum.deleteOrgDomain),
    logActionAudit(ActionsEnum.deleteOrgDomain),
    domain.deleteAccountDomain,
);

authenticated.get(
    "/org/:orgId/logs/request",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.viewLogs),
    logs.queryRequestAuditLogs
);

authenticated.get(
    "/org/:orgId/logs/request/export",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.exportLogs),
    logActionAudit(ActionsEnum.exportLogs),
    logs.exportRequestAuditLogs
);

authenticated.get(
    "/org/:orgId/blueprints",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.listBlueprints),
    blueprints.listBlueprints
);

authenticated.put(
    "/org/:orgId/blueprint",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.applyBlueprint),
    blueprints.applyYAMLBlueprint
);

authenticated.get(
    "/org/:orgId/blueprint/:blueprintId",
    verifyOrgAccess,
    verifyUserHasAction(ActionsEnum.getBlueprint),
    blueprints.getBlueprint
);

// Auth routes
export const authRouter = Router();
unauthenticated.use("/auth", authRouter);
authRouter.use(
    rateLimit({
        windowMs: config.getRawConfig().rate_limits.auth.window_minutes,
        max: config.getRawConfig().rate_limits.auth.max_requests,
        keyGenerator: (req) =>
            `authRouterGlobal:${ipKeyGenerator(req.ip || "")}:${req.path}`,
        handler: (req, res, next) => {
            const message = `Rate limit exceeded. You can make ${config.getRawConfig().rate_limits.auth.max_requests} requests every ${config.getRawConfig().rate_limits.auth.window_minutes} minute(s).`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    })
);

authRouter.put(
    "/signup",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `signup:${ipKeyGenerator(req.ip || "")}:${req.body.email}`,
        handler: (req, res, next) => {
            const message = `You can only sign up ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.signup
);
authRouter.post(
    "/login",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `login:${req.body.email || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only log in ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.login
);
authRouter.post("/logout", auth.logout);
authRouter.post(
    "/newt/get-token",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 900,
        keyGenerator: (req) =>
            `newtGetToken:${req.body.newtId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only request a Newt token ${900} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    getNewtToken
);
authRouter.post(
    "/olm/get-token",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 900,
        keyGenerator: (req) =>
            `olmGetToken:${req.body.newtId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only request an Olm token ${900} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    getOlmToken
);

authRouter.post(
    "/2fa/enable",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) => {
            return `signup:${req.body.email || req.user?.userId || ipKeyGenerator(req.ip || "")}`;
        },
        handler: (req, res, next) => {
            const message = `You can only enable 2FA ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.verifyTotp
);
authRouter.post(
    "/2fa/request",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) => {
            return `signup:${req.body.email || req.user?.userId || ipKeyGenerator(req.ip || "")}`;
        },
        handler: (req, res, next) => {
            const message = `You can only request a 2FA code ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.requestTotpSecret
);
authRouter.post(
    "/2fa/disable",
    verifySessionUserMiddleware,
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `signup:${req.user?.userId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only disable 2FA ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.disable2fa
);
authRouter.post(
    "/verify-email",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `signup:${req.body.email || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only sign up ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    verifySessionMiddleware,
    auth.verifyEmail
);

authRouter.post(
    "/verify-email/request",
    verifySessionMiddleware,
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `requestEmailVerificationCode:${req.user?.email || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only request an email verification code ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.requestEmailVerificationCode
);

authRouter.post(
    "/change-password",
    verifySessionUserMiddleware,
    auth.changePassword
);

authRouter.post(
    "/reset-password/request",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `requestPasswordReset:${req.body.email || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only request a password reset ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.requestPasswordReset
);

authRouter.post(
    "/reset-password/",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `resetPassword:${req.body.email || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only request a password reset ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.resetPassword
);

authRouter.post(
    "/resource/:resourceId/password",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `authWithPassword:${ipKeyGenerator(req.ip || "")}:${req.params.resourceId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only authenticate with password ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    resource.authWithPassword
);
authRouter.post(
    "/resource/:resourceId/pincode",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `authWithPincode:${ipKeyGenerator(req.ip || "")}:${req.params.resourceId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only authenticate with pincode ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    resource.authWithPincode
);

authRouter.post(
    "/resource/:resourceId/whitelist",
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        keyGenerator: (req) =>
            `authWithWhitelist:${ipKeyGenerator(req.ip || "")}:${req.body.email}:${req.params.resourceId}`,
        handler: (req, res, next) => {
            const message = `You can only request an email OTP ${15} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    resource.authWithWhitelist
);

authRouter.post(
    "/resource/:resourceId/access-token",
    resource.authWithAccessToken
);

authRouter.post("/access-token", resource.authWithAccessToken);

authRouter.post("/idp/:idpId/oidc/generate-url", idp.generateOidcUrl);

authRouter.post("/idp/:idpId/oidc/validate-callback", idp.validateOidcCallback);

authRouter.put("/set-server-admin", auth.setServerAdmin);
authRouter.get("/initial-setup-complete", auth.initialSetupComplete);
authRouter.post("/validate-setup-token", auth.validateSetupToken);

// Security Key routes
authRouter.post(
    "/security-key/register/start",
    verifySessionUserMiddleware,
    rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // Allow 5 security key registrations per 15 minutes
        keyGenerator: (req) =>
            `securityKeyRegister:${req.user?.userId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only register a security key ${5} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.startRegistration
);
authRouter.post(
    "/security-key/register/verify",
    verifySessionUserMiddleware,
    auth.verifyRegistration
);
authRouter.post(
    "/security-key/authenticate/start",
    rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10, // Allow 10 authentication attempts per 15 minutes per IP
        keyGenerator: (req) => {
            return `securityKeyAuth:${req.body.email || ipKeyGenerator(req.ip || "")}`;
        },
        handler: (req, res, next) => {
            const message = `You can only attempt security key authentication ${10} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.startAuthentication
);
authRouter.post("/security-key/authenticate/verify", auth.verifyAuthentication);
authRouter.get(
    "/security-key/list",
    verifySessionUserMiddleware,
    auth.listSecurityKeys
);
authRouter.delete(
    "/security-key/:credentialId",
    verifySessionUserMiddleware,
    rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 20, // Allow 10 authentication attempts per 15 minutes per IP
        keyGenerator: (req) =>
            `securityKeyAuth:${req.user?.userId || ipKeyGenerator(req.ip || "")}`,
        handler: (req, res, next) => {
            const message = `You can only delete a security key ${10} times every ${15} minutes. Please try again later.`;
            return next(createHttpError(HttpCode.TOO_MANY_REQUESTS, message));
        },
        store: createStore()
    }),
    auth.deleteSecurityKey
);