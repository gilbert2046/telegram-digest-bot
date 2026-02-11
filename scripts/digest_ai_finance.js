import { sendTelegramMessage } from "../telegram.js";
import { callLLM, tavilySearch, getStockQuote, getGoldSpot } from "../digest_utils.js";

async function run() {
  const [nvda, amd, vst, gold, goldNews, ai, macro, markets] = await Promise.all([
    getStockQuote("NVDA"),
    getStockQuote("AMD"),
    getStockQuote("VST"),
    getGoldSpot(),
    tavilySearch("site:finance.yahoo.com gold price XAUUSD today", { max_results: 4 }),
    tavilySearch("AI business funding product launches today", { max_results: 6 }),
    tavilySearch("macro economy market impact today", { max_results: 6 }),
    tavilySearch("trending stocks market news today", { max_results: 6 })
  ]);

  const system = [
    "You are a crisp financial analyst.",
    "Write short, actionable headlines and bullets.",
    "No direct investment advice.",
    "Gold focus is required: daily change if available, drivers, Yahoo Finance references."
  ].join("\n");

  const prompt = [
    "Financial snapshot:",
    JSON.stringify({ nvda, amd, vst, gold, goldNews }, null, 2),
    "",
    "AI business news:",
    JSON.stringify(ai, null, 2),
    "",
    "Macro context:",
    JSON.stringify(macro, null, 2),
    "",
    "Trending stocks/news:",
    JSON.stringify(markets, null, 2)
  ].join("\n");

  const digest = await callLLM({
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens: 900
  });

  await sendTelegramMessage(digest);
}

run().catch(async (e) => {
  await sendTelegramMessage(`⚠️ AI/Finance digest failed: ${e.message || e}`);
  process.exit(1);
});
