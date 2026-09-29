#!/usr/bin/env node
// 冒烟测试：对给定 BASE_URL 跑一遍核心契约
// 用法: node scripts/smoke.mjs [baseUrl]
//   本地: node scripts/smoke.mjs http://127.0.0.1:8787
//   线上: node scripts/smoke.mjs https://linklite.2956446350.workers.dev

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const RUN = Date.now().toString(36)
const TARGET = `https://example.com/smoke/${RUN}`
const CUSTOM = `smk${RUN}`

const results = []

async function call(path, init) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...init })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON 响应 */
  }
  return { res, text, json }
}

function post(body) {
  return call('/api/shorten', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: cond ? '' : detail || '' })
}

const tests = [
  ['首页 200', async () => {
    const { res, text } = await call('/')
    check('首页 200', res.status === 200, `got ${res.status}`)
    check('首页含标题', text.includes('LinkLite'), '缺少 LinkLite 标题')
  }],

  ['健康检查 /health', async () => {
    const { res, json } = await call('/health')
    check('/health 200', res.status === 200, `got ${res.status}`)
    check('/health db up', json && json.db === 'up', `db=${json && json.db}`)
  }],

  ['生成随机短链', async () => {
    const { res, json } = await post({ url: TARGET })
    check('随机码返回 201', res.status === 201, `got ${res.status} ${JSON.stringify(json)}`)
    check('返回 code 与 shortUrl', !!(json && json.code && json.shortUrl), JSON.stringify(json))
    if (json && json.code) results.push({ name: '记录随机码', pass: true, detail: json.code })
  }],

  ['生成自定义短链', async () => {
    const { res, json } = await post({ url: TARGET, code: CUSTOM })
    check('自定义码 201', res.status === 201, `got ${res.status} ${JSON.stringify(json)}`)
    check('自定义码回显', json && json.code === CUSTOM, `code=${json && json.code}`)
  }],

  ['重复自定义码冲突', async () => {
    const { res, json } = await post({ url: 'https://example.com/dup', code: CUSTOM })
    check('重复码 409', res.status === 409, `got ${res.status}`)
    check('重复码带错误信息', !!(json && json.error), JSON.stringify(json))
  }],

  ['非法 URL 拦截', async () => {
    const { res } = await post({ url: 'not-a-url' })
    check('非法 URL 400', res.status === 400, `got ${res.status}`)
  }],

  ['非 http 协议拦截', async () => {
    const { res } = await post({ url: 'javascript:alert(1)' })
    check('非 http 协议 400', res.status === 400, `got ${res.status}`)
  }],

  ['缺失 url 字段', async () => {
    const { res } = await post({})
    check('缺字段 400', res.status === 400, `got ${res.status}`)
  }],

  ['超长 URL 拦截', async () => {
    const { res } = await post({ url: 'https://example.com/' + 'a'.repeat(3000) })
    check('超长 URL 400', res.status === 400, `got ${res.status}`)
  }],

  ['非法自定义码格式', async () => {
    const { res } = await post({ url: TARGET, code: 'AB' })
    check('短码格式 400', res.status === 400, `got ${res.status}`)
  }],

  ['系统保留码拦截', async () => {
    const { res, json } = await post({ url: TARGET, code: 'health' })
    check('保留码 400', res.status === 400, `got ${res.status}`)
    check('保留码提示', !!(json && json.error && json.error.includes('保留')), JSON.stringify(json))
  }],

  ['自定义码 302 跳转', async () => {
    const { res } = await call(`/${CUSTOM}`)
    check('跳转 302', res.status === 302, `got ${res.status}`)
    check('Location 正确', res.headers.get('location') === TARGET,
      `got ${res.headers.get('location')}`)
  }],

  ['二次访问仍可跳转', async () => {
    const { res } = await call(`/${CUSTOM}`)
    check('二次跳转 302', res.status === 302, `got ${res.status}`)
  }],

  ['不存在短码 404', async () => {
    const { res } = await call('/zzzzzznotexist')
    check('未知码 404', res.status === 404, `got ${res.status}`)
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  const before = results.length
  try {
    await fn()
  } catch (e) {
    results.push({ name, pass: false, detail: `抛异常: ${e && e.message}` })
  }
  const group = results.slice(before)
  const bad = group.filter((r) => !r.pass)
  const mark = bad.length === 0 ? 'PASS' : 'FAIL'
  if (bad.length) failed++
  console.log(`${mark}  ${name}`)
  for (const b of bad) console.log(`      ✗ ${b.name}: ${b.detail}`)
}

const total = results.length
const passed = results.filter((r) => r.pass).length
console.log(`\n${passed}/${total} 断言通过 · ${failed}/${tests.length} 用例失败 · ${BASE}`)

process.exit(failed === 0 ? 0 : 1)
