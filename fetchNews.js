import Parser from "rss-parser";

const parser = new Parser();

const FEEDS = [
  "https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=EU+regulation+AI&hl=en-US&gl=US&ceid=US:en",
  "https://techcrunch.com/feed/",
  "https://hnrss.org/frontpage",
];

function toISODate(d) {
  try { return new Date(d).toISOString(); } catch { return null; }
}

export async function fetchNews({ hours = 24, limit = 60 } = {}) {
  const now = Date.now();
  const cutoff = now - hours * 3600 * 1000;

  const all = [];

  for (const url of FEEDS) {
    const feed = await parser.parseURL(url);
    for (const item of feed.items || []) {
      const pub = item.isoDate || item.pubDate;
      const ts = pub ? new Date(pub).getTime() : null;
      if (ts && ts < cutoff) continue;

      all.push({
        title: item.title?.trim() || "",
        link: item.link || "",
        source: feed.title || url,
        publishedAt: pub ? toISODate(pub) : null,
        snippet: (item.contentSnippet || "").slice(0, 240),
      });
    }
  }

  // 去重：按 link 优先，没有 link 用 title
  const seen = new Set();
  const deduped = [];
  for (const x of all) {
    const key = x.link || x.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(x);
  }

  // 新到旧排序
  deduped.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

  return deduped.slice(0, limit);
}

// 本地测试
if (process.argv[1].includes("fetchNews.js")) {
  const news = await fetchNews();
  console.log(JSON.stringify(news.slice(0, 10), null, 2));
  console.log(`\nFetched: ${news.length} items`);
}
