import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Private Resource"
};

export default async function PrivateResourcePage(props: {
    params: Promise<{ niceId: string; orgId: string }>;
}) {
    const params = await props.params;
    redirect(
        `/${params.orgId}/settings/resources/private/${params.niceId}/general`
    );
}
