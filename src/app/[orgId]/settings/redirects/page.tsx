import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
    title: "Redirects"
};

type RedirectIndexPageProps = {
    params: Promise<{ orgId: string }>;
};
export const dynamic = "force-dynamic";

export default async function ApiKeysPage(props: RedirectIndexPageProps) {
    const params = await props.params;
    const t = await getTranslations();

    return null;
}
