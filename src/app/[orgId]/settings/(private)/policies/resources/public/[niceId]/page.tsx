import { redirect } from "next/navigation";

type EditPolicyPageProps = {
    params: Promise<{ niceId: string; orgId: string }>;
};

export default async function EditPolicyPage(props: EditPolicyPageProps) {
    const params = await props.params;
    redirect(
        `/${params.orgId}/settings/policies/resources/public/${params.niceId}/general`
    );
}
