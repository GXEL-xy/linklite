#!/usr/bin/env node
// 钉钉群机器人通知（支持加签）
// 文档: https://open.dingtalk.com/document/orgapp/custom-robot-access
//
// 环境变量:
//   DINGTALK_WEBHOOK  必填(缺失则跳过)  https://oapi.dingtalk.com/robot/send?access_token=XXX
//   DINGTALK_SECRET   可选             SEC 开头的加签密钥，未开启加签则留空
//   NOTIFY_TEXT       必填             消息正文
//
// 加签算法（注意与飞书相反）:
//   stringToSign = timestamp(毫秒) + "\n" + secret
//   sign = urlencode( base64( HMAC-SHA256(key=secret, msg=stringToSign) ) )

import crypto from "node:crypto";

const webhook = process.env.DINGTALK_WEBHOOK;
const secret = process.env.DINGTALK_SECRET;
const text = process.env.NOTIFY_TEXT;

if (!webhook) {
  console.log("[dingtalk] 未配置 DINGTALK_WEBHOOK，跳过通知");
  process.exit(0);
}
if (!text) {
  console.error("[dingtalk] 缺少 NOTIFY_TEXT");
  process.exit(1);
}

let url = webhook;
if (secret) {
  const timestamp = String(Date.now()); // 钉钉要求毫秒
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac("sha256", secret).update(stringToSign).digest("base64");
  url += `${url.includes("?") ? "&" : "?"}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ msgtype: "text", text: { content: text } }),
});

const data = await res.json().catch(() => ({}));
console.log(`[dingtalk] http=${res.status} errcode=${data.errcode} errmsg=${data.errmsg}`);

// 成功返回 {"errcode":0,"errmsg":"ok"}；19021 签名错误 / 130101 关键词不匹配等
if (res.status !== 200 || data.errcode !== 0) {
  console.error(`[dingtalk] 发送失败: ${JSON.stringify(data)}`);
  process.exit(1);
}
