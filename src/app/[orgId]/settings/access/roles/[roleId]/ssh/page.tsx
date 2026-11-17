import { RoleSshSettings } from "@app/components/RoleSettingsTabs";
import { pullEnv } from "@app/lib/pullEnv";
import { redirect } from "next/navigation";

type PageProps = {
    params: Promise<{ orgId: string; roleId: string }>;
};

export default async function Page(props: PageProps) {
    const { orgId, roleId } = await props.params;
    if (pullEnv().flags.disableEnterpriseFeatures) {
        redirect(`/${orgId}/settings/access/roles/${roleId}/general`);
    }
    return <RoleSshSettings />;
}
