import { sendTelegramMessage } from "../telegram.js";
import {
  callLLM,
  tavilySearch,
  getStockQuote,
  getGoldSpot,
  getParisWeather,
  parisDateInfo
} from "../digest_utils.js";

async function run() {
  const { date } = parisDateInfo();
  const dateStr = date.toISOString().slice(0, 10);

  const [nvda, amd, vst, gold, goldNews, macro, fr, cn, world, ai, paris, weather] =
    await Promise.all([
      getStockQuote("NVDA"),
      getStockQuote("AMD"),
      getStockQuote("VST"),
      getGoldSpot(),
      tavilySearch("site:finance.yahoo.com gold price XAUUSD today", { max_results: 4 }),
      tavilySearch("macro economy and geopolitics market impact today", { max_results: 6 }),
      tavilySearch("France top news today", { max_results: 6 }),
      tavilySearch("China top news today", { max_results: 6 }),
      tavilySearch("world top news today", { max_results: 6 }),
      tavilySearch("AI art business renewable energy EV top news today", { max_results: 6 }),
      tavilySearch("site:quefaire.paris.fr Paris exhibitions events today", { max_results: 6 }),
      getParisWeather()
    ]);

  const system = [
    "You are a world-class news editor.",
    "Write in a style blending The Economist and The New Yorker: sharp, elegant, slightly witty but easy to read.",
    "Use emoji to label each section like a newspaper.",
    "Always mention the release date of sources when citing.",
    "Keep it brief, actionable, and avoid financial advice.",
    "If data is missing, say so.",
    "Crypto is NOT needed.",
    "Gold must include daily change if available, drivers, and Yahoo Finance references."
  ].join("\n");

  const prompt = [
    `Date (Paris): ${dateStr}`,
    "",
    "Financials:",
    JSON.stringify({ nvda, amd, vst, gold, goldNews }, null, 2),
    "",
    "Macro/Geopolitics:",
    JSON.stringify(macro, null, 2),
    "",
    "France news:",
    JSON.stringify(fr, null, 2),
    "",
    "China news:",
    JSON.stringify(cn, null, 2),
    "",
    "World news:",
    JSON.stringify(world, null, 2),
    "",
    "AI/Art/Business/Renewables/EV:",
    JSON.stringify(ai, null, 2),
    "",
    "Paris events (from mairie/official sources):",
    JSON.stringify(paris, null, 2),
    "",
    "Paris weather (current + weekly):",
    JSON.stringify(weather, null, 2),
    "",
    "Output format:",
    "📈 Financials ...",
    "📰 Macro & Geo ...",
    "🇫🇷 France ...",
    "🇨🇳 China ...",
    "🗺️ World ...",
    "💹 AI/Art/Business/Renewables/EV ...",
    "🥇 Gold focus (daily change if available, drivers, risks) ...",
    "🥖 Paris events (include duration + location if available) ...",
    "🌤️ Paris weather (today + week) ..."
  ].join("\n");

  const digest = await callLLM({
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    maxTokens: 1400
  });

  await sendTelegramMessage(digest);
}

run().catch(async (e) => {
  await sendTelegramMessage(`⚠️ Daily digest failed: ${e.message || e}`);
  process.exit(1);
});
