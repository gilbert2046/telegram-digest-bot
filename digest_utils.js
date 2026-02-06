import dotenv from "dotenv";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
const PREFERRED_PROVIDER = (process.env.PREFERRED_PROVIDER || "").toLowerCase();
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
const ALPHAVANTAGE_API_KEY = process.env.ALPHAVANTAGE_API_KEY || "";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function pickProvider() {
  if (PREFERRED_PROVIDER === "openai" && openai) return "openai";
  if (PREFERRED_PROVIDER === "anthropic" && anthropic) return "anthropic";
  if (openai) return "openai";
  if (anthropic) return "anthropic";
  return null;
}

export async function callLLM({ system, messages, temperature = 0.4, maxTokens = 1200 }) {
  const provider = pickProvider();
  if (!provider) throw new Error("No LLM provider configured.");

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
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
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.statusCode;
      if (status === 429 || status === 503) {
        const wait = 1000 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export async function tavilySearch(query, opts = {}) {
  if (!TAVILY_API_KEY) throw new Error("Missing TAVILY_API_KEY");
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query,
        search_depth: opts.search_depth || "basic",
        max_results: opts.max_results || 6,
        include_answer: opts.include_answer ?? true,
        include_raw_content: false
      })
    });
    if (res.ok) return await res.json();
    const err = await res.text();
    lastErr = new Error(`Tavily error: ${err}`);
    if (res.status === 429 || res.status === 503) {
      const wait = 1000 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

async function alphaVantage(params) {
  if (!ALPHAVANTAGE_API_KEY) throw new Error("Missing ALPHAVANTAGE_API_KEY");
  const url = new URL("https://www.alphavantage.co/query");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("apikey", ALPHAVANTAGE_API_KEY);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Alpha Vantage error: ${res.status}`);
  return await res.json();
}

export async function getStockQuote(symbol) {
  const data = await alphaVantage({ function: "GLOBAL_QUOTE", symbol });
  const q = data?.["Global Quote"] || {};
  return {
    symbol,
    price: q["05. price"] || null,
    change: q["09. change"] || null,
    changePercent: q["10. change percent"] || null,
    latestTradingDay: q["07. latest trading day"] || null
  };
}

export async function getGoldSpot() {
  const data = await alphaVantage({ function: "GOLD_SILVER_SPOT" });
  const rows = data?.data || [];
  const latest = rows[0] || {};
  return {
    price: latest.value || null,
    date: latest.date || null
  };
}

export async function getParisWeather() {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FParis";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error: ${res.status}`);
  return await res.json();
}

export function parisDateInfo() {
  const dt = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  return { date: dt, weekday: dt.getDay() }; // 0=Sun
}
