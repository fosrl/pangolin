import { Router, type Request, type Response } from "express";
import {
    AI_CAPABILITY_DEFS,
    type AiCapability
} from "@server/lib/aiCapabilities";
import { handleAiGatewayProxy } from "@server/routers/aiGateway/pipeline";
import { handleV1Models } from "@server/routers/aiGateway";

type CapabilityHandler = (
    req: Request,
    res: Response,
    capability: AiCapability
) => Promise<any>;

// Capabilities the gateway answers itself instead of proxying upstream.
// Everything else goes through the inference pipeline.
const LOCAL_HANDLERS: Partial<Record<AiCapability, CapabilityHandler>> = {
    v1_models: handleV1Models
};

export function createAiGatewayRouter() {
    const router = Router();

    for (const def of Object.values(AI_CAPABILITY_DEFS)) {
        const capability = def.id as AiCapability;
        const handler = LOCAL_HANDLERS[capability] ?? handleAiGatewayProxy;
        for (const route of def.routes) {
            const bind = (req: Request, res: Response) =>
                handler(req, res, capability);
            if (route.method === "GET") {
                router.get(route.path, bind);
            } else {
                router.post(route.path, bind);
            }
        }
    }

    return router;
}
