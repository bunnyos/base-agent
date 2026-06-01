import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./middleware/session";

const app: Express = express();

// Sit behind the workspace / Docker reverse proxy. Trusting X-Forwarded-*
// is what makes `req.protocol` and `req.host` reflect the public origin the
// browser actually used, which lets OAuth derive a domain-agnostic
// redirect_uri (see lib/base-mcp.getRedirectUri).
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    // Allow same-origin + cross-site preview domains; credentials needed for cookie.
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session resolution runs for every /api request. It populates
// AsyncLocalStorage with the active userId so lib/user.getCurrentUserId()
// returns the right id throughout the request.
app.use("/api", sessionMiddleware, router);

export default app;
