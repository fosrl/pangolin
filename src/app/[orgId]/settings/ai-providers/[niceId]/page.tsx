import { redirect } from "next/navigation";

type Props = {
    params: Promise<{ orgId: string; niceId: string }>;
};

export default async function AiProviderPage({ params }: Props) {
    const { orgId, niceId } = await params;
    redirect(`/${orgId}/settings/ai-providers/${niceId}/general`);
}
