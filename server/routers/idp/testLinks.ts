import { db, idp, idpOidcConfig, users } from "@server/db";
import config from "@server/lib/config";
import {
    buildOidcAuthorizationUrl,
    OIDC_STATE_COOKIE_NAME,
    OIDC_STATE_TTL_MS
} from "@server/lib/idp/buildOidcAuthorizationUrl";
import { generateOidcRedirectUrl } from "@server/lib/idp/generateRedirectUrl";
import type { OidcTestResult } from "@server/lib/idp/previewIdpLogin";
import {
    createTestLink,
    deleteTestLink,
    findTestLinkByToken,
    getLatestCompletedTestLink,
    getScopedTestLink,
    listTestLinks,
    testLinkStatus,
    type TestLinkStatus,
    type TestLinkSummary
} from "@server/lib/idp/testLinks";
import response from "@server/lib/response";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { and, eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

/**
 * Shareable test links. Admin routes exist for global IdPs (`/idp/:idpId/...`,
 * server admins) and org IdPs (`/org/:orgId/idp/:idpId/...`, org admins). An
 * org route only sees its org's links, a global route only the global ones.
 */

const adminParamsSchema = z
    .object({
        idpId: z.coerce.number<number>(),
        // set by the org routes, after their middlewares checked access
        orgId: z.string().optional(),
        linkId: z.string().optional()
    })
    .strict();

const publicParamsSchema = z
    .object({
        idpId: z.coerce.number<number>(),
        token: z.string().min(1)
    })
    .strict();

const createBodySchema = z.strictObject({
    label: z.string().trim().max(100).optional()
});

export type IdpTestLinkListItem = TestLinkSummary & {
    createdByName: string | null;
};

export type CreateIdpTestLinkResponse = {
    linkId: string;
    /** Only returned here: the token isn't stored. */
    url: string;
    expiresAt: number;
};

export type ListIdpTestLinksResponse = {
    links: IdpTestLinkListItem[];
};

export type GetIdpTestLinkResponse = {
    linkId: string;
    label: string | null;
    status: TestLinkStatus;
    completedAt: number | null;
    result: OidcTestResult | null;
};

export type GetIdpTestLinkInfoResponse = {
    idpName: string;
    status: TestLinkStatus;
    expiresAt: number;
    requestedBy: string | null;
};

export type GenerateIdpTestLinkUrlResponse = {
    redirectUrl: string;
};

function badParams(next: NextFunction, error: z.ZodError) {
    return next(
        createHttpError(HttpCode.BAD_REQUEST, fromError(error).toString())
    );
}

async function idpExists(idpId: number): Promise<boolean> {
    const [row] = await db
        .select({ idpId: idp.idpId })
        .from(idp)
        .where(and(eq(idp.idpId, idpId), eq(idp.type, "oidc")))
        .limit(1);
    return !!row;
}

export async function createIdpTestLink(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const params = adminParamsSchema.safeParse(req.params);
        if (!params.success) return badParams(next, params.error);
        const body = createBodySchema.safeParse(req.body);
        if (!body.success) return badParams(next, body.error);

        const { idpId, orgId } = params.data;
        if (!req.user) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not found")
            );
        }
        if (!(await idpExists(idpId))) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Identity provider not found"
                )
            );
        }

        const { linkId, token, expiresAt } = await createTestLink({
            idpId,
            orgId: orgId ?? null,
            createdBy: req.user.userId,
            label: body.data.label || null
        });

        const url = new URL(
            `/auth/idp/${idpId}/test/${token}`,
            config.getRawConfig().app.dashboard_url!
        ).toString();

        return response<CreateIdpTestLinkResponse>(res, {
            data: { linkId, url, expiresAt },
            success: true,
            error: false,
            message: "Test link created",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

export async function listIdpTestLinks(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const params = adminParamsSchema.safeParse(req.params);
        if (!params.success) return badParams(next, params.error);
        const { idpId, orgId } = params.data;

        const links = await listTestLinks(idpId, orgId ?? null);

        return response<ListIdpTestLinksResponse>(res, {
            data: { links },
            success: true,
            error: false,
            message: "Test links retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

export async function getIdpTestLink(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const params = adminParamsSchema.safeParse(req.params);
        if (!params.success) return badParams(next, params.error);
        const { idpId, orgId, linkId } = params.data;

        const found = linkId
            ? await getScopedTestLink(linkId, idpId, orgId ?? null)
            : null;
        if (!found) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Test link not found")
            );
        }

        return response<GetIdpTestLinkResponse>(res, {
            data: {
                linkId: found.link.linkId,
                label: found.link.label,
                status: testLinkStatus(found.link),
                completedAt: found.link.completedAt,
                result: found.result
            },
            success: true,
            error: false,
            message: "Test link retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

export type GetLatestIdpTestResultResponse = GetIdpTestLinkResponse | null;

/** The result of the most recently completed link, to prefill the mapping playground. */
export async function getLatestIdpTestResult(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const params = adminParamsSchema.safeParse(req.params);
        if (!params.success) return badParams(next, params.error);
        const { idpId, orgId } = params.data;

        const found = await getLatestCompletedTestLink(idpId, orgId ?? null);

        return response<GetLatestIdpTestResultResponse>(res, {
            data: found
                ? {
                      linkId: found.link.linkId,
                      label: found.link.label,
                      status: testLinkStatus(found.link),
                      completedAt: found.link.completedAt,
                      result: found.result
                  }
                : null,
            success: true,
            error: false,
            message: "Latest test result retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

export async function deleteIdpTestLink(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const params = adminParamsSchema.safeParse(req.params);
        if (!params.success) return badParams(next, params.error);
        const { idpId, orgId, linkId } = params.data;

        if (!linkId || !(await deleteTestLink(linkId, idpId, orgId ?? null))) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Test link not found")
            );
        }

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Test link deleted",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

/** Public: what the page behind a test link shows before signing in. */
export async function getIdpTestLinkInfo(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const params = publicParamsSchema.safeParse(req.params);
        if (!params.success) return badParams(next, params.error);
        const { idpId, token } = params.data;

        const link = await findTestLinkByToken(idpId, token);
        if (!link) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Test link not found")
            );
        }

        const [row] = await db
            .select({ idpName: idp.name })
            .from(idp)
            .where(eq(idp.idpId, idpId))
            .limit(1);
        const [creator] = link.createdBy
            ? await db
                  .select({
                      name: users.name,
                      email: users.email,
                      username: users.username
                  })
                  .from(users)
                  .where(eq(users.userId, link.createdBy))
                  .limit(1)
            : [];

        return response<GetIdpTestLinkInfoResponse>(res, {
            data: {
                idpName: row?.idpName ?? "",
                status: testLinkStatus(link),
                expiresAt: link.expiresAt,
                requestedBy:
                    creator?.name ?? creator?.email ?? creator?.username ?? null
            },
            success: true,
            error: false,
            message: "Test link retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

/** Public: starts the test login of a link (no Pangolin session needed). */
export async function generateIdpTestLinkUrl(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const params = publicParamsSchema.safeParse(req.params);
        if (!params.success) return badParams(next, params.error);
        const { idpId, token } = params.data;

        const link = await findTestLinkByToken(idpId, token);
        if (!link || testLinkStatus(link) !== "pending") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This test link has expired or was already used. Ask your administrator for a new one."
                )
            );
        }

        const [existingIdp] = await db
            .select()
            .from(idp)
            .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
            .where(and(eq(idp.type, "oidc"), eq(idp.idpId, idpId)));
        if (!existingIdp) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Identity provider not found"
                )
            );
        }

        const { url, stateJwt } = buildOidcAuthorizationUrl({
            existingIdp,
            redirectUrl: await generateOidcRedirectUrl(idpId),
            postAuthRedirectUrl: `/auth/idp/${idpId}/test/${token}`,
            test: { linkId: link.linkId },
            // Google: let them pick the right account. Not prompt=login: some IdPs (e.g.
            // Authentik) loop back to the login form instead of redirecting
            prompt:
                existingIdp.idpOidcConfig.variant === "google"
                    ? "select_account"
                    : undefined
        });

        res.cookie(OIDC_STATE_COOKIE_NAME, stateJwt, {
            path: "/",
            httpOnly: true,
            secure: req.protocol === "https",
            expires: new Date(Date.now() + OIDC_STATE_TTL_MS),
            sameSite: "lax"
        });

        return response<GenerateIdpTestLinkUrlResponse>(res, {
            data: { redirectUrl: url.toString() },
            success: true,
            error: false,
            message: "Test login URL generated",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
