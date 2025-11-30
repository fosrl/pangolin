import { Request } from "express";
import { db } from "@server/db";
import { userActions, roleActions, userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";

export enum ActionsEnum {
    createOrgUser = "createOrgUser",
    listOrgs = "listOrgs",
    listUserOrgs = "listUserOrgs",
    createOrg = "createOrg",
    // deleteOrg = "deleteOrg",
    getOrg = "getOrg",
    updateOrg = "updateOrg",
    deleteOrg = "deleteOrg",
    createSite = "createSite",
    deleteSite = "deleteSite",
    getSite = "getSite",
    listSites = "listSites",
    updateSite = "updateSite",
    createResource = "createResource",
    deleteResource = "deleteResource",
    getResource = "getResource",
    listResources = "listResources",
    updateResource = "updateResource",
    createTarget = "createTarget",
    deleteTarget = "deleteTarget",
    getTarget = "getTarget",
    listTargets = "listTargets",
    updateTarget = "updateTarget",
    createRole = "createRole",
    deleteRole = "deleteRole",
    getRole = "getRole",
    listRoles = "listRoles",
    updateRole = "updateRole",
    inviteUser = "inviteUser",
    listInvitations = "listInvitations",
    removeInvitation = "removeInvitation",
    removeUser = "removeUser",
    listUsers = "listUsers",
    listSiteRoles = "listSiteRoles",
    listResourceRoles = "listResourceRoles",
    setResourceUsers = "setResourceUsers",
    setResourceRoles = "setResourceRoles",
    listResourceUsers = "listResourceUsers",
    // removeRoleSite = "removeRoleSite",
    // addRoleAction = "addRoleAction",
    // removeRoleAction = "removeRoleAction",
    // listRoleSites = "listRoleSites",
    listRoleResources = "listRoleResources",
    // listRoleActions = "listRoleActions",
    addUserRole = "addUserRole",
    // addUserSite = "addUserSite",
    // addUserAction = "addUserAction",
    // removeUserAction = "removeUserAction",
    // removeUserSite = "removeUserSite",
    getOrgUser = "getOrgUser",
    updateUser = "updateUser",
    getUser = "getUser",
    setResourcePassword = "setResourcePassword",
    setResourcePincode = "setResourcePincode",
    setResourceHeaderAuth = "setResourceHeaderAuth",
    setResourceWhitelist = "setResourceWhitelist",
    getResourceWhitelist = "getResourceWhitelist",
    generateAccessToken = "generateAccessToken",
    deleteAcessToken = "deleteAcessToken",
    listAccessTokens = "listAccessTokens",
    createResourceRule = "createResourceRule",
    deleteResourceRule = "deleteResourceRule",
    listResourceRules = "listResourceRules",
    updateResourceRule = "updateResourceRule",
    createSiteResource = "createSiteResource",
    deleteSiteResource = "deleteSiteResource",
    getSiteResource = "getSiteResource",
    listSiteResources = "listSiteResources",
    updateSiteResource = "updateSiteResource",
    createClient = "createClient",
    deleteClient = "deleteClient",
    updateClient = "updateClient",
    listClients = "listClients",
    getClient = "getClient",
    listOrgDomains = "listOrgDomains",
    getDomain = "getDomain",
    updateOrgDomain = "updateOrgDomain",
    getDNSRecords = "getDNSRecords",
    createNewt = "createNewt",
    createIdp = "createIdp",
    updateIdp = "updateIdp",
    deleteIdp = "deleteIdp",
    listIdps = "listIdps",
    getIdp = "getIdp",
    createIdpOrg = "createIdpOrg",
    deleteIdpOrg = "deleteIdpOrg",
    listIdpOrgs = "listIdpOrgs",
    updateIdpOrg = "updateIdpOrg",
    checkOrgId = "checkOrgId",
    createApiKey = "createApiKey",
    deleteApiKey = "deleteApiKey",
    setApiKeyActions = "setApiKeyActions",
    setApiKeyOrgs = "setApiKeyOrgs",
    listApiKeyActions = "listApiKeyActions",
    listApiKeys = "listApiKeys",
    getApiKey = "getApiKey",
    getCertificate = "getCertificate",
    restartCertificate = "restartCertificate",
    billing = "billing",
    createOrgDomain = "createOrgDomain",
    deleteOrgDomain = "deleteOrgDomain",
    restartOrgDomain = "restartOrgDomain",
    sendUsageNotification = "sendUsageNotification",
    createRemoteExitNode = "createRemoteExitNode",
    updateRemoteExitNode = "updateRemoteExitNode",
    getRemoteExitNode = "getRemoteExitNode",
    listRemoteExitNode = "listRemoteExitNode",
    deleteRemoteExitNode = "deleteRemoteExitNode",
    updateOrgUser = "updateOrgUser",
    createLoginPage = "createLoginPage",
    updateLoginPage = "updateLoginPage",
    getLoginPage = "getLoginPage",
    deleteLoginPage = "deleteLoginPage",
    listBlueprints = "listBlueprints",
    getBlueprint = "getBlueprint",
    applyBlueprint = "applyBlueprint",
    viewLogs = "viewLogs",
    exportLogs = "exportLogs"
}

export async function checkUserActionPermission(
    actionId: string,
    req: Request
): Promise<boolean> {
    const userId = req.user?.userId;

    if (!userId) {
        throw createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated");
    }

    if (!req.userOrgId) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "Organization ID is required"
        );
    }

    try {
        let userOrgRoleId = req.userOrgRoleId;

        // If userOrgRoleId is not available on the request, fetch it
        if (userOrgRoleId === undefined) {
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, req.userOrgId!)
                    )
                )
                .limit(1);

            if (userOrgRole.length === 0) {
                throw createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                );
            }

            userOrgRoleId = userOrgRole[0].roleId;
        }

        // Check if the user has direct permission for the action in the current org
        const userActionPermission = await db
            .select()
            .from(userActions)
            .where(
                and(
                    eq(userActions.userId, userId),
                    eq(userActions.actionId, actionId),
                    eq(userActions.orgId, req.userOrgId!) // TODO: we cant pass the org id if we are not checking the org
                )
            )
            .limit(1);

        if (userActionPermission.length > 0) {
            return true;
        }

        // If no direct permission, check role-based permission
        const roleActionPermission = await db
            .select()
            .from(roleActions)
            .where(
                and(
                    eq(roleActions.actionId, actionId),
                    eq(roleActions.roleId, userOrgRoleId!),
                    eq(roleActions.orgId, req.userOrgId!)
                )
            )
            .limit(1);

        return roleActionPermission.length > 0;
    } catch (error) {
        console.error("Error checking user action permission:", error);
        throw createHttpError(
            HttpCode.INTERNAL_SERVER_ERROR,
            "Error checking action permission"
        );
    }
}
