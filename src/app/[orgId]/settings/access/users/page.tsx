import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import type { ListOrgIdpsResponse } from "@server/routers/orgIdp/types";
import type { ListRolesResponse } from "@server/routers/role/listRoles";
import { ListUsersResponse } from "@server/routers/user";
import UsersTable, { UserRow } from "@app/components/UsersTable";
import { GetOrgResponse } from "@server/routers/org";
import { cache } from "react";
import OrgProvider from "@app/providers/OrgProvider";
import UserProvider from "@app/providers/UserProvider";
import { verifySession } from "@app/lib/auth/verifySession";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Users"
};

type UsersPageProps = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export const dynamic = "force-dynamic";

export default async function UsersPage(props: UsersPageProps) {
    const params = await props.params;
    const searchParams = new URLSearchParams(await props.searchParams);

    const user = await verifySession();

    let users: ListUsersResponse["users"] = [];
    let pagination: ListUsersResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };
    let hasInvitations = false;

    const cookieHeader = await authCookieHeader();

    const [usersRes, idpsRes, rolesRes] = await Promise.all([
        internal
            .get(
                `/org/${params.orgId}/users?${searchParams.toString()}`,
                cookieHeader
            )
            .catch(() => {}),
        internal
            .get(`/org/${params.orgId}/idp?limit=500&offset=0`, cookieHeader)
            .catch(() => {}),
        internal
            .get(`/org/${params.orgId}/roles?pageSize=500&page=1`, cookieHeader)
            .catch(() => {})
    ]);

    if (usersRes && usersRes.status === 200) {
        const list = usersRes.data.data as ListUsersResponse;
        users = list.users;
        pagination = list.pagination;
    }

    const t = await getTranslations();

    const orgIdps =
        idpsRes && idpsRes.status === 200 ? (idpsRes.data.data.idps ?? []) : [];
    const idpFilterOptions = [
        { value: "internal", label: t("idpNameInternal") },
        ...orgIdps.map((i: ListOrgIdpsResponse["idps"][number]) => ({
            value: String(i.idpId),
            label: i.name
        }))
    ];

    const orgRoles =
        rolesRes && rolesRes.status === 200
            ? (rolesRes.data.data.roles ?? [])
            : [];
    const roleFilterOptions = [
        { value: "owner", label: t("accessRoleOwner") },
        ...orgRoles.map((r: ListRolesResponse["roles"][number]) => ({
            value: String(r.roleId),
            label: r.name
        }))
    ];

    const invitationsRes = await internal
        .get(
            `/org/${params.orgId}/invitations?limit=1&offset=0`,
            await authCookieHeader()
        )
        .catch((e) => {});

    if (invitationsRes && invitationsRes.status === 200) {
        hasInvitations = invitationsRes.data.data.pagination.total > 0;
    }

    let org: GetOrgResponse | null = null;
    const getOrg = cache(async () =>
        internal
            .get(`/org/${params.orgId}`, await authCookieHeader())
            .catch((e) => {
                console.error(e);
            })
    );
    const orgRes = await getOrg();

    if (orgRes && orgRes.status === 200) {
        org = orgRes.data.data;
    }

    const userRows: UserRow[] = users.map((user) => {
        return {
            id: user.id,
            username: user.username,
            displayUsername: getUserDisplayName({
                email: user.email,
                name: user.name,
                username: user.username
            }),
            name: user.name,
            email: user.email,
            type: user.type,
            idpVariant: user.idpVariant,
            idpId: user.idpId,
            idpName: user.idpName || t("idpNameInternal"),
            status: t("userConfirmed"),
            roleLabels: (() => {
                const names = (user.roles ?? [])
                    .map((r) => r.roleName)
                    .filter((n): n is string => Boolean(n?.length));
                return names.length ? names : [t("accessRoleMember")];
            })(),
            isOwner: user.isOwner || false
        };
    });

    return (
        <>
            <SettingsSectionTitle
                title={t("accessUsersManage")}
                description={t("accessUsersDescription")}
            />
            <UserProvider user={user!}>
                <OrgProvider org={org}>
                    <UsersTable
                        users={userRows}
                        rowCount={pagination.total}
                        pagination={{
                            pageIndex: pagination.page - 1,
                            pageSize: pagination.pageSize
                        }}
                        idpFilterOptions={idpFilterOptions}
                        roleFilterOptions={roleFilterOptions}
                    />
                </OrgProvider>
            </UserProvider>
        </>
    );
}
