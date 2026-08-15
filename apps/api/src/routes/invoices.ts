import { Router } from "express";
import { renderInvoiceHtml } from "../services/invoice.service";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.get(
  "/invoices/:id",
  asyncHandler(async (req, res) => {
    // @types/express is pinned to v5 (runtime is Express 4), whose types
    // widen route params to `string | string[]` to account for wildcard
    // segments. `:id` is a named segment, never an array at runtime.
    const id = req.params.id as string;
    const html = await renderInvoiceHtml(id, DEMO_USER_ID);
    if (!html) {
      res.status(404).send("Invoice not found");
      return;
    }
    res.type("html").send(html);
  })
);

export default router;
