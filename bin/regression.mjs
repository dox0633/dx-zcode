#!/usr/bin/env node
/**
 * 纯函数层回归测试（壳外可跑，不依赖 DSH 宿主）。
 * 覆盖：state-store 缓存一致性、isPluginOwnedDir 删除守卫、bindSession 真 LRU、
 * 通道黑名单标记/过期、gateway prompt 转换、welfare 归一化、calllog tokensOf、
 * 验证码 per-plan 求解流（mock getVerification）。
 *
 * 运行：node bin/regression.mjs
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const results = []
const test = async (name, fn) => {
  try {
    await fn()
    results.push(`PASS ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

// 沙盒数据根：把 DSH_WELFARE_BASE 指到临时目录，避免污染真实 ~/.dsh/dx-zcode
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dxz-regression-'))
process.env.DSH_WELFARE_BASE = sandbox

// ── state-store ───────────────────────────────────────────────────────────────
const { DATA_ROOT, readPersistedState, writePersistedState } = await import('../lib/state-store.js')
test('state-store: DATA_ROOT 指向沙盒', () => {
  assert.strictEqual(DATA_ROOT, sandbox)
})
test('state-store: 写后读一致（内存缓存）', () => {
  writePersistedState({ a: { enabled: false } })
  assert.strictEqual(readPersistedState().a.enabled, false)
  // 落盘验证
  const raw = JSON.parse(fs.readFileSync(path.join(sandbox, 'account-state.json'), 'utf8'))
  assert.strictEqual(raw.a.enabled, false)
})

// ── pool.js：删除守卫 / LRU / 通道黑名单 ──────────────────────────────────────
const { isPluginOwnedDir, AccountPool } = await import('../lib/pool.js')
test('A1: 插件自建目录判定为 owned', () => {
  assert.strictEqual(isPluginOwnedDir(path.join(DATA_ROOT, 'accounts', 'zc-123')), true)
  assert.strictEqual(isPluginOwnedDir(path.join(DATA_ROOT, 'shadow', 'abc')), true)
  assert.strictEqual(isPluginOwnedDir(DATA_ROOT), false)
})
test('A1: 外部目录判定为非 owned（删除守卫核心）', () => {
  assert.strictEqual(isPluginOwnedDir('D:\\zcode-backup'), false)
  assert.strictEqual(isPluginOwnedDir('D:\\my accounts\\data'), false, '路径含 accounts 子串但不在 DATA_ROOT 下，必须非 owned')
  assert.strictEqual(isPluginOwnedDir(os.homedir()), false)
  assert.strictEqual(isPluginOwnedDir(''), false)
})
function makePool() {
  return new AccountPool({ options: () => ({}), logger: { info() {}, warn() {} } })
}
test('B5: bindSession 超限按 LRU 只删最旧', () => {
  const pool = makePool()
  for (let i = 0; i < 1100; i++) {
    pool.bindSession(`s${i}`, 'acc')
    pool.sessionBindings.get(`s${i}`).lastUsedAt = i // 人为设定时间序
  }
  assert.strictEqual(pool.sessionBindings.size <= 1000, true)
  // 最旧的 s0.. 被删，最新的 s1099 仍在
  assert.strictEqual(pool.sessionBindings.has('s1099'), true)
  assert.strictEqual(pool.sessionBindings.has('s0'), false)
})
test('B13: 通道黑名单标记与过期', () => {
  const pool = makePool()
  pool.markChannelUnavailable('acc1', 'account:zai-individual-coding-plan', 50)
  assert.strictEqual(pool.isChannelBlacklisted('acc1', 'account:zai-individual-coding-plan'), true)
  assert.strictEqual(pool.isChannelBlacklisted('acc1', 'account:zai-start-plan'), false)
  // 过期：手动把时间戳拨回过去
  pool.channelBlacklist.get('acc1').set('account:zai-individual-coding-plan', Date.now() - 1)
  assert.strictEqual(pool.isChannelBlacklisted('acc1', 'account:zai-individual-coding-plan'), false)
})
test('B13: 黑名单持久化落盘', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(sandbox, 'account-state.json'), 'utf8'))
  assert.ok(raw.__channelBlacklist && raw.__channelBlacklist.acc1, '黑名单应写入 account-state.json')
})
function await0() {}


// ── gateway.js：prompt 转换 ───────────────────────────────────────────────────
const { openAIToPrompt, anthropicToPrompt } = await import('../lib/gateway.js')
test('gateway: openAI 多角色扁平化', () => {
  const p = openAIToPrompt({ messages: [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'U2' },
  ] })
  assert.strictEqual(p, 'S\n\nU1\n\n[assistant]\nA1\n\nU2')
})
test('gateway: anthropic system + content blocks（image 落占位符）', () => {
  const p = anthropicToPrompt({ system: 'S', messages: [{ role: 'user', content: [{ type: 'text', text: 'U' }, { type: 'image', source: {} }] }] })
  assert.strictEqual(p, 'S\n\nU\n[图片]')
})

// ── welfare.js：归一化 + per-plan 验证码流 ────────────────────────────────────
const { normalizeDelivery, resolveApiAppVersion, apiHeaders, survey, claimAll: welfareClaimAll } = await import('../lib/welfare.js')
test('welfare: resolveApiAppVersion 旧版本提升至 4.0.0，高版本保留', () => {
  assert.strictEqual(resolveApiAppVersion(''), '4.0.0')
  assert.strictEqual(resolveApiAppVersion('unknown'), '4.0.0')
  assert.strictEqual(resolveApiAppVersion('3.18.2-47'), '4.0.0')
  assert.strictEqual(resolveApiAppVersion('3.19.0'), '4.0.0')
  assert.strictEqual(resolveApiAppVersion('4.0.0'), '4.0.0')
  assert.strictEqual(resolveApiAppVersion('4.1.2'), '4.1.2')
  const hdrs = apiHeaders({ planToken: 'a.b.c', deviceMid: 'mid' }, '3.18.2-47')
  assert.strictEqual(hdrs['X-ZCode-App-Version'], '4.0.0')
})
test('welfare: normalizeDelivery 提取 plan 卡片', () => {
  const cards = normalizeDelivery({ zcode_plan: { plan_id: 'p1', name: 'N', ends_at: 0, starts_at: 0, entitlements: [{ grant_units: 100, capabilities: ['x'] }] } })
  assert.strictEqual(cards.length, 1)
  assert.strictEqual(cards[0].grantUnits, 100)
})
await test('welfare: survey 429 自动重试并正确识别 3 亿待领包与 GLM-5.4 余额', async () => {
  const realFetch = globalThis.fetch
  let mktTries = 0
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('/marketing/touch')) {
      mktTries++
      if (mktTries === 1) return new Response('', { status: 429 })
      return new Response(JSON.stringify({
        code: 0,
        data: {
          server_time: 1795778540,
          deliveries: [{
            banner: {
              background: {
                args: {
                  zcode_plan: {
                    plan_id: 'zcode-v3-start-plan-1127',
                    name: 'ZCODE WEEKEND BUILD',
                    starts_at: 1795777200,
                    ends_at: 1796000400,
                    entitlements: [{ show_name: 'GLM-5.3-Flash', grant_units: 300000000, effective_at: 1795791600, capabilities: ['model:glm-5.3-flash'] }],
                  },
                },
              },
            },
          }],
        },
      }), { status: 200 })
    }
    if (u.includes('/billing/balance')) {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          server_time: 1795778540,
          plans: [{
            plan_id: 'zcode-v3-start-plan-0817',
            name: 'ZCode Start Plan',
            status: 'active',
            starts_at: 1795778513,
            ends_at: 1796140799,
            entitlements: [
              { show_name: 'GLM-5.4', grant_units: 3000000, effective_at: 0, capabilities: ['model:glm-5.4'] },
              { show_name: 'GLM-5.3-Flash', grant_units: 5000000, effective_at: 0, capabilities: ['model:glm-5.3-flash'] },
            ],
          }],
          balances: [
            { show_name: 'GLM-5.4', total_units: 3000000, available_units: 3000000 },
            { show_name: 'GLM-5.3-Flash', total_units: 5000000, available_units: 5000000 },
          ],
        },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({ code: 0, data: { plans: [] } }), { status: 200 })
  }
  try {
    const snap = await survey({ planToken: 'a.b.c', deviceMid: 'mid' }, '3.18.2-47')
    assert.strictEqual(mktTries, 2, '429 应自动重试')
    assert.strictEqual(snap.notes.length, 0)
    assert.strictEqual(snap.availableUnits, 8000000)
    const p1127 = snap.plans.find((p) => p.planId === 'zcode-v3-start-plan-1127')
    assert.ok(p1127 && p1127.claimable === true && p1127.grantUnits === 300000000)
    assert.deepStrictEqual(p1127.models, ['GLM-5.3-Flash'])
    const p0817 = snap.plans.find((p) => p.planId === 'zcode-v3-start-plan-0817')
    assert.ok(p0817 && p0817.models.includes('GLM-5.4') && p0817.models.includes('GLM-5.3-Flash'))
  } finally {
    globalThis.fetch = realFetch
  }
})
await test('pool: 1004 无资格记忆持久化 + 单个 captchaSession 复用 + clearIneligible', async () => {
  const pool = makePool()
  pool.entries.set('zc-1004', {
    id: 'zc-1004',
    label: '测试号1004',
    source: 'external',
    sourceLabel: '测试',
    dataBaseDir: sandbox,
    sourceRoot: sandbox,
    shadowed: false,
    enabled: true,
    exhausted: false,
    error: '',
    updatedAt: Date.now(),
    account: { id: 'zc-1004', userId: 'u1004', provider: 'bigmodel', cliVersion: '4.0.0', planToken: 'a.b.c', deviceMid: 'mid1' },
    client: null,
    snapshot: null,
  })
  pool.entries.set('zc-ok', {
    id: 'zc-ok',
    label: '测试号OK',
    source: 'external',
    sourceLabel: '测试',
    dataBaseDir: sandbox,
    sourceRoot: sandbox,
    shadowed: false,
    enabled: true,
    exhausted: false,
    error: '',
    updatedAt: Date.now(),
    account: { id: 'zc-ok', userId: 'uok', provider: 'bigmodel', cliVersion: '4.0.0', planToken: 'a.b.c', deviceMid: 'mid2' },
    client: null,
    snapshot: null,
  })

  let sessionCreations = 0
  let solveCalls = 0
  let sessionClosed = 0
  pool.captchaSessionFactory = () => {
    sessionCreations++
    return {
      solveNext: async () => {
        solveCalls++
        return { param: `sess-param-${solveCalls}`, region: 'cn' }
      },
      close: async () => {
        sessionClosed++
      },
    }
  }

  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('/marketing/touch')) {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          server_time: 1795778540,
          deliveries: [{
            banner: {
              zcode_plan: {
                plan_id: 'plan-300m',
                name: 'WEEKEND 300M',
                starts_at: 1795777200,
                ends_at: 1796000400,
                entitlements: [{ show_name: 'GLM-5.3-Flash', grant_units: 300000000, effective_at: 1795791600 }],
              },
            },
          }],
        },
      }), { status: 200 })
    }
    if (u.includes('/billing/balance')) {
      return new Response(JSON.stringify({ code: 0, data: { server_time: 1795778540, plans: [], balances: [] } }), { status: 200 })
    }
    if (u.includes('/billing/claim')) {
      const hdrs = init?.headers || {}
      if (hdrs['X-Device-Mid'] === 'mid1') {
        return new Response(JSON.stringify({ code: 1004, msg: 'no permission' }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 0, message: 'ok' }), { status: 200 })
    }
    return new Response(JSON.stringify({ code: 0, data: { plans: [] } }), { status: 200 })
  }

  try {
    const progressEvents = []
    const res = await pool.claimAll({ onProgress: (e) => progressEvents.push(e) })
    assert.strictEqual(sessionCreations, 1, '多个号只启动 1 个浏览器会话')
    assert.strictEqual(solveCalls, 2, '每个待领号现解一枚验证码')
    assert.strictEqual(sessionClosed, 1, '结束必须关闭复用浏览器会话')
    assert.ok(progressEvents.some((e) => e.phase === 'survey') && progressEvents.some((e) => e.phase === 'claiming'))

    const r1004 = res.find((x) => x.id === 'zc-1004')
    assert.ok(r1004 && r1004.failed.length === 0 && r1004.skipped.some((s) => s.includes('1004')), '1004 归类为已记忆跳过')
    const rOk = res.find((x) => x.id === 'zc-ok')
    assert.ok(rOk && rOk.claimed.length === 1)

    const v1004 = pool.view().find((v) => v.id === 'zc-1004')
    assert.deepStrictEqual(v1004.ineligiblePlans, ['plan-300m'])
    assert.strictEqual(v1004.welfare.plans[0].ineligible, true)
    assert.strictEqual(v1004.welfare.plans[0].claimable, false)

    await pool.clearIneligible('zc-1004')
    const vAfterClear = pool.view().find((v) => v.id === 'zc-1004')
    assert.deepStrictEqual(vAfterClear.ineligiblePlans, [])
    assert.strictEqual(vAfterClear.welfare.plans[0].claimable, true)
  } finally {
    globalThis.fetch = realFetch
  }
})
await test('A4: per-plan getVerification 每活动现取一枚验证码 + 3007 重试', async () => {
  let solved = 0
  const plans = [
    { planId: 'p1', name: 'P1', claimable: true },
    { planId: 'p2', name: 'P2', claimable: true },
  ]
  // mock survey：直接传 precomputed
  const calls = []
  const fakeVerification = {
    getVerification: async () => {
      solved++
      return { captchaVerifyParam: `param-${solved}`, captchaRegion: 'cn' }
    },
  }
  // 替换 fetch：mock claim 端点 —— p1 第一次 3007（param 被消耗），随后成功
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ plan: body.plan_id, param: init.headers['X-Aliyun-Captcha-Verify-Param'] })
    const n = calls.filter((c) => c.plan === body.plan_id).length
    if (body.plan_id === 'p1' && n === 1) {
      return new Response(JSON.stringify({ code: 3007 }), { status: 400 })
    }
    return new Response(JSON.stringify({ code: 0, message: 'ok' }), { status: 200 })
  }
  try {
    const r = await welfareClaimAll({ planToken: 'a.b.c', deviceMid: 'd' }, '3.19.0', fakeVerification, { plans, balances: [], serverTime: 1 })
    assert.deepStrictEqual(r.claimed, ['P1（ok）', 'P2（ok）'])
    // p1 被调用 2 次（3007 重试一次），每次 param 都不同
    const p1calls = calls.filter((c) => c.plan === 'p1')
    assert.strictEqual(p1calls.length, 2)
    assert.notStrictEqual(p1calls[0].param, p1calls[1].param, '重试必须使用新验证码')
    // p2 用的是第三枚（不复用 p1 的）
    const p2param = calls.find((c) => c.plan === 'p2').param
    assert.strictEqual(solved, 3)
    assert.strictEqual(p2param, 'param-3')
  } finally {
    globalThis.fetch = realFetch
  }
})

// ── calllog.js：tokensOf ──────────────────────────────────────────────────────
const { tokensOf } = await import('../lib/calllog.js')
await test('calllog: uncached input 扣减缓存命中', () => {
  const t = tokensOf({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 800, totalTokens: 1900 })
  assert.strictEqual(t.input, 1000, '显式 inputTokens 视为 uncached，不再扣减')
  assert.strictEqual(t.cached, 800)
  assert.strictEqual(t.cacheRate, 44)
})
await test('calllog: input_tokens 含缓存时扣减', () => {
  const t = tokensOf({ input_tokens: 1800, output_tokens: 100, cache_read_tokens: 800 })
  assert.strictEqual(t.input, 1000)
})

// ── direct-channel.js：版本门禁抬升 + 非 SSE JSON 显式归因 + CRLF SSE ──────────
const { buildDirectHeaders, streamDirectCall } = await import('../lib/direct-channel.js')
await test('direct-channel: 默认及旧版本请求头抬升至 >= 4.0.0', () => {
  const hDefault = buildDirectHeaders({ planToken: 'p', deviceMid: 'm' })
  assert.strictEqual(hDefault['X-ZCode-App-Version'], '4.0.0')
  assert.ok(hDefault['user-agent'].startsWith('ZCode/4.0.0 '))
  const hOld = buildDirectHeaders({ planToken: 'p', deviceMid: 'm' }, '3.18.2-47')
  assert.strictEqual(hOld['X-ZCode-App-Version'], '4.0.0')
  const hNew = buildDirectHeaders({ planToken: 'p', deviceMid: 'm' }, '4.2.1')
  assert.strictEqual(hNew['X-ZCode-App-Version'], '4.2.1')
})
await test('direct-channel: 非 SSE JSON 显式抛错 + CRLF SSE 正常解析', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"code":0,"msg":"","logid":"abc"}', {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
  try {
    let caught = null
    try {
      for await (const _ of streamDirectCall({ planToken: 'p', deviceMid: 'm', modelId: 'GLM-5.3-Flash', messages: [{ role: 'user', content: 'hi' }] })) {}
    } catch (e) {
      caught = e
    }
    assert.ok(caught && caught.message.includes('非 SSE 响应') && caught.message.includes('abc'))

    const sseBody = [
      'event: message_start\r\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\r\n\r\n',
      'event: content_block_start\r\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n',
      'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}\r\n\r\n',
      'event: message_delta\r\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\r\n\r\n',
      'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n',
    ].join('')
    globalThis.fetch = async () => new Response(sseBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
    const chunks = []
    for await (const c of streamDirectCall({ planToken: 'p', deviceMid: 'm', modelId: 'GLM-5.3-Flash', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(c)
    }
    assert.ok(chunks.some((c) => c.type === 'text-delta' && c.text === 'OK'))
    assert.ok(chunks.some((c) => c.type === 'finish' && c.reason?.kind === 'stop'))
  } finally {
    globalThis.fetch = realFetch
  }
})

console.log(results.join('\n'))
console.log(process.exitCode ? '\n== 存在失败 ==' : '\n== 全部通过 ==')
