import app from "./app";
import { reconnectIfAuthorized } from "./lib/base-mcp";
import { registerAnonMcp, connectAllAnonMcps } from "./lib/mcp-anon";
import { startWorkflowScheduler } from "./lib/workflows";
import { ensureLocalUser, LOCAL_USER_ID } from "./lib/user";
import { hydrateUserSettings } from "./lib/settings";
import { runWithUser } from "./lib/request-context";
import { migrateLegacyToolNames } from "./lib/migrate-tool-names";
import { logger } from "./lib/logger";

registerAnonMcp({
  id: "morpho",
  label: "morpho",
  kind: "lending",
  url: "https://mcp.morpho.org/",
});

const rawPort = process.env["PORT"] ?? "3000";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await ensureLocalUser();
  await hydrateUserSettings(LOCAL_USER_ID);
  await migrateLegacyToolNames();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");

    void runWithUser(LOCAL_USER_ID, () =>
      reconnectIfAuthorized().catch((e) =>
        logger.warn({ err: e }, "Base MCP reconnect failed"),
      ),
    );
    void connectAllAnonMcps().catch((e) =>
      logger.warn({ err: e }, "Anon MCP connect failed"),
    );
    startWorkflowScheduler();
  });
}

start().catch((err) => {
  logger.error({ err }, "Fatal: failed to start server");
  process.exit(1);
});
