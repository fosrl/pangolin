"use client";

import { CheckboxWithLabel } from "@app/components/ui/checkbox";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { useTranslations } from "next-intl";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { build } from "@server/build";

type PermissionsSelectBoxProps = {
    root?: boolean;
    selectedPermissions: Record<string, boolean>;
    onChange: (updated: Record<string, boolean>) => void;
};

function getActionsCategories(root: boolean) {
    const t = useTranslations();
    const { env } = useEnvContext();

    const actionsByCategory: Record<string, Record<string, string>> = {
        Organization: {
            [t("actionGetOrg")]: "getOrg",
            [t("actionUpdateOrg")]: "updateOrg",
            [t("actionGetOrgUser")]: "getOrgUser",
            [t("actionInviteUser")]: "inviteUser",
            [t("actionRemoveInvitation")]: "removeInvitation",
            [t("actionListInvitations")]: "listInvitations",
            [t("actionRemoveUser")]: "removeUser",
            [t("actionListUsers")]: "listUsers",
            [t("actionListOrgDomains")]: "listOrgDomains",
            [t("updateOrgUser")]: "updateOrgUser",
            [t("createOrgUser")]: "createOrgUser",
            [t("actionApplyBlueprint")]: "applyBlueprint",
            [t("actionListBlueprints")]: "listBlueprints",
            [t("actionGetBlueprint")]: "getBlueprint"
        },

        Site: {
            [t("actionCreateSite")]: "createSite",
            [t("actionDeleteSite")]: "deleteSite",
            [t("actionGetSite")]: "getSite",
            [t("actionListSites")]: "listSites",
            [t("actionUpdateSite")]: "updateSite",
            [t("actionListSiteRoles")]: "listSiteRoles"
        },

        Resource: {
            [t("actionCreateResource")]: "createResource",
            [t("actionDeleteResource")]: "deleteResource",
            [t("actionGetResource")]: "getResource",
            [t("actionListResource")]: "listResources",
            [t("actionUpdateResource")]: "updateResource",
            [t("actionListResourceUsers")]: "listResourceUsers",
            [t("actionSetResourceUsers")]: "setResourceUsers",
            [t("actionSetAllowedResourceRoles")]: "setResourceRoles",
            [t("actionListAllowedResourceRoles")]: "listResourceRoles",
            [t("actionSetResourcePassword")]: "setResourcePassword",
            [t("actionSetResourcePincode")]: "setResourcePincode",
            [t("actionSetResourceHeaderAuth")]: "setResourceHeaderAuth",
            [t("actionSetResourceEmailWhitelist")]: "setResourceWhitelist",
            [t("actionGetResourceEmailWhitelist")]: "getResourceWhitelist",
            [t("actionCreateSiteResource")]: "createSiteResource",
            [t("actionDeleteSiteResource")]: "deleteSiteResource",
            [t("actionGetSiteResource")]: "getSiteResource",
            [t("actionListSiteResources")]: "listSiteResources",
            [t("actionUpdateSiteResource")]: "updateSiteResource"
        },

        Target: {
            [t("actionCreateTarget")]: "createTarget",
            [t("actionDeleteTarget")]: "deleteTarget",
            [t("actionGetTarget")]: "getTarget",
            [t("actionListTargets")]: "listTargets",
            [t("actionUpdateTarget")]: "updateTarget"
        },

        Role: {
            [t("actionCreateRole")]: "createRole",
            [t("actionDeleteRole")]: "deleteRole",
            [t("actionGetRole")]: "getRole",
            [t("actionListRole")]: "listRoles",
            [t("actionUpdateRole")]: "updateRole",
            [t("actionListAllowedRoleResources")]: "listRoleResources",
            [t("actionAddUserRole")]: "addUserRole"
        },
        "Access Token": {
            [t("actionGenerateAccessToken")]: "generateAccessToken",
            [t("actionDeleteAccessToken")]: "deleteAcessToken",
            [t("actionListAccessTokens")]: "listAccessTokens"
        },

        "Resource Rule": {
            [t("actionCreateResourceRule")]: "createResourceRule",
            [t("actionDeleteResourceRule")]: "deleteResourceRule",
            [t("actionListResourceRules")]: "listResourceRules",
            [t("actionUpdateResourceRule")]: "updateResourceRule"
        },

        Client: {
            [t("actionCreateClient")]: "createClient",
            [t("actionDeleteClient")]: "deleteClient",
            [t("actionUpdateClient")]: "updateClient",
            [t("actionListClients")]: "listClients",
            [t("actionGetClient")]: "getClient"
        },

        Logs: {
            [t("actionExportLogs")]: "exportLogs",
            [t("actionViewLogs")]: "viewLogs"
        }
    };

    if (root) {
        actionsByCategory["Organization"] = {
            [t("actionListOrgs")]: "listOrgs",
            [t("actionCheckOrgId")]: "checkOrgId",
            [t("actionCreateOrg")]: "createOrg",
            [t("actionDeleteOrg")]: "deleteOrg",
            [t("actionListApiKeys")]: "listApiKeys",
            [t("actionListApiKeyActions")]: "listApiKeyActions",
            [t("actionSetApiKeyActions")]: "setApiKeyActions",
            [t("actionCreateApiKey")]: "createApiKey",
            [t("actionDeleteApiKey")]: "deleteApiKey",
            ...actionsByCategory["Organization"]
        };

        actionsByCategory["Identity Provider (IDP)"] = {
            [t("actionCreateIdp")]: "createIdp",
            [t("actionUpdateIdp")]: "updateIdp",
            [t("actionDeleteIdp")]: "deleteIdp",
            [t("actionListIdps")]: "listIdps",
            [t("actionGetIdp")]: "getIdp",
            [t("actionCreateIdpOrg")]: "createIdpOrg",
            [t("actionDeleteIdpOrg")]: "deleteIdpOrg",
            [t("actionListIdpOrgs")]: "listIdpOrgs",
            [t("actionUpdateIdpOrg")]: "updateIdpOrg"
        };

        actionsByCategory["User"] = {
            [t("actionUpdateUser")]: "updateUser",
            [t("actionGetUser")]: "getUser"
        };

        if (build == "saas") {
            actionsByCategory["SAAS"] = {
                ["Send Usage Notification Email"]: "sendUsageNotification"
            };
        }
    }

    return actionsByCategory;
}

export default function PermissionsSelectBox({
    root,
    selectedPermissions,
    onChange
}: PermissionsSelectBoxProps) {
    const actionsByCategory = getActionsCategories(root ?? false);

    const togglePermission = (key: string, checked: boolean) => {
        onChange({
            ...selectedPermissions,
            [key]: checked
        });
    };

    const areAllCheckedInCategory = (actions: Record<string, string>) => {
        return Object.values(actions).every(
            (action) => selectedPermissions[action]
        );
    };

    const toggleAllInCategory = (
        actions: Record<string, string>,
        value: boolean
    ) => {
        const updated = { ...selectedPermissions };
        Object.values(actions).forEach((action) => {
            updated[action] = value;
        });
        onChange(updated);
    };

    const allActions = Object.values(actionsByCategory).flatMap(Object.values);
    const allPermissionsChecked = allActions.every(
        (action) => selectedPermissions[action]
    );

    const toggleAllPermissions = (checked: boolean) => {
        const updated: Record<string, boolean> = {};
        allActions.forEach((action) => {
            updated[action] = checked;
        });
        onChange(updated);
    };

    const t = useTranslations();

    return (
        <>
            <div className="mb-4">
                <CheckboxWithLabel
                    variant="outlinePrimarySquare"
                    id="toggle-all-permissions"
                    label={t("permissionsAllowAll")}
                    checked={allPermissionsChecked}
                    onCheckedChange={(checked) =>
                        toggleAllPermissions(checked as boolean)
                    }
                />
            </div>
            <InfoSections cols={5}>
                {Object.entries(actionsByCategory).map(
                    ([category, actions]) => {
                        const allChecked = areAllCheckedInCategory(actions);
                        return (
                            <InfoSection key={category}>
                                <InfoSectionTitle>{category}</InfoSectionTitle>
                                <InfoSectionContent>
                                    <div className="space-y-2">
                                        <CheckboxWithLabel
                                            variant="outlinePrimarySquare"
                                            id={`toggle-all-${category}`}
                                            label={t("allowAll")}
                                            checked={allChecked}
                                            onCheckedChange={(checked) =>
                                                toggleAllInCategory(
                                                    actions,
                                                    checked as boolean
                                                )
                                            }
                                        />
                                        {Object.entries(actions).map(
                                            ([label, value]) => (
                                                <CheckboxWithLabel
                                                    variant="outlineSquare"
                                                    key={value}
                                                    id={value}
                                                    label={label}
                                                    checked={
                                                        !!selectedPermissions[
                                                            value
                                                        ]
                                                    }
                                                    onCheckedChange={(
                                                        checked
                                                    ) =>
                                                        togglePermission(
                                                            value,
                                                            checked as boolean
                                                        )
                                                    }
                                                />
                                            )
                                        )}
                                    </div>
                                </InfoSectionContent>
                            </InfoSection>
                        );
                    }
                )}
            </InfoSections>
        </>
    );
}
