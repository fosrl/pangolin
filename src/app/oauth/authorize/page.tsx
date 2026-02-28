import ConsentPage from "./ConsentPage";

export const dynamic = "force-dynamic";

type OauthAuthorizePageProps = {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(
    value: string | string[] | undefined
): string | undefined {
    if (Array.isArray(value)) {
        return value[0];
    }

    return value;
}

export default async function OauthAuthorizePage(
    props: OauthAuthorizePageProps
) {
    const searchParams = await props.searchParams;

    return (
        <ConsentPage
            params={{
                response_type: firstParam(searchParams.response_type),
                client_id: firstParam(searchParams.client_id),
                redirect_uri: firstParam(searchParams.redirect_uri),
                scope: firstParam(searchParams.scope),
                state: firstParam(searchParams.state),
                code_challenge: firstParam(searchParams.code_challenge),
                code_challenge_method: firstParam(
                    searchParams.code_challenge_method
                ),
                nonce: firstParam(searchParams.nonce)
            }}
        />
    );
}
