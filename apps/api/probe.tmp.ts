import "dotenv/config";
process.env.OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "poolside/laguna-s-2.1:free";
import { generateSite } from "./src/services/llm.service";
const orig = console.error; console.error = () => {}; console.log = () => {};
(async () => {
  for (let i = 1; i <= 3; i++) {
    const r = await generateSite("a detailed multi-section marketing site for an architecture studio with a project gallery, team bios, and contact form", `tail-${i}`);
    if (r.status === "invalid_output") {
      orig(`run ${i}: FAIL finish=${r.finishReason} completion=${r.usage.completionTokens} chars=${r.rawContent.length}`);
      orig(`  TAIL: ${JSON.stringify(r.rawContent.slice(-220))}`);
    } else orig(`run ${i}: ${r.status}`);
  }
})();
