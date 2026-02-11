import { sendTelegramMessage } from "../telegram.js";
import { callLLM, tavilySearch, parisDateInfo } from "../digest_utils.js";

async function run() {
  const { weekday } = parisDateInfo();
  const isFriday = weekday === 5;
  const query = isFriday
    ? "site:quefaire.paris.fr Paris weekend events exhibitions brocante"
    : "site:quefaire.paris.fr Paris today events exhibitions";

  const events = await tavilySearch(query, { max_results: 8 });

  const system = [
    "You are a Paris cultural editor.",
    "List events with dates, duration, and location if available.",
    "Keep it brief and lively."
  ].join("\n");

  const prompt = [
    `Focus: ${isFriday ? "weekend" : "today"}`,
    JSON.stringify(events, null, 2)
  ].join("\n");

  const digest = await callLLM({
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    maxTokens: 900
  });

  await sendTelegramMessage(digest);
}

run().catch(async (e) => {
  await sendTelegramMessage(`⚠️ Paris events digest failed: ${e.message || e}`);
  process.exit(1);
});
