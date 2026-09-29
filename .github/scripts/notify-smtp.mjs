#!/usr/bin/env node
// SMTP 邮件告警
//
// 环境变量（前 5 个未配置则静默跳过）:
//   SMTP_HOST       如 smtp.qq.com
//   SMTP_PORT       465(SSL) 或 587(STARTTLS)，默认 465
//   SMTP_USER       登录账号
//   SMTP_PASS       授权码（不是登录密码）
//   ALERT_TO        收件人
//   ALERT_FROM      发件人，默认同 SMTP_USER（QQ/163 强制要求）
//   ALERT_SUBJECT   标题
//   ALERT_TEXT      正文（必填）

import nodemailer from "nodemailer";

const {
  SMTP_HOST,
  SMTP_PORT = "465",
  SMTP_USER,
  SMTP_PASS,
  ALERT_TO,
  ALERT_FROM,
  ALERT_SUBJECT = "[LinkLite] 服务告警",
} = process.env;
const text = process.env.ALERT_TEXT;
const to = ALERT_TO || SMTP_USER; // 未配置收件人时发给发件人自己

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.log("[smtp] 未配置 SMTP Secrets，跳过通知");
  process.exit(0);
}
if (!text) {
  console.error("[smtp] 缺少 ALERT_TEXT");
  process.exit(1);
}

const port = Number(SMTP_PORT);

const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465, // 465 = 隐式 TLS
  requireTLS: port === 587, // 587 = 必须 STARTTLS 升级
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
});

try {
  const info = await transport.sendMail({
    from: ALERT_FROM || SMTP_USER,
    to,
    subject: ALERT_SUBJECT,
    text,
  });
  console.log(`[smtp] 已发送 messageId=${info.messageId}`);
} catch (e) {
  console.error(`[smtp] 发送失败: ${e && e.message}`);
  process.exit(1);
}
