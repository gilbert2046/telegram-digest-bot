import { fetchNews } from "./fetchNews.js";
import { summarizeNews } from "./summarize.js";
import { sendTelegramMessage } from "./telegram.js";

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
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
