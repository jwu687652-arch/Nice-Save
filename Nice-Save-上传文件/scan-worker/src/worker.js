// Receipt scanning service for the 每日记账 PWA, running on Cloudflare Workers.
// The app sends a (shrunk) receipt photo; this worker asks Claude to read it and returns JSON.
// Your Anthropic API key stays here as a Worker secret and never reaches the phone.
//
// Secrets (set with `npx wrangler secret put NAME`):
//   ANTHROPIC_API_KEY  your Anthropic API key
//   APP_TOKEN          any long random string; the app must send it in the X-App-Token header
// Variable (wrangler.toml [vars]):
//   ALLOWED_ORIGIN     your app's address, e.g. https://yourname.github.io (comma-separate several)

import Anthropic from "@anthropic-ai/sdk";

const CATEGORIES = ["groc", "sport", "trans", "home", "shop", "fun", "health", "food", "other"];
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BASE64 = 7_000_000; // ~5 MB image

const SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    reason: { type: "string" },
    store: { type: "string" },
    date: { type: "string" },
    total: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw: { type: "string" },
          name: { type: "string" },
          price: { type: "number" },
          cat: { type: "string", enum: CATEGORIES },
        },
        required: ["raw", "name", "price", "cat"],
        additionalProperties: false,
      },
    },
  },
  required: ["is_receipt", "reason", "store", "date", "total", "items"],
  additionalProperties: false,
};

const PROMPT = `你在帮一个住在澳洲的人记账。图片是一张购物小票：可能是 Coles、Woolworths、Aldi、Kmart、药房等的纸质小票，也可能是 Everyday Rewards / Flybuys App 里的电子小票截图。

请读出小票内容，按给定的 JSON 结构回答：
- is_receipt：图片是不是一张能看清的购物小票。不是或看不清时为 false，在 reason 里用一句中文说明原因，其他字段留空（空字符串、0、空数组）。是小票时 reason 留空。
- store：商店名，用小票上的英文原名，例如 Woolworths。
- date：小票日期，格式 YYYY-MM-DD；看不出来就留空字符串。
- total：实付总额（TOTAL 或 BALANCE DUE），澳元数字。
- items：每一件商品一行。
  - raw：小票上这一行的原文。
  - name：简短的中文商品名，品牌可以保留英文，带上规格，例如「全脂牛奶 2L」。
  - price：这一行最终付的金额，澳元数字。折扣、优惠、会员价这类行（SAVE、PROMO、负数）合并进它所属商品的价格，不要单独列出。
  - cat：分类。groc 超市食品、日用品、清洁用品；sport 运动健身（蛋白粉、蛋白棒、运动用品）；trans 交通（油费、Opal 充值）；home 居住（家具、家电、维修）；shop 购物（衣服、电子产品、家居小物）；fun 娱乐（礼品卡、游戏、玩具）；health 医疗健康（药品、维生素、保健品）；food 餐饮（熟食、咖啡、外卖）；other 其他。
- 不要把小计、GST、找零、付款方式、积分这些非商品行放进 items。`;

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (allowed.length && !allowed.includes(origin)) return json({ error: "forbidden_origin" }, 403, cors);
    if (!env.APP_TOKEN || request.headers.get("X-App-Token") !== env.APP_TOKEN) return json({ error: "unauthorized" }, 401, cors);

    if (request.method === "GET" && path === "/health") return json({ ok: true }, 200, cors);
    if (request.method !== "POST" || path !== "/scan") return json({ error: "not_found" }, 404, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad_image" }, 400, cors); }
    const image = body && body.image, mediaType = body && body.mediaType;
    if (typeof image !== "string" || !image || image.length > MAX_BASE64 || !MEDIA_TYPES.includes(mediaType)) {
      return json({ error: "bad_image" }, 400, cors);
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        // If a safety check declines the request, Anthropic retries it on its recommended fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      });

      if (response.stop_reason === "refusal") return json({ error: "refused" }, 422, cors);
      if (response.stop_reason === "max_tokens") return json({ error: "too_long" }, 422, cors);

      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      let data;
      try { data = JSON.parse(text); } catch { return json({ error: "upstream" }, 502, cors); }
      return json(data, 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 502, cors);
      if (error instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429, cors);
      if (error instanceof Anthropic.BadRequestError) return json({ error: "bad_image", detail: error.message }, 400, cors);
      if (error instanceof Anthropic.APIError) return json({ error: "upstream", status: error.status }, 502, cors);
      return json({ error: "upstream" }, 502, cors);
    }
  },
};
