import EditRoleForm from "@app/components/EditRoleForm";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { Role } from "@server/db";
import { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Role"
};

export const dynamic = "force-dynamic";

type RolePageProps = {
    params: Promise<{ orgId: string; roleId: string }>;
};

export default async function RolePage(props: RolePageProps) {
    const { orgId, roleId } = await props.params;

    const res = await internal
        .get<AxiosResponse<Role>>(`/role/${roleId}`, await authCookieHeader())
        .catch(() => null);

    const role = res?.data.data;
    if (!role || role.orgId !== orgId) {
        redirect(`/${orgId}/settings/access/roles`);
    }

    return <EditRoleForm role={role} />;
}
