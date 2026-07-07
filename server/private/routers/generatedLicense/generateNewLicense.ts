/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { response as sendResponse } from "@server/lib/response";
import { getFirstString } from "@server/lib/requestParams";
import privateConfig from "#private/lib/config";
import { GenerateNewLicenseResponse } from "@server/routers/generatedLicense/types";

export interface CreateNewLicenseResponse {
    data: Data;
    success: boolean;
    error: boolean;
    message: string;
    status: number;
}

export interface Data {
    licenseKey: LicenseKey;
}

export interface LicenseKey {
    id: number;
    instanceName: any;
    instanceId: string;
    licenseKey: string;
    tier: string;
    type: string;
    quantity: number;
    quantity_2: number;
    isValid: boolean;
    updatedAt: string;
    createdAt: string;
    expiresAt: string;
    paidFor: boolean;
    orgId: string;
    metadata: string;
}

export async function createNewLicense(
    orgId: string,
    licenseData: any
): Promise<CreateNewLicenseResponse> {
    try {
        const response = await fetch(
            `${privateConfig.getRawPrivateConfig().server.fossorial_api}/api/v1/license-internal/enterprise/${orgId}/create`, // this says enterprise but it does both
            {
                method: "PUT",
                headers: {
                    "api-key":
                        privateConfig.getRawPrivateConfig().server
                            .fossorial_api_key!,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(licenseData)
            }
        );

        const data: CreateNewLicenseResponse = await response.json();

        return data;
    } catch (error) {
        console.error("Error creating new license:", error);
        throw error;
    }
}

export async function generateNewLicense(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const orgId = getFirstString(req.params.orgId);

        if (!orgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Organization ID is required"
                )
            );
        }

        logger.debug(`Generating new license for orgId: ${orgId}`);

        const licenseData = req.body;
        const apiResponse = await createNewLicense(orgId, licenseData);

        return sendResponse<GenerateNewLicenseResponse>(res, {
            data: apiResponse.data,
            success: apiResponse.success,
            error: apiResponse.error,
            message: apiResponse.message,
            status: apiResponse.status
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while generating new license"
            )
        );
    }
}
