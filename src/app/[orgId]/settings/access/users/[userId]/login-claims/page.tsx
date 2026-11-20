import OrgUserLoginClaims from "@app/components/idp/OrgUserLoginClaims";

export default async function OrgUserLoginClaimsPage(props: {
    params: Promise<{ orgId: string; userId: string }>;
}) {
    const { orgId, userId } = await props.params;
    return <OrgUserLoginClaims orgId={orgId} userId={userId} />;
}
