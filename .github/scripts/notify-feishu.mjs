#!/usr/bin/env node
// 飞书自定义机器人通知（支持签名校验）
// 算法: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
//
// 环境变量:
//   FEISHU_WEBHOOK  必填(缺失则跳过)  webhook 地址
//   FEISHU_SECRET   可选            签名校验的密钥，未开启校验则留空
//   FEISHU_TEXT     必填            消息正文
//
// 用法: FEISHU_WEBHOOK=... FEISHU_SECRET=... FEISHU_TEXT="..." node .github/scripts/notify-feishu.mjs

import crypto from "node:crypto";

const webhook = process.env.FEISHU_WEBHOOK;
const secret = process.env.FEISHU_SECRET;
const text = process.env.FEISHU_TEXT;

if (!webhook) {
  console.log("[feishu] 未配置 FEISHU_WEBHOOK，跳过通知");
  process.exit(0);
}
if (!text) {
  console.error("[feishu] 缺少 FEISHU_TEXT");
  process.exit(1);
}

// timestamp + "\n" + secret 作为 key，对空串做 HMAC-SHA256，再 base64
function genSign(key, ts) {
  const stringToSign = `${ts}\n${key}`;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

const timestamp = String(Math.floor(Date.now() / 1000));
const body = { msg_type: "text", content: { text } };
if (secret) {
  body.timestamp = timestamp;
  body.sign = genSign(secret, timestamp);
}

const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const data = await res.json().catch(() => ({}));
console.log(`[feishu] http=${res.status} code=${data.code} msg=${data.msg}`);

// 飞书成功返回 code:0；关键词不匹配 19024、签名错误 19021、IP 不允许 19022
if (res.status !== 200 || (data.code !== undefined && data.code !== 0)) {
  console.error(`[feishu] 发送失败: ${JSON.stringify(data)}`);
  process.exit(1);
}
