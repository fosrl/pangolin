import { Router } from "express";
import * as gerbil from "@server/routers/gerbil";
import * as traefik from "@server/routers/traefik";
import * as resource from "./resource";
import * as badger from "./badger";
import * as auth from "@server/routers/auth";
import * as supporterKey from "@server/routers/supporterKey";
import * as idp from "@server/routers/idp";
import * as newt from "./newt";
import * as olm from "./olm";
import HttpCode from "@server/types/HttpCode";
import {
    verifyResourceAccess,
    verifySessionUserMiddleware
} from "@server/middlewares";

// Root routes
export const internalRouter = Router();

internalRouter.get("/", (_, res) => {
    res.status(HttpCode.OK).json({ message: "Healthy" });
});

internalRouter.get("/traefik-config", traefik.traefikConfigProvider);

internalRouter.get(
    "/resource-session/:resourceId/:token",
    auth.checkResourceSession
);

internalRouter.post(
    `/resource/:resourceId/get-exchange-token`,
    verifySessionUserMiddleware,
    verifyResourceAccess,
    resource.getExchangeToken
);

internalRouter.get(
    `/supporter-key/visible`,
    supporterKey.isSupporterKeyVisible
);

internalRouter.get("/idp", idp.listIdps);

internalRouter.get("/idp/:idpId", idp.getIdp);

// Auth endpoints for Newt/OLM to get tokens (needed for WebSocket connection)
const authRouter = Router();
internalRouter.use("/auth", authRouter);

authRouter.post("/newt/get-token", newt.getNewtToken);
authRouter.post("/olm/get-token", olm.getOlmToken);

// Gerbil routes
const gerbilRouter = Router();
internalRouter.use("/gerbil", gerbilRouter);

// Use local gerbil endpoints
gerbilRouter.post("/receive-bandwidth", gerbil.receiveBandwidth);
gerbilRouter.post("/update-hole-punch", gerbil.updateHolePunch);
gerbilRouter.post("/get-all-relays", gerbil.getAllRelays);
gerbilRouter.post("/get-resolved-hostname", gerbil.getResolvedHostname);

// WE HANDLE THE PROXY INSIDE OF THIS FUNCTION
// SO IT REGISTERS THE EXIT NODE LOCALLY AS WELL
gerbilRouter.post("/get-config", gerbil.getConfig);

// Badger routes
const badgerRouter = Router();
internalRouter.use("/badger", badgerRouter);

badgerRouter.post("/verify-session", badger.verifyResourceSession);

badgerRouter.post("/exchange-session", badger.exchangeSession);
