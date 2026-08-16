import { prisma } from "../lib/prisma";

/**
 * Renders a purchase's invoice as plain, legible HTML — hosted HTML
 * rather than a PDF, per the plan: what's being evaluated is the content
 * (item, amount, date, invoice number), not the file format. Returns null
 * if the invoice doesn't exist or doesn't belong to this user, so the
 * route can 404 either way without distinguishing the two.
 */
export async function renderInvoiceHtml(invoiceId: string, userId: string): Promise<string | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, purchase: { userId } },
    include: { purchase: true },
  });
  if (!invoice) return null;

  const amount = (invoice.amountCents / 100).toFixed(2);
  const date = invoice.issuedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const item = `${invoice.purchase.tokensPurchased.toLocaleString()} tokens`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${invoice.invoiceNumber}</title>
<style>
  /* Same palette as the app (apps/web/src/index.css) so an invoice opened
     from the billing table doesn't flash white. Kept deliberately plain:
     the invoice is a record, not a screen to design. */
  :root { color-scheme: dark; }
  body {
    font-family: system-ui, "Segoe UI", Roboto, sans-serif;
    max-width: 40rem; margin: 0 auto; padding: 3rem 1rem;
    background: #0a0a0b; color: #f2f0ed;
    -webkit-font-smoothing: antialiased;
  }
  h1 { font-size: 1.25rem; margin: 0 0 0.35rem; font-weight: 600; }
  .meta { color: #b4b1ac; margin-bottom: 2.5rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.875rem; }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; padding: 0.5rem 0; border-bottom: 1px solid #26262b;
    font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: #b4b1ac;
  }
  td { text-align: left; padding: 0.75rem 0; border-bottom: 1px solid #18181b; }
  td.amount { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; }
  th.amount { text-align: right; }
  tfoot td { font-weight: 600; border-bottom: none; padding-top: 1rem; }
</style>
</head>
<body>
  <h1>Invoice ${invoice.invoiceNumber}</h1>
  <p class="meta">Issued ${date}</p>
  <table>
    <thead><tr><th>Item</th><th class="amount">Amount</th></tr></thead>
    <tbody><tr><td>${item}</td><td class="amount">$${amount}</td></tr></tbody>
    <tfoot><tr><td>Total</td><td class="amount">$${amount}</td></tr></tfoot>
  </table>
</body>
</html>`;
}
