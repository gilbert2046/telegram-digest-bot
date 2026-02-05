import { fetchNews } from "./fetchNews.js";
import { summarizeNews } from "./summarize.js";
import { sendTelegramMessage } from "./telegram.js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

async function main() {
  const news = await fetchNews({ hours: 24, limit: 6 });

  if (!news.length) {
    console.log("No news items found.");
    await sendTelegramMessage("No data source available.");
    return;
  }

  console.log(`Fetched ${news.length} items. Summarizing...`);
  const digest = await summarizeNews(news);

  if (!digest) {
    console.log("No digest produced.");
    await sendTelegramMessage("No data source available.");
    return;
  }

  console.log("Sending to Telegram...");
  await sendTelegramMessage(digest);
  console.log("Done.");

  const line = `${new Date().toISOString()} OK items=${news.length}\n`;
  fs.appendFileSync("digest.log", line);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  const line = `${new Date().toISOString()} ERROR ${e.message || e}\n`;
  try { fs.appendFileSync("digest.log", line); } catch {}
  process.exit(1);
});
