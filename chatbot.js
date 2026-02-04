import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { toFile } from "openai";
import path from "path";


const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: { timeout: 10 }
  }
});

bot.on("polling_error", (error) => {
  const msg = String(error?.message || error);
  if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
    // 网络/DNS 问题：静默处理，避免刷屏
    return;
  }
  console.log("Polling error:", msg);
});

// ✅ 全局缓存：记录每个聊天最近发来的图片（用于 \edit）
const lastPhotoByChat = new Map(); // chatId -> { filePath, ts }
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


console.log("🤖 Telegram agent is running...");

function loadMemory() {
  try {
    if (!fs.existsSync("memory.json")) return [];
    const raw = fs.readFileSync("memory.json", "utf8").trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    // memory.json 损坏时自动恢复，避免 bot 崩溃
    fs.writeFileSync("memory.json", "[]\n");
    return [];
  }
}

function saveMemory(mem) {
  fs.writeFileSync("memory.json", JSON.stringify(mem.slice(-20), null, 2));
}

function loadPersona() {
  return fs.existsSync("persona.txt")
    ? fs.readFileSync("persona.txt", "utf8")
    : "你是一个有帮助的 AI 助手。";
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // 📷 用户发来图片：下载到本地，等待后续 \edit 指令
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    const fileId = largest.file_id;

    try {
      const fileUrl = await bot.getFileLink(fileId);
      const res = await fetch(fileUrl);
      const arrayBuffer = await res.arrayBuffer();

      const dir = path.join(process.cwd(), "tmp");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);

      const filePath = path.join(dir, `tg_${chatId}_${Date.now()}.jpg`);
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

      lastPhotoByChat.set(chatId, { filePath, ts: Date.now() });

      // 如果图片 caption 里就带了 \edit，则直接走编辑
      const cap = (msg.caption || "").trim();
      if (cap.startsWith("\\edit ")) {
        msg.text = cap; // 让下面统一走编辑逻辑
      } else {
        await bot.sendMessage(chatId, "收到图片啦 ✅ 现在发：\\edit 你的修改要求（例如：\\edit 改成赛博朋克海报风格）");
        return;
      }
    } catch (e) {
      console.error("Download photo error:", e);
      await bot.sendMessage(chatId, "⚠️ 图片下载失败（可能是网络问题），再发一次试试。");
      return;
    }
  }
  // 🎨 图片编辑：\edit 你的要求（先发图，再发 \edit）
  const incomingText = (msg.text || "").trim();
  if (incomingText.startsWith("\\edit ")) {
    const prompt = incomingText.replace("\\edit ", "").trim();

    if (!process.env.OPENAI_API_KEY) {
      await bot.sendMessage(chatId, "⚠️ 缺少 OPENAI_API_KEY，无法编辑图片。");
      return;
    }
    if (!prompt) {
      await bot.sendMessage(chatId, "用法：\\edit 把它改成赛博朋克海报风格（先发图片）");
      return;
    }

    const cached = lastPhotoByChat.get(chatId);
    if (!cached) {
      await bot.sendMessage(chatId, "我还没收到你要编辑的图片～先发一张图，再发 \\edit 指令。");
      return;
    }

    // 5分钟内有效
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

    return;
  }

  if (!text) return;

  // 🎭 修改人格
  if (text.startsWith("/persona ")) {
    const newPersona = text.replace("/persona ", "");
    fs.writeFileSync("persona.txt", newPersona);
    await bot.sendMessage(chatId, "🧠 人格设定已更新");
    return;
  }

  // 🧠 写入长期记忆
  if (text.startsWith("/remember ")) {
    const memory = loadMemory();
    memory.push({ role: "system", content: text.replace("/remember ", "") });
    saveMemory(memory);
    await bot.sendMessage(chatId, "💾 已记住");
    return;
  }
// 🎨 生成图片：/img 你的描述
if (text.startsWith("/img ")) {
  const prompt = text.replace("/img ", "").trim();

  if (!process.env.OPENAI_API_KEY) {
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
  return;
}

  // 🗑 清空记忆
  if (text === "/forget") {
    fs.writeFileSync("memory.json", "[]");
    await bot.sendMessage(chatId, "🧹 记忆已清空");
    return;
  }

  const persona = loadPersona();
  let memory = loadMemory();
  memory.push({ role: "user", content: text });

  const messages = [
    { role: "user", content: persona },
    ...memory.slice(-10)
  ];

  try {
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 500,
      temperature: 0.7,
      messages
    });

    const reply = response.content[0].text;

    memory.push({ role: "assistant", content: reply });
    saveMemory(memory);

    await bot.sendMessage(chatId, reply);

  } catch (e) {
    console.error(e);
    await bot.sendMessage(chatId, "⚠️ 出错了");
  }
});
