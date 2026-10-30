import CreateRoleForm from "@app/components/CreateRoleForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Create Role"
};

type CreateRolePageProps = {
    params: Promise<{ orgId: string }>;
};

export default async function CreateRolePage(props: CreateRolePageProps) {
    const { orgId } = await props.params;

    return <CreateRoleForm orgId={orgId} />;
}
