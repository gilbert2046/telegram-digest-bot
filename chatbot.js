import fs from "fs";
import path from "path";
import TelegramBot from "node-telegram-bot-api";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { toFile } from "openai";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const MEMORY_FILE = "memory.json";
const PERSONA_FILE = "persona.txt";
const TMP_DIR = path.join(process.cwd(), "tmp");

const MAX_MEMORY = Number(process.env.MAX_MEMORY || 12);
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
const PREFERRED_PROVIDER = (process.env.PREFERRED_PROVIDER || "").toLowerCase();
const ADMIN_CHAT_IDS = (process.env.ADMIN_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: { timeout: 10 }
  }
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const pm2 = execSync("pm2 status telegram-bot --no-color", { encoding: "utf8" });
    let git = "";
    try {
      git = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch (e) {
      git = "unknown";
    }

    let lastUpdate = "";
    try {
      lastUpdate = execSync("tail -n 5 ./auto-update.log", { encoding: "utf8" }).trim();
    } catch (e) {
      lastUpdate = "(no auto-update.log yet)";
    }

    let lastDigest = "";
    try {
      lastDigest = execSync("tail -n 5 ./digest.log", { encoding: "utf8" }).trim();
    } catch (e) {
      lastDigest = "(no digest.log yet)";
    }

    const envStatus = [
      `TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? "OK" : "MISSING"}`,
      `TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID ? "OK" : "MISSING"}`,
      `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "OK" : "MISSING"}`,
      `OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "OK" : "MISSING"}`
    ].join("\n");

    const text =
      `🟢 Server status OK\n` +
      `• git: ${git}\n\n` +
      `• pm2:\n${pm2}\n` +
      `• last update log:\n${lastUpdate}\n\n` +
      `• last digest log:\n${lastDigest}\n\n` +
      `• env:\n${envStatus}`;

    await bot.sendMessage(chatId, text);
    return;
  } catch (e) {
    await bot.sendMessage(chatId, `🔴 status failed: ${e.message || e}`);
    return;
  }
});

bot.onText(/\/update/, async (msg) => {
  const chatId = msg.chat.id;
  const chatKey = String(chatId);

  if (!ADMIN_CHAT_IDS.includes(chatKey)) {
    await bot.sendMessage(chatId, "⛔️ You are not authorized to run updates.");
    return;
  }

  await bot.sendMessage(chatId, "🔄 Running auto-update now...");
  try {
    execSync("bash scripts/auto_update.sh", { encoding: "utf8" });
    let tail = "";
    try {
      tail = execSync("tail -n 20 ./auto-update.log", { encoding: "utf8" }).trim();
    } catch (e) {
      tail = "(no auto-update.log yet)";
    }
    await bot.sendMessage(chatId, `✅ Update done.\\n\\n${tail}`);
  } catch (e) {
    const msgText = e?.message || e;
    await bot.sendMessage(chatId, `⚠️ Update failed: ${msgText}`);
  }
});

bot.on("polling_error", (error) => {
  const msg = String(error?.message || error);
  if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
    return;
  }
  console.log("Polling error:", msg);
});

const lastPhotoByChat = new Map(); // chatId -> { filePath, ts }
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

console.log("🤖 Telegram agent is running...");

function loadStore() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return { version: 1, chats: {} };
    const raw = fs.readFileSync(MEMORY_FILE, "utf8").trim();
    if (!raw) return { version: 1, chats: {} };
    const parsed = JSON.parse(raw);

    // Backward compatibility: array -> put into a default chat bucket
    if (Array.isArray(parsed)) {
      return { version: 1, chats: { global: { messages: parsed, tasks: [] } } };
    }

    if (!parsed.chats) parsed.chats = {};
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch (e) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ version: 1, chats: {} }, null, 2));
    return { version: 1, chats: {} };
  }
}

function saveStore(store) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2));
}

function getChatState(store, chatId) {
  const key = String(chatId);
  if (!store.chats[key]) {
    store.chats[key] = { messages: [], tasks: [] };
  }
  return store.chats[key];
}

function loadPersona() {
  if (fs.existsSync(PERSONA_FILE)) {
    return fs.readFileSync(PERSONA_FILE, "utf8");
  }

  return [
    "You are a helpful assistant for Telegram.",
    "Default language behavior:",
    "- Respond in the same language as the user when possible.",
    "- If the user mixes Chinese/English/French, respond with a natural mixed style.",
    "Style:",
    "- Be concise, structured, and practical.",
    "- Ask one clarifying question if needed.",
    "Capabilities:",
    "- Summarize URLs, translate, write text, do quick research from provided text.",
    "- Provide weather/time using the built-in commands when asked.",
    "- Never invent sources; if missing info, say so.",
  ].join("\n");
}

function pickProvider() {
  if (PREFERRED_PROVIDER === "openai" && openai) return "openai";
  if (PREFERRED_PROVIDER === "anthropic" && anthropic) return "anthropic";
  if (openai) return "openai";
  if (anthropic) return "anthropic";
  return null;
}

async function callLLM({ system, messages, temperature = 0.6, maxTokens = 700 }) {
  const provider = pickProvider();
  if (!provider) {
    throw new Error("No LLM provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
  }

  if (provider === "anthropic") {
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature,
      system,
      messages
    });
    return response.content?.[0]?.text?.trim() || "";
  }

  const response = await openai.chat.completions.create({
    model: OPENAI_CHAT_MODEL,
    temperature,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, ...messages]
  });

  return response.choices?.[0]?.message?.content?.trim() || "";
}

function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrlText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const html = await res.text();
    return stripHtml(html).slice(0, 8000);
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeUrl(url, chatId) {
  const text = await fetchUrlText(url);
  if (!text) return "No readable content found.";

  const system = loadPersona();
  const prompt = [
    "Summarize the following webpage content.",
    "Keep it short, bullet points when helpful.",
    "If there are key facts (date, location, names), include them.",
    "Content:",
    text
  ].join("\n");

  const reply = await callLLM({
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens: 600
  });

  await bot.sendMessage(chatId, reply || "Summary failed.");
}

function formatHelp() {
  return [
    "🧭 Commands:",
    "/help - show this help",
    "/status - server status",
    "/news - latest AI/tech news list",
    "/digest - summarized digest from RSS",
    "/summary <url> - summarize a webpage",
    "/translate <text> - translate (auto detect)",
    "/write <instruction> - writing helper",
    "/todo add <item> | /todo list | /todo done <n> | /todo clear",
    "/time <city> - local time for a city",
    "/weather <city> - current weather",
    "/img <prompt> - generate image",
    "/edit <prompt> - edit last image (send image first)",
    "/persona <text> - set persona",
    "/remember <text> - add long-term memory",
    "/forget - clear memory"
  ].join("\n");
}

async function geocodePlace(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  const hit = data?.results?.[0];
  if (!hit) return null;
  return {
    name: hit.name,
    country: hit.country,
    latitude: hit.latitude,
    longitude: hit.longitude,
    timezone: hit.timezone
  };
}

const WEATHER_CODE = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  71: "slight snow",
  73: "moderate snow",
  75: "heavy snow",
  80: "rain showers",
  95: "thunderstorm"
};

async function getWeather(place) {
  const geo = await geocodePlace(place);
  if (!geo) return null;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=${encodeURIComponent(geo.timezone)}`;
  const res = await fetch(url);
  const data = await res.json();

  const current = data?.current;
  if (!current) return null;

  return {
    name: `${geo.name}, ${geo.country}`,
    temp: current.temperature_2m,
    wind: current.wind_speed_10m,
    code: current.weather_code
  };
}

async function getLocalTime(place) {
  const geo = await geocodePlace(place);
  if (!geo) return null;
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: geo.timezone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(now);
  return { name: `${geo.name}, ${geo.country}`, time: local };
}

async function fetchNewsList() {
  const { fetchNews } = await import("./fetchNews.js");
  return await fetchNews({ hours: 24, limit: 8 });
}

async function summarizeNewsWithLLM(items) {
  const system = loadPersona();
  const slim = (items || []).slice(0, 8).map(x => ({
    title: x.title,
    source: x.source,
    publishedAt: x.publishedAt,
    link: x.link
  }));

  const prompt = [
    "You are a news editor.",
    "Select the 5 most important items (or fewer).",
    "Output as a concise digest with bullet points and links.",
    "News items:",
    JSON.stringify(slim, null, 2)
  ].join("\n");

  return await callLLM({
    system,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    maxTokens: 700
  });
}

function formatNewsList(items) {
  if (!items.length) return "No news items found.";
  return items.map((x, i) => `${i + 1}. ${x.title}\n${x.link}`).join("\n\n");
}

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
}

async function handleImageEdit(chatId, prompt) {
  if (!openai) {
    await bot.sendMessage(chatId, "⚠️ 缺少 OPENAI_API_KEY，无法编辑图片。");
    return;
  }
  if (!prompt) {
    await bot.sendMessage(chatId, "用法：/edit 把它改成赛博朋克海报风格（先发图片）");
    return;
  }

  const cached = lastPhotoByChat.get(chatId);
  if (!cached) {
    await bot.sendMessage(chatId, "我还没收到你要编辑的图片～先发一张图，再发 /edit 指令。");
    return;
  }

  if (Date.now() - cached.ts > 5 * 60 * 1000) {
    lastPhotoByChat.delete(chatId);
    await bot.sendMessage(chatId, "那张图有点久了（超过5分钟）。重新发一次图片吧。");
    return;
  }

  await bot.sendMessage(chatId, "🎨 正在根据你的图片 + 指令生成新图…");

  try {
    const imgFile = await toFile(fs.createReadStream(cached.filePath), null, {
      type: "image/jpeg",
    });

    const rsp = await openai.images.edit({
      model: "gpt-image-1",
      image: [imgFile],
      prompt,
      size: "1024x1024"
    });

    const b64 = rsp.data?.[0]?.b64_json;
    if (!b64) {
      await bot.sendMessage(chatId, "⚠️ 编辑失败：没有返回图片数据。");
      return;
    }

    const buffer = Buffer.from(b64, "base64");
    await bot.sendPhoto(chatId, buffer, { caption: `🖼️ ${prompt}` });
  } catch (e) {
    console.error("Edit image error:", e);
    await bot.sendMessage(chatId, `⚠️ 图片编辑出错：${e.message || e}`);
  }
}

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.photo || msg.photo.length === 0) return;

  const largest = msg.photo[msg.photo.length - 1];
  const fileId = largest.file_id;

  try {
    const fileUrl = await bot.getFileLink(fileId);
    const res = await fetch(fileUrl);
    const arrayBuffer = await res.arrayBuffer();

    ensureTmpDir();
    const filePath = path.join(TMP_DIR, `tg_${chatId}_${Date.now()}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

    lastPhotoByChat.set(chatId, { filePath, ts: Date.now() });
    await bot.sendMessage(chatId, "收到图片啦 ✅ 现在发：/edit 你的修改要求");
  } catch (e) {
    console.error("Download photo error:", e);
    await bot.sendMessage(chatId, "⚠️ 图片下载失败（可能是网络问题），再发一次试试。", { reply_to_message_id: msg.message_id });
  }
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id, formatHelp());
});

bot.onText(/\/start/, async (msg) => {
  await bot.sendMessage(msg.chat.id, formatHelp());
});

bot.onText(/\/persona (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const newPersona = (match?.[1] || "").trim();
  if (!newPersona) {
    await bot.sendMessage(chatId, "用法：/persona 你的人设描述");
    return;
  }
  fs.writeFileSync(PERSONA_FILE, newPersona);
  await bot.sendMessage(chatId, "🧠 人格设定已更新");
});

bot.onText(/\/remember (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const store = loadStore();
  const state = getChatState(store, chatId);
  const content = (match?.[1] || "").trim();
  if (!content) {
    await bot.sendMessage(chatId, "用法：/remember 要记住的内容");
    return;
  }
  state.messages.push({ role: "system", content });
  state.messages = state.messages.slice(-MAX_MEMORY);
  saveStore(store);
  await bot.sendMessage(chatId, "💾 已记住");
});

bot.onText(/\/forget/, async (msg) => {
  const chatId = msg.chat.id;
  const store = loadStore();
  const state = getChatState(store, chatId);
  state.messages = [];
  state.tasks = [];
  saveStore(store);
  await bot.sendMessage(chatId, "🧹 记忆已清空");
});

bot.onText(/\/img (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const prompt = (match?.[1] || "").trim();

  if (!openai) {
    await bot.sendMessage(chatId, "⚠️ 缺少 OPENAI_API_KEY，无法生成图片。");
    return;
  }

  if (!prompt) {
    await bot.sendMessage(chatId, "用法：/img 一只穿西装的猫在巴黎街头");
    return;
  }

  await bot.sendMessage(chatId, "🎨 正在生成图片…");

  try {
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"
    });

    const imageBase64 = result.data?.[0]?.b64_json;
    if (!imageBase64) {
      await bot.sendMessage(chatId, "⚠️ 图片生成失败：没有返回图像数据。");
      return;
    }

    const buffer = Buffer.from(imageBase64, "base64");
    await bot.sendPhoto(chatId, buffer, { caption: `🖼️ ${prompt}` });
  } catch (e) {
    console.error("Image error:", e);
    await bot.sendMessage(chatId, `⚠️ 图片生成出错：${e.message || e}`);
  }
});

bot.onText(/\/edit (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const prompt = (match?.[1] || "").trim();
  await handleImageEdit(chatId, prompt);
});

bot.onText(/\\edit (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const prompt = (match?.[1] || "").trim();
  await handleImageEdit(chatId, prompt);
});

bot.onText(/\/news/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const items = await fetchNewsList();
    await bot.sendMessage(chatId, formatNewsList(items));
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ 获取新闻失败：${e.message || e}`);
  }
});

bot.onText(/\/digest/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const items = await fetchNewsList();
    const digest = await summarizeNewsWithLLM(items);
    await bot.sendMessage(chatId, digest || "No digest produced.");
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ 摘要失败：${e.message || e}`);
  }
});

bot.onText(/\/summary (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const url = (match?.[1] || "").trim();
  if (!url.startsWith("http")) {
    await bot.sendMessage(chatId, "用法：/summary https://example.com");
    return;
  }
  try {
    await summarizeUrl(url, chatId);
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ 总结失败：${e.message || e}`);
  }
});

bot.onText(/\/translate (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const text = (match?.[1] || "").trim();
  if (!text) {
    await bot.sendMessage(chatId, "用法：/translate 你好世界");
    return;
  }
  try {
    const system = loadPersona();
    const prompt = `Translate the following text. Preserve meaning and tone.\n\n${text}`;
    const reply = await callLLM({
      system,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 500
    });
    await bot.sendMessage(chatId, reply || "Translation failed.");
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ 翻译失败：${e.message || e}`);
  }
});

bot.onText(/\/write (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const text = (match?.[1] || "").trim();
  if (!text) {
    await bot.sendMessage(chatId, "用法：/write 帮我写一个活动邀请");
    return;
  }
  try {
    const system = loadPersona();
    const reply = await callLLM({
      system,
      messages: [{ role: "user", content: text }],
      temperature: 0.7,
      maxTokens: 700
    });
    await bot.sendMessage(chatId, reply || "Write failed.");
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ 写作失败：${e.message || e}`);
  }
});

bot.onText(/\/todo (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = (match?.[1] || "").trim();
  const store = loadStore();
  const state = getChatState(store, chatId);

  if (input.startsWith("add ")) {
    const item = input.replace(/^add\s+/, "").trim();
    if (!item) {
      await bot.sendMessage(chatId, "用法：/todo add 事情");
      return;
    }
    state.tasks.push({ text: item, done: false, ts: Date.now() });
    saveStore(store);
    await bot.sendMessage(chatId, "✅ 已添加");
    return;
  }

  if (input === "list") {
    if (!state.tasks.length) {
      await bot.sendMessage(chatId, "暂无待办。");
      return;
    }
    const lines = state.tasks.map((t, i) => `${i + 1}. ${t.done ? "[x]" : "[ ]"} ${t.text}`);
    await bot.sendMessage(chatId, lines.join("\n"));
    return;
  }

  if (input.startsWith("done ")) {
    const idx = Number(input.replace(/^done\s+/, "").trim()) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= state.tasks.length) {
      await bot.sendMessage(chatId, "用法：/todo done 1");
      return;
    }
    state.tasks[idx].done = true;
    saveStore(store);
    await bot.sendMessage(chatId, "✅ 已完成");
    return;
  }

  if (input === "clear") {
    state.tasks = [];
    saveStore(store);
    await bot.sendMessage(chatId, "🧹 已清空待办");
    return;
  }

  await bot.sendMessage(chatId, "用法：/todo add ... | /todo list | /todo done n | /todo clear");
});

bot.onText(/\/time (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const place = (match?.[1] || "").trim();
  if (!place) {
    await bot.sendMessage(chatId, "用法：/time Paris");
    return;
  }
  try {
    const info = await getLocalTime(place);
    if (!info) {
      await bot.sendMessage(chatId, "没找到这个地点，请换个写法试试。");
      return;
    }
    await bot.sendMessage(chatId, `🕒 ${info.name}: ${info.time}`);
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ 获取时间失败：${e.message || e}`);
  }
});

bot.onText(/\/weather (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const place = (match?.[1] || "").trim();
  if (!place) {
    await bot.sendMessage(chatId, "用法：/weather Paris");
    return;
  }
  try {
    const info = await getWeather(place);
    if (!info) {
      await bot.sendMessage(chatId, "没找到这个地点，请换个写法试试。");
      return;
    }
    const desc = WEATHER_CODE[info.code] || `code ${info.code}`;
    await bot.sendMessage(chatId, `🌤 ${info.name}: ${info.temp}°C, ${desc}, wind ${info.wind} km/h`);
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ 获取天气失败：${e.message || e}`);
  }
});

bot.on("text", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!text) return;

  // Commands are handled by onText
  if (text.startsWith("/")) return;

  // URL summary shortcut
  const urls = extractUrls(text);
  if (urls.length > 0) {
    try {
      await summarizeUrl(urls[0], chatId);
    } catch (e) {
      await bot.sendMessage(chatId, `⚠️ 总结失败：${e.message || e}`);
    }
    return;
  }

  const store = loadStore();
  const state = getChatState(store, chatId);
  const persona = loadPersona();

  state.messages.push({ role: "user", content: text });
  state.messages = state.messages.slice(-MAX_MEMORY);
  saveStore(store);

  const memoryNotes = state.messages
    .filter(m => m.role === "system")
    .map(m => `- ${m.content}`)
    .join("\n");

  const system = memoryNotes
    ? `${persona}\n\nLong-term memory:\n${memoryNotes}`
    : persona;

  const messages = state.messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const reply = await callLLM({
      system,
      messages,
      temperature: 0.7,
      maxTokens: 700
    });

    state.messages.push({ role: "assistant", content: reply });
    state.messages = state.messages.slice(-MAX_MEMORY);
    saveStore(store);

    await bot.sendMessage(chatId, reply || "⚠️ 出错了");
  } catch (e) {
    console.error(e);
    await bot.sendMessage(chatId, "⚠️ 出错了");
  }
});
