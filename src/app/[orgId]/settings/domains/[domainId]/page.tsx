import { redirect } from "next/navigation";

export default async function DomainPage(props: {
    params: Promise<{ domainId: string; orgId: string }>;
}) {
    const { domainId, orgId } = await props.params;
    redirect(`/${orgId}/settings/domains/${domainId}/setup`);
}
