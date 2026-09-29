# LinkLite

> 基于 **Cloudflare Workers + D1 + KV** 的短链服务。
> 这不只是一个应用，而是一条**持续迭代的运维能力演进线** —— 每次功能迭代都同步交付一项运维能力。

**🟢 已上线**：https://linklite.2956446350.workers.dev

---

## 架构

```
                         ┌──────────────────────────────┐
   用户请求              │   Cloudflare 全球边缘网络     │
 ─────────────►  就近 PoP ┤                              │
                         │  ┌────────────────────────┐  │
                         │  │  Worker: linklite      │  │
                         │  │  (Hono 路由)           │  │
                         │  └───┬──────────────┬─────┘  │
                         │      │ 命中          │ 未命中  │
                         │      ▼              ▼        │
                         │  ┌───────┐     ┌──────────┐  │
                         │  │  KV   │────►│   D1     │  │
                         │  │ 热缓存│◄────│ 短链映射 │  │
                         │  └───────┘     └──────────┘  │
                         └──────────────────────────────┘
```

| 层 | 组件 | 职责 |
|---|---|---|
| 计算 | **Worker (Hono)** | 路由、校验、生成短码、编排读写 |
| 状态 | **D1 (SQLite)** | 短链映射 + 点击计数（事实来源） |
| 缓存 | **KV** | 热链接毫秒级跳转，24h TTL |

---

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/` | 内置短链生成页 |
| `POST` | `/api/shorten` | `{ "url": "...", "code"? }` → `{ code, shortUrl, url }` |
| `GET` | `/:code` | 302 跳转，异步累加点击数 |
| `GET` | `/health` | 健康检查（DB 连通性） |

```bash
curl -X POST https://<你的域名>/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://developers.cloudflare.com/"}'
```

---

## 快速开始

```bash
npm install

npm run typecheck    # 类型检查
npm run dev          # 本地开发 (wrangler dev)
```

### 已创建的云资源

| 资源 | 名称 | ID |
|---|---|---|
| D1 | `linklite-db` | `2c05c270-0a7b-4060-ab67-a9dca3a66fdf` |
| KV | `linklite` | `c914bce1892943e5b491b12dbe5d8509` |
| Worker | `linklite` | `https://linklite.2956446350.workers.dev` |

```bash
npm run db:schema    # 远端建表
npm run deploy       # 部署
```

> **本机注意**：wrangler 不读 Windows 系统代理，必须显式设代理才能连上 Cloudflare API。
> ```bash
> export HTTPS_PROXY=http://127.0.0.1:7890
> export HTTP_PROXY=http://127.0.0.1:7890
> export NODE_USE_ENV_PROXY=1      # Node 24+ 让 fetch 也走代理
> ```
> 否则 `wrangler whoami` 会报 `The request to Cloudflare's API timed out`。

---

## 交付流水线

```
push ──► GitHub Actions CI
          typecheck → 本地 D1 建表 → 起 wrangler dev → 14 用例冒烟测试
                 │
                 └► Workers Builds (Cloudflare 原生)   push 到 main 时
                    npm ci && typecheck → wrangler deploy

每 5 分钟 ──► 监控探活 workflow
              ├ 连续 3 次失败 → 开 GitHub 事故单 + 钉钉群通知
              ├ 持续故障 → 保持静默（不重复轰炸）
              └ 恢复 → 自动关单 + 发恢复通知
```

| 环节 | 实现 | 触发 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | 每次 push / PR |
| 集成测试 | `scripts/smoke.mjs`（14 用例 / 22 断言，起**真实** `wrangler dev` 跑） | 每次 push / PR |
| 部署 | Workers Builds，类型不过就不部署 | push 到 `main` |
| 探活 | curl `/health`，连续 3 次失败才判定宕机 | 每 5 分钟 |
| 告警 | GitHub 事故单生命周期 + 钉钉群机器人（支持加签） | 故障 / 恢复 |

本地复现同一条测试链：

```bash
npm run typecheck && npm run db:schema:local
npm run dev &
node scripts/smoke.mjs http://127.0.0.1:8787
```

---

## 迭代路线图

每一轮迭代 = **一个功能** + **一项运维能力** + **一份可展示证据**。

| 迭代 | 功能 | 运维能力 | 状态 |
|:---:|---|---|:---:|
| **0** | 短链生成 / 跳转 / KV 缓存 | 打通本地开发 → 部署上线 | ✅ 完成 |
| **1** | 热链接缓存优化 | **CI/CD**：PR 审批 + 自动测试部署 | ⬜ |
| **2** | 点击统计面板 | **可观测性**：Analytics 指标 + Dashboard | ⬜ |
| **3** | 健康检查 / SLO | **告警**：可用性阈值 → webhook 通知 | ⬜ |
| **4** | 防滥用（限流 / Turnstile） | **安全**：WAF 规则 + 自动封禁 | ⬜ |
| **5** | 基础设施重构 | **IaC**：Terraform 接管 DNS / WAF / 缓存 | ⬜ |
| **6** | 新特性（导出 / 多语言） | **发布工程**：灰度发布 + 自动回滚 | ⬜ |

### 运维能力覆盖地图

```
IaC ████████░░ 迭代5        CI/CD ████████░░ 迭代1
监控 ████████░░ 迭代2        告警   ██████░░░░ 迭代3
安全 ██████░░░░ 迭代4        发布   ██████░░░░ 迭代6
```

---

## 设计决策

| 决策 | 理由 |
|---|---|
| **Hono 而非 Next.js** | 构建链极短，冷启动快，把精力留给运维体系而非框架 |
| **内嵌 HTML 页面** | 省掉独立前端构建，迭代 0 聚焦链路打通 |
| **D1 为事实来源 + KV 做缓存** | 保证一致性，缓存可丢弃可重建 |
| **点击计数走 `waitUntil`** | 统计不阻塞 302 跳转，失败也不影响用户体验 |
| **随机短码 + 冲突重试** | 避免可枚举攻击，比纯自增 ID 更安全 |

---

## 技术栈

`Cloudflare Workers` · `Hono` · `D1` · `KV` · `TypeScript` · `Wrangler` · `GitHub Actions`(迭代1) · `Terraform`(迭代5)
