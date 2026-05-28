import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import chatsRouter from "./chats";
import memoryRouter from "./memory";
import modelsRouter from "./models";
import baseMcpRouter from "./base-mcp";
import settingsRouter from "./settings";
import protocolsRouter from "./protocols";
import actionsRouter from "./actions";
import workflowsRouter from "./workflows";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(authRouter);
router.use(healthRouter);
router.use(chatRouter);
router.use(chatsRouter);
router.use(memoryRouter);
router.use(modelsRouter);
router.use(baseMcpRouter);
router.use(settingsRouter);
router.use(protocolsRouter);
router.use(actionsRouter);
router.use(workflowsRouter);

export default router;
