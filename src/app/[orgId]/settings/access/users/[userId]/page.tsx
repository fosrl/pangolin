import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
    title: "User"
};

export default async function UserPage(props: {
    params: Promise<{ orgId: string; userId: string }>;
}) {
    const { orgId, userId } = await props.params;
    redirect(`/${orgId}/settings/access/users/${userId}/general`);
}
