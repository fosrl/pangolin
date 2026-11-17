import { redirect } from "next/navigation";

type RolePageProps = {
    params: Promise<{ orgId: string; roleId: string }>;
};

export default async function RolePage(props: RolePageProps) {
    const { orgId, roleId } = await props.params;
    redirect(`/${orgId}/settings/access/roles/${roleId}/general`);
}
