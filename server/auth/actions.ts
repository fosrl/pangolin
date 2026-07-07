import { Request } from "express";
import { db } from "@server/db";
import { userActions, roleActions } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import logger from "@server/logger";

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
    restartSite = "restartSite",
    resetSiteBandwidth = "resetSiteBandwidth",
    reGenerateSecret = "reGenerateSecret",
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
    removeUserRole = "removeUserRole",
    setUserOrgRoles = "setUserOrgRoles",
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
    archiveClient = "archiveClient",
    unarchiveClient = "unarchiveClient",
    blockClient = "blockClient",
    unblockClient = "unblockClient",
    updateClient = "updateClient",
    listClients = "listClients",
    getClient = "getClient",
    listOrgDomains = "listOrgDomains",
    getDomain = "getDomain",
    updateOrgDomain = "updateOrgDomain",
    getDNSRecords = "getDNSRecords",
    createNewt = "createNewt",
    createOlm = "createOlm",
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
    createSiteProvisioningKey = "createSiteProvisioningKey",
    listSiteProvisioningKeys = "listSiteProvisioningKeys",
    updateSiteProvisioningKey = "updateSiteProvisioningKey",
    deleteSiteProvisioningKey = "deleteSiteProvisioningKey",
    getCertificate = "getCertificate",
    restartCertificate = "restartCertificate",
    billing = "billing",
    createOrgDomain = "createOrgDomain",
    deleteOrgDomain = "deleteOrgDomain",
    restartOrgDomain = "restartOrgDomain",
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
    exportLogs = "exportLogs",
    listApprovals = "listApprovals",
    updateApprovals = "updateApprovals",
    signSshKey = "signSshKey",
    createEventStreamingDestination = "createEventStreamingDestination",
    updateEventStreamingDestination = "updateEventStreamingDestination",
    deleteEventStreamingDestination = "deleteEventStreamingDestination",
    listEventStreamingDestinations = "listEventStreamingDestinations",
    createAlertRule = "createAlertRule",
    updateAlertRule = "updateAlertRule",
    deleteAlertRule = "deleteAlertRule",
    listAlertRules = "listAlertRules",
    listOrgLabels = "listOrgLabels",
    createOrgLabel = "createOrgLabel",
    updateOrgLabel = "updateOrgLabel",
    deleteOrgLabel = "deleteOrgLabel",
    attachLabelToItem = "attachLabelToItem",
    detachLabelFromItem = "detachLabelFromItem",
    getAlertRule = "getAlertRule",
    createHealthCheck = "createHealthCheck",
    updateHealthCheck = "updateHealthCheck",
    deleteHealthCheck = "deleteHealthCheck",
    listHealthChecks = "listHealthChecks",
    createBrowserGatewayTarget = "createBrowserGatewayTarget",
    updateBrowserGatewayTarget = "updateBrowserGatewayTarget",
    deleteBrowserGatewayTarget = "deleteBrowserGatewayTarget",
    getBrowserGatewayTarget = "getBrowserGatewayTarget",
    listBrowserGatewayTargets = "listBrowserGatewayTargets",
    listResourcePolicies = "listResourcePolicies",
    getResourcePolicy = "getResourcePolicy",
    createResourcePolicy = "createResourcePolicy",
    updateResourcePolicy = "updateResourcePolicy",
    deleteResourcePolicy = "deleteResourcePolicy",
    listResourcePolicyRoles = "listResourcePolicyRoles",
    setResourcePolicyRoles = "setResourcePolicyRoles",
    listResourcePolicyUsers = "listResourcePolicyUsers",
    setResourcePolicyUsers = "setResourcePolicyUsers",
    setResourcePolicyPassword = "setResourcePolicyPassword",
    setResourcePolicyPincode = "setResourcePolicyPincode",
    setResourcePolicyHeaderAuth = "setResourcePolicyHeaderAuth",
    setResourcePolicyWhitelist = "setResourcePolicyWhitelist",
    setResourcePolicyRules = "setResourcePolicyRules",
    createOrgWideLauncherView = "createOrgWideLauncherView"
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
        let userOrgRoleIds = req.userOrgRoleIds;

        if (userOrgRoleIds === undefined) {
            userOrgRoleIds = await getUserOrgRoleIds(userId, req.userOrgId!);
            if (userOrgRoleIds.length === 0) {
                throw createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                );
            }
        }

        // If no direct permission, check role-based permission (any of user's roles)
        const roleActionPermission = await db
            .select()
            .from(roleActions)
            .where(
                and(
                    eq(roleActions.actionId, actionId),
                    inArray(roleActions.roleId, userOrgRoleIds),
                    eq(roleActions.orgId, req.userOrgId!)
                )
            )
            .limit(1);

        if (roleActionPermission.length > 0) {
            return true;
        }

        // Check if the user has direct permission for the action in the current org
        const userActionPermission = await db
            .select()
            .from(userActions)
            .where(
                and(
                    eq(userActions.userId, userId),
                    eq(userActions.actionId, actionId),
                    eq(userActions.orgId, req.userOrgId!)
                )
            )
            .limit(1);

        if (userActionPermission.length > 0) {
            return true;
        }

        return false;
    } catch (error) {
        console.error("Error checking user action permission:", error);
        throw createHttpError(
            HttpCode.INTERNAL_SERVER_ERROR,
            "Error checking action permission"
        );
    }
}
