import { Hono } from 'hono'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

type Bindings = {
  DB: D1Database
  LINKS: KVNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789' // 去掉 i/l/o/0/1 等易混淆字符
const CODE_LENGTH = 6
const CACHE_TTL_SECONDS = 60 * 60 * 24 // KV 缓存 24 小时
const RESERVED_CODES = ['api', 'health', 'favicon.ico', 'robots.txt', 'assets']

function randomCode(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

async function codeExists(db: D1Database, code: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM links WHERE code = ?').bind(code).first()
  return row !== null
}

async function generateUniqueCode(db: D1Database): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const candidate = randomCode(CODE_LENGTH)
    if (RESERVED_CODES.includes(candidate)) continue
    if (await codeExists(db, candidate)) continue
    return candidate
  }
  return null
}

async function cacheClick(db: D1Database, code: string): Promise<void> {
  await db.prepare('UPDATE links SET click_count = click_count + 1 WHERE code = ?').bind(code).run()
}

// 索引页：内置极简 UI，省掉独立前端构建，保持迭代轻量
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LinkLite · 短链服务</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:16px/1.6 ui-sans-serif,system-ui,"Segoe UI",sans-serif; padding:24px; }
  main { width:100%; max-width:560px; }
  h1 { margin:0 0 4px; font-size:34px; letter-spacing:-.5px; }
  .sub { margin:0 0 28px; opacity:.65; font-size:14px; }
  form { display:flex; gap:10px; }
  input { flex:1; padding:13px 15px; border:1px solid rgba(128,128,128,.45);
          border-radius:10px; font-size:15px; background:transparent; }
  button { padding:13px 20px; border:0; border-radius:10px; font-size:15px;
           background:#ff6a00; color:#fff; cursor:pointer; font-weight:600; }
  button:hover { filter:brightness(1.08); }
  #out { margin-top:22px; min-height:52px; font-size:15px; word-break:break-all; }
  #out a { color:#ff6a00; }
  .tag { display:inline-block; padding:3px 9px; border:1px solid rgba(128,128,128,.4);
         border-radius:999px; font-size:12px; opacity:.7; margin-bottom:22px; }
  code { background:rgba(128,128,128,.18); padding:2px 6px; border-radius:5px; }
</style>
</head>
<body>
<main>
  <div class="tag">Cloudflare Workers · D1 · KV</div>
  <h1>LinkLite</h1>
  <p class="sub">把长链接变短，走 Cloudflare 边缘分发</p>
  <form id="f">
    <input id="url" type="url" placeholder="https://example.com/a/very/long/path" required>
    <button type="submit">缩短</button>
  </form>
  <div id="out"></div>
</main>
<script>
document.getElementById('f').addEventListener('submit', async function (e) {
  e.preventDefault();
  var out = document.getElementById('out');
  out.textContent = '生成中...';
  try {
    var r = await fetch('/api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: document.getElementById('url').value })
    });
    var d = await r.json();
    if (!r.ok) { out.textContent = d.error || '生成失败'; return; }
    out.innerHTML = '';
    var a = document.createElement('a');
    a.href = d.shortUrl; a.textContent = d.shortUrl; a.target = '_blank';
    out.appendChild(a);
    var b = document.createElement('button');
    b.textContent = '复制'; b.style.marginLeft = '10px'; b.style.padding = '8px 14px';
    b.onclick = function () {
      navigator.clipboard.writeText(d.shortUrl);
      b.textContent = '已复制';
      setTimeout(function () { b.textContent = '复制'; }, 1500);
    };
    out.appendChild(b);
  } catch (err) {
    out.textContent = '请求失败: ' + err.message;
  }
});
</script>
</body>
</html>`

// ---------- 首页 ----------
app.get('/', (c) => c.html(INDEX_HTML))

// ---------- 健康检查 (迭代 3 的 SLO 探针入口) ----------
app.get('/health', async (c) => {
  try {
    const row = await c.env.DB.prepare('SELECT 1 AS ok').first()
    return c.json({ status: 'ok', db: row ? 'up' : 'down', ts: new Date().toISOString() })
  } catch (e) {
    return c.json({ status: 'degraded', error: String(e) }, 503)
  }
})

// ---------- 生成短链 ----------
app.post('/api/shorten', async (c) => {
  try {
    const body = await c.req.json<{ url?: string; code?: string }>().catch(() => null)
    if (!body || typeof body.url !== 'string') {
      return c.json({ error: '请求体需包含 url 字段' }, 400)
    }

    const url = body.url.trim()
    if (!isValidHttpUrl(url)) {
      return c.json({ error: 'url 必须是合法的 http/https 地址' }, 400)
    }
    if (url.length > 2048) {
      return c.json({ error: 'url 过长 (最多 2048 字符)' }, 400)
    }

    let code: string

    if (typeof body.code === 'string' && body.code.trim()) {
      const custom = body.code.trim().toLowerCase()
      if (!/^[a-z0-9_-]{3,32}$/.test(custom)) {
        return c.json({ error: '自定义短码只能包含 a-z 0-9 _ - ，长度 3-32' }, 400)
      }
      if (RESERVED_CODES.includes(custom)) {
        return c.json({ error: '该短码为系统保留' }, 400)
      }
      if (await codeExists(c.env.DB, custom)) {
        return c.json({ error: '短码 ' + custom + ' 已被占用' }, 409)
      }
      code = custom
    } else {
      const generated = await generateUniqueCode(c.env.DB)
      if (!generated) return c.json({ error: '生成短码失败，请重试' }, 500)
      code = generated
    }

    await c.env.DB.prepare('INSERT INTO links (code, url) VALUES (?, ?)').bind(code, url).run()
    // 预热缓存，首次跳转即可命中
    await c.env.LINKS.put('link:' + code, url, { expirationTtl: CACHE_TTL_SECONDS })

    const shortUrl = new URL(c.req.url).origin + '/' + code
    return c.json({ code, shortUrl, url }, 201)
  } catch (e) {
    return c.json({ error: '服务内部错误', detail: String(e) }, 500)
  }
})

// ---------- 跳转 ----------
app.get('/:code', async (c) => {
  const code = c.req.param('code').toLowerCase()
  const cacheKey = 'link:' + code

  let url = await c.env.LINKS.get(cacheKey)

  if (!url) {
    const row = await c.env.DB.prepare('SELECT url FROM links WHERE code = ?').bind(code).first<{ url: string }>()
    if (!row) return c.json({ error: '短码不存在', code }, 404)
    url = row.url
    // 回填缓存，下次命中
    await c.env.LINKS.put(cacheKey, url, { expirationTtl: CACHE_TTL_SECONDS })
  }

  // 计数不阻塞跳转，失败也不影响用户体验
  c.executionCtx.waitUntil(cacheClick(c.env.DB, code))

  return c.redirect(url, 302)
})

export default app
