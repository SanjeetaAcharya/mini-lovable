import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
  .meta { color: #555; margin-bottom: 2rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0; border-bottom: 1px solid #ddd; }
  tfoot td { font-weight: 600; border-bottom: none; }
</style>
</head>
<body>
  <h1>Invoice ${invoice.invoiceNumber}</h1>
  <p class="meta">Issued ${date}</p>
  <table>
    <thead><tr><th>Item</th><th>Amount</th></tr></thead>
    <tbody><tr><td>${item}</td><td>$${amount}</td></tr></tbody>
    <tfoot><tr><td>Total</td><td>$${amount}</td></tr></tfoot>
  </table>
</body>
</html>`;
}
