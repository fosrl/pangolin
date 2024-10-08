import express, { Request, Response } from "express";
import next from "next";
import { parse } from "url";
import environment from "@server/environment";
import logger from "@server/logger";
import helmet from "helmet";
import cors from "cors";
import {
    errorHandlerMiddleware,
    notFoundMiddleware,
    rateLimitMiddleware,
} from "@server/middlewares";
import internal from "@server/routers/internal";
import { authenticated, unauthenticated } from "@server/routers/external";
import cookieParser from "cookie-parser";
import { User } from "@server/db/schema";

const dev = environment.ENVIRONMENT !== "prod";

const app = next({ dev });
const handle = app.getRequestHandler();

const externalPort = environment.EXTERNAL_PORT;
const internalPort = environment.INTERNAL_PORT;

app.prepare().then(() => {    
    
    // External server
    const externalServer = express();
    externalServer.set("trust proxy", 1);

    // externalServer.use(helmet()); // Disabled because causes issues with Next.js
    externalServer.use(cors());
    externalServer.use(cookieParser());
    externalServer.use(express.json());
    externalServer.use(
        rateLimitMiddleware({
            windowMin: 1,
            max: 100,
            type: "IP_ONLY",
        }),
    );

    const prefix = `/api/v1`;
    externalServer.use(prefix, unauthenticated);
    externalServer.use(prefix, authenticated);

    externalServer.use(notFoundMiddleware)

    // We are using NEXT from here on
    externalServer.all("*", (req: Request, res: Response) => {
        const parsedUrl = parse(req.url!, true);
        handle(req, res, parsedUrl);
    });

    externalServer.listen(externalPort, (err?: any) => {
        if (err) throw err;
        logger.info(
            `Main server is running on http://localhost:${externalPort}`,
        );
    });

    externalServer.use(errorHandlerMiddleware);

    // Internal server
    const internalServer = express();

    internalServer.use(helmet());
    internalServer.use(cors());
    internalServer.use(cookieParser());
    internalServer.use(express.json());

    internalServer.use(prefix, internal);

    internalServer.listen(internalPort, (err?: any) => {
        if (err) throw err;
        logger.info(
            `Internal server is running on http://localhost:${internalPort}`,
        );
    });

    internalServer.use(notFoundMiddleware)
    internalServer.use(errorHandlerMiddleware);
});

declare global {
    namespace Express {
        interface Request {
            user?: User;
            userOrgRoleId?: number;
            userOrgId?: number;
            userOrgIds?: number[];
        }
    }
}
