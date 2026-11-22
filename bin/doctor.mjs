#!/usr/bin/env node
/**
 * 自检脚本：验证插件的每一层是否就绪。
 *
 * 用法：
 *   node bin/doctor.mjs
 *
 * 输出不包含任何 token 明文。
 */

import fs from 'node:fs'
import path from 'node:path'
import { locateCli, readAccount, resolveDataBaseDir, credentialPaths, describeAccount } from '../lib/credentials.js'
import { shadowRoot } from '../lib/family-alias.js'
import { survey } from '../lib/welfare.js'
import { findBrowser, cachedCaptcha } from '../lib/captcha.js'

const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => console.log(`  ✗ ${m}`)
const info = (m) => console.log(`    ${m}`)

console.log('\n=== dx-zcode 自检 ===\n')

// ① CLI
console.log('[1] ZCode CLI')
let cli = null
try {
  cli = locateCli(process.env.ZCODE_CLI_PATH ?? '')
  ok(`找到 ${cli.path}`)
  info(`版本 ${cli.version}`)
  info(`builtin provider: ${cli.hasBuiltin ? '有（可解析账号通道）' : '无（账号通道不可用）'}`)
  if (!cli.hasBuiltin) bad('这个内核没有 provider/zcode-builtin.json，start-plan 通道解析不出来。请 npm i -g zcode-app-cli')
} catch (e) {
  bad(e.message)
}

// ② 数据根与凭据
console.log('\n[2] 账号凭据')
let account = null
try {
  const root = resolveDataBaseDir('')
  info(`数据根 ${root}`)
  const paths = credentialPaths(root)
  info(`凭据文件 ${paths.credentials}${fs.existsSync(paths.credentials) ? '' : '（不存在）'}`)
  account = readAccount({ dataBaseDir: root, cliPath: process.env.ZCODE_CLI_PATH ?? '' })
  const d = describeAccount(account)
  ok(`账号 ${d.id}`)
  info(`登录家族 ${d.provider}${d.provider === 'zai_cn' ? '（国内站 → 需要影子通道）' : ''}`)
  info(`plan JWT ${account.planToken.length} 字符 / ${account.planToken.split('.').length} 段`)
  info(`设备标识 ${account.deviceMid.slice(0, 8)}…`)
} catch (e) {
  bad(`${e.code ?? ''} ${e.message}`)
}

// ③ 影子通道
console.log('\n[3] 影子通道（family 改写）')
if (account !== null) {
  const shadow = shadowRoot(account.dataBaseDir.startsWith(path.join(path.sep)) ? account.dataBaseDir : resolveDataBaseDir(''))
  if (fs.existsSync(path.join(shadow, '.zcode', 'v2', 'credentials.json'))) {
    ok(`已建 ${shadow}`)
  } else {
    info('尚未创建（首次加载账号池时自动生成）')
  }
}

// ④ 福利
console.log('\n[4] 福利探测')
if (account !== null) {
  try {
    const s = await survey(account, account.cliVersion)
    ok(`可领 ${s.plans.filter((p) => p.claimable).length} / 已领 ${s.plans.filter((p) => p.claimed).length}`)
    info(`已生效 ${s.availableUnits.toLocaleString()} / 待生效 ${s.pendingUnits.toLocaleString()}`)
    for (const p of s.plans) {
      const tag = p.claimable ? '可领' : p.claimed ? '已领' : '其它'
      info(`[${tag}] ${p.name} 授予 ${p.grantUnits.toLocaleString()}${p.effectiveAt ? ' 生效 ' + new Date(p.effectiveAt * 1000).toLocaleString('zh-CN') : ''}`)
    }
    for (const n of s.notes) info(`注意：${n}`)
  } catch (e) {
    bad(e.message)
  }
}

// ⑤ 验证码
console.log('\n[5] 验证码求解器')
const browser = findBrowser()
if (browser === '') bad('没找到 Chromium（Edge / Chrome），领取与模型通道都用不了')
else ok(`浏览器 ${browser}`)
const cached = cachedCaptcha()
info(cached === null ? '当前无缓存（需要时自动求解）' : `缓存中，${cached.param.length} 字节`)

console.log('\n=== 自检结束 ===\n')
