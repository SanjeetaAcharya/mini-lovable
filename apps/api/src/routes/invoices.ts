import { Router } from "express";
import { renderInvoiceHtml } from "../services/invoice.service";

const router = Router();

// No auth yet — hardcoded to the one seeded demo user.
const DEMO_USER_ID = process.env.DEMO_USER_ID!;

router.get("/invoices/:id", async (req, res) => {
  const html = await renderInvoiceHtml(req.params.id, DEMO_USER_ID);
  if (!html) {
    res.status(404).send("Invoice not found");
    return;
  }
  res.type("html").send(html);
});

export default router;
