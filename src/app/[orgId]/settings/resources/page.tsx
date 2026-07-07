import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Public Resources"
};

export interface ResourcesPageProps {
    params: Promise<{ orgId: string }>;
}

export default async function ResourcesPage(props: ResourcesPageProps) {
    const params = await props.params;
    redirect(`/${params.orgId}/settings/resources/public`);
}
