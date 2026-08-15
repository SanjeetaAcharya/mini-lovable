import express from "express";
import cors from "cors";
import "dotenv/config";
import balanceRouter from "./routes/balance";
import checkoutRouter from "./routes/checkout";
import webhookRouter from "./routes/webhook";
import generateRouter from "./routes/generate";
import deployRouter from "./routes/deploy";
import invoicesRouter from "./routes/invoices";
import historyRouter from "./routes/history";
import ledgerRouter from "./routes/ledger";
import { errorHandler } from "./middleware/errorHandler";

// Last-resort backstop for a rejection that somehow escapes Express's
// request/response cycle entirely — nothing in this app currently does
// that, since every route is wrapped in asyncHandler below, but this
// keeps a future oversight from taking the whole process down instead of
// just logging it. The real fix for route-level errors is
// asyncHandler + errorHandler; this is a net under that, not a
// replacement for it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (process kept alive):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (process kept alive):", err);
});

// Same env var stripe.service.ts uses for the Checkout success/cancel
// redirect — one source of truth for "where the frontend lives."
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_URL }));

// Mounted before express.json() — the webhook route needs the raw body for
// Stripe signature verification and parses it itself.
app.use("/api", webhookRouter);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", balanceRouter);
app.use("/api", checkoutRouter);
app.use("/api", generateRouter);
app.use("/api", deployRouter);
app.use("/api", invoicesRouter);
app.use("/api", historyRouter);
app.use("/api", ledgerRouter);

// Mounted after every route — Express recognizes error-handling
// middleware by its four-argument signature.
app.use(errorHandler);

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});