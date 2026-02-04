import Anthropic from "@anthropic-ai/sdk";

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

export async function summarizeNews(newsItems) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const client = new Anthropic({ apiKey });

  // 只保留最关键字段，避免把一坨大 JSON 喂给模型
  const slim = (newsItems || []).slice(0, 6).map(x => ({
    title: x.title,
    source: x.source,
    publishedAt: x.publishedAt,
    link: x.link
  }));

  const prompt = `
你是新闻编辑。规则：
- 只能使用下面提供的新闻条目，禁止编造。
- 选出最重要的 5 条（不足 5 条就按现有数量输出）。
- 用中文输出 Telegram digest，每条必须带链接。
- 每条控制在 2 行以内，越精炼越好。

输出格式：
# 🗞️ Daily Digest（过去24小时）
1) **标题**（来源｜日期）
- 为什么重要：...
- 链接：...

新闻条目：
${JSON.stringify(slim, null, 2)}
`;

  const model = "claude-3-haiku-20240307";

  let lastErr;
  for (let attempt=1; attempt<=5; attempt++){
    try{
      const msg = await client.messages.create({
        model,
        max_tokens: 700,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt.trim() }]
      });
      return msg.content[0].text.trim();
    } catch(e){
      lastErr = e;
      const status = e?.status || e?.statusCode;
      if(status === 429){
        const waitMs = 1000 * Math.pow(2, attempt); // 2s,4s,8s...
        console.log(`429 rate limit. Retry ${attempt}/5 in ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
