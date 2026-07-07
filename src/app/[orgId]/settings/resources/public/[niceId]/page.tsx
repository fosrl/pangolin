import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "Public Resource"
};

export default async function ResourcePage(props: {
    params: Promise<{ niceId: string; orgId: string }>;
}) {
    const params = await props.params;
    redirect(
        `/${params.orgId}/settings/resources/public/${params.niceId}/general`
    );
}
