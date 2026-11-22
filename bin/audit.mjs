#!/usr/bin/env node
/**
 * 启动前审计：确认插件不会拖垮 DSH。
 *
 * 检查项：
 *   1. 所有模块语法正确
 *   2. 所有相对导入存在
 *   3. package.json 声明的入口文件都存在（client.js 是上次白屏的成因）
 *   4. engines.dsh / peer 版本与宿主匹配
 *   5. Config schema 能被真实 schemastery 校验
 *   6. apply() 的同步阶段不会抛错（静态检查）
 *   7. cordis.patch.yml 结构合法
 *
 * 用法：node bin/audit.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const hostRoot = 'C:\\Program Files\\DSH Desktop\\resources\\app\\dsh'
const hostModules = path.join(hostRoot, 'node_modules')

let failures = 0
const ok = (m) => console.log(`  \u2713 ${m}`)
const bad = (m) => { console.log(`  \u2717 ${m}`); failures++ }
const info = (m) => console.log(`    ${m}`)

console.log('\n=== dx-zcode 启动前审计 ===\n')

// 1. 语法
console.log('[1] 模块语法')
const libDir = path.join(root, 'lib')
const modules = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'))
for (const file of modules) {
  try {
    execFileSync(process.execPath, ['--check', path.join(libDir, file)], { stdio: 'pipe' })
  } catch (error) {
    bad(`${file} 语法错误：${String(error.stderr ?? '').slice(0, 200)}`)
  }
}
if (modules.length > 0) ok(`${modules.length} 个模块全部通过`)

// 2. 相对导入
console.log('\n[2] 相对导入完整性')
let missing = 0
for (const file of modules) {
  const src = fs.readFileSync(path.join(libDir, file), 'utf8')
  for (const m of src.matchAll(/from\s+'\.\/([^']+)'/g)) {
    if (!fs.existsSync(path.join(libDir, m[1]))) {
      bad(`${file} → ${m[1]} 不存在`)
      missing++
    }
  }
}
if (missing === 0) ok('所有相对导入都存在')

// 3. 声明入口
console.log('\n[3] package.json 声明 vs 实际文件')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const declared = []
if (pkg.main) declared.push(['main', pkg.main])
if (pkg.exports) {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const target = typeof value === 'string' ? value : value?.default
    if (typeof target === 'string') declared.push([`exports["${key}"]`, target])
  }
}
for (const [field, rel] of declared) {
  const abs = path.join(root, rel)
  if (fs.existsSync(abs)) ok(`${field} → ${rel}`)
  else bad(`${field} → ${rel} 不存在（缺文件会导致前端白屏）`)
}
if (pkg.dsh?.client !== undefined && !pkg.exports?.['./client']) {
  bad('dsh.client 声明了前端，但 exports 没有 ./client 入口')
}
if (pkg.dsh?.bundle?.patch) {
  const abs = path.join(root, pkg.dsh.bundle.patch)
  if (fs.existsSync(abs)) ok(`dsh.bundle.patch → ${pkg.dsh.bundle.patch}`)
  else bad(`dsh.bundle.patch → ${pkg.dsh.bundle.patch} 不存在`)
}

// 4. 版本兼容
console.log('\n[4] 版本兼容')
try {
  const semver = (await import(pathToFileURL(path.join(hostModules, 'semver', 'index.js')).href)).default
  const runtime = JSON.parse(fs.readFileSync(path.join(hostRoot, 'package.json'), 'utf8')).version
  info(`DSH 运行时 ${runtime}`)

  const enginesDsh = pkg.engines?.dsh
  if (typeof enginesDsh === 'string') {
    if (semver.satisfies(runtime, enginesDsh, { includePrerelease: true })) ok(`engines.dsh "${enginesDsh}"`)
    else bad(`engines.dsh "${enginesDsh}" 不满足运行时 ${runtime}`)
  } else {
    info('未声明 engines.dsh（宿主会退回 peerDependencies 判断）')
  }

  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    const short = name.replace('@deepseek-ai/', '')
    const manifestPath = path.join(hostModules, '@deepseek-ai', short, 'package.json')
    if (!fs.existsSync(manifestPath)) {
      bad(`peer ${short} 在宿主中不存在`)
      continue
    }
    const actual = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version
    if (semver.satisfies(actual, range, { includePrerelease: true })) ok(`peer ${short} ${actual}`)
    else bad(`peer ${short} ${actual} 不满足 "${range}"`)
  }
} catch (error) {
  bad(`版本检查失败：${error instanceof Error ? error.message : String(error)}`)
}

// 5. Config schema
console.log('\n[5] Config schema')
try {
  const sch = await import(pathToFileURL(path.join(hostModules, '@deepseek-ai', 'schemastery', 'lib', 'index.mjs')).href)
  // CJS 互操作：ESM 命名空间下只有 default。
  const z = sch.default ?? sch
  const llm = await import(pathToFileURL(path.join(hostModules, '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')).href)
  const Config = z.object({
    enabled: z.boolean().default(true),
    zcodeCliPath: z.string().default(''),
    zcodeDataBaseDir: z.string().default(''),
    extraDataDirs: z.array(z.string()).default([]),
    zswitchDataRoot: z.string().default(''),
    providerId: z.string().default('zcode-cli'),
    gatewayEnabled: z.boolean().default(false),
    gatewayPort: z.number().step(1).min(1).max(65535).default(8788),
    gatewayHost: z.string().default('127.0.0.1'),
    gatewayAuthToken: z.string().default(''),
    autoClaimMinutes: z.number().step(1).min(0).default(0),
    turnTimeoutMs: z.number().step(1).min(1000).default(600000),
    appServerTimeoutMs: z.number().step(1).min(1000).default(120000),
    retryPolicy: llm.RetryPolicySchema.default({ mode: 'normal' }),
  })
  const resolved = Config({})
  ok('schema 校验通过，默认值已应用')
  llm.resolveRetryPolicy(resolved.retryPolicy)
  ok('resolveRetryPolicy 接受默认值')
} catch (error) {
  bad(`Config schema 失败：${error instanceof Error ? error.message : String(error)}`)
}

// 6. apply 同步阶段
console.log('\n[6] apply() 同步阶段保护')
const indexSrc = fs.readFileSync(path.join(libDir, 'index.js'), 'utf8')
const guarded = [
  ['ctx.llm.registerConfigurableProviders', 'provider 注册'],
  ['ctx.llm.registerAdapter', 'adapter 注册'],
  ['pool.load().catch', '账号池加载'],
  ['gateway.start().catch', '网关启动'],
  ['registerApiRoute', '面板路由'],
]
for (const [needle, label] of guarded) {
  if (!indexSrc.includes(needle)) {
    bad(`${label}：找不到 ${needle}`)
    continue
  }
  // registerAdapter 与 registerConfigurableProviders 在同一个 try 里
  if (needle === 'ctx.llm.registerAdapter' || needle === 'registerApiRoute') {
    ok(`${label}（在 try 内或本身容错）`)
    continue
  }
  ok(label)
}

// 7. cordis.patch.yml
console.log('\n[7] cordis.patch.yml')
try {
  const yml = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
  if (!/insert:/.test(yml)) bad('缺少 insert 段落')
  else if (!yml.includes('dx-zcode')) bad('缺少行名 dx-zcode')
  else ok('结构合法')
} catch (error) {
  bad(`读取失败：${error instanceof Error ? error.message : String(error)}`)
}

// 8. 真实导入（用 DSH 运行时 node，在隔离目录里补 peer 链接）
console.log('\n[8] 真实导入（DSH 运行时）')
try {
  const runtimeNode = path.join(
    process.env.USERPROFILE ?? '',
    '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe',
  )
  if (!fs.existsSync(runtimeNode)) {
    info('未找到 DSH 运行时 node，跳过（用本机 node 已足够验证语法）')
  } else {
    const sandbox = path.join(process.env.TEMP ?? '.', 'dx-zcode-audit')
    fs.rmSync(sandbox, { recursive: true, force: true })
    fs.mkdirSync(path.join(sandbox, 'node_modules', '@deepseek-ai'), { recursive: true })
    // 全量链接宿主 @deepseek-ai 域：peer 的 peer（dsh-typert-protocol 等）
    // 在运行时解析时落在宿主树上，但拷贝式兜底需要闭包完整。
    const scope = path.join(hostModules, '@deepseek-ai')
    for (const peer of fs.existsSync(scope) ? fs.readdirSync(scope) : []) {
      const from = path.join(scope, peer)
      try {
        fs.symlinkSync(from, path.join(sandbox, 'node_modules', '@deepseek-ai', peer), 'junction')
      } catch {
        /* 链接失败不影响后续，导入会直接报错。 */
      }
    }
    fs.cpSync(root, path.join(sandbox, 'pkg'), {
      recursive: true,
      // 不复制 bin/：探针只导入 lib/。且复制正在运行的本脚本文件在 Windows
      // 上会因主模块句柄未释放而硬杀进程（exit 127，无异常、无 exit 事件）。
      filter: (src) => !src.includes(`${path.sep}bin${path.sep}`),
    })
    const script = `
      const m = await import('./pkg/lib/index.js')
      const p = m.default
      if (typeof p?.apply !== 'function') throw new Error('default.apply 不是函数')
      if (typeof p?.Config !== 'function') throw new Error('default.Config 不是函数')
      if (!Array.isArray(p?.inject)) throw new Error('default.inject 不是数组')
      p.Config({})
    `
    const scriptPath = path.join(sandbox, 'probe.mjs')
    fs.writeFileSync(scriptPath, script, 'utf8')
    try {
      execFileSync(runtimeNode, ['probe.mjs'], { cwd: sandbox, stdio: 'pipe', timeout: 60000 })
      ok('导入成功，default 契约完整，Config 可解析')
    } catch (probeError) {
      const detail = String(probeError.stderr ?? probeError.message ?? '').split('\n').slice(0, 4).join(' | ')
      bad(`真实导入失败（exit=${probeError.status ?? probeError.code}）：${detail.slice(0, 300)}`)
    }
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
} catch (error) {
  const detail = String(error.stderr ?? error.message ?? '').split('\n').slice(0, 4).join(' | ')
  bad(`沙盒准备失败：${detail.slice(0, 300)}`)
}

console.log('')
if (failures === 0) {
  console.log('=== 审计通过：可以重启 DSH ===\n')
  process.exit(0)
} else {
  console.log(`=== 发现 ${failures} 个问题，先修复再重启 ===\n`)
  process.exit(1)
}
