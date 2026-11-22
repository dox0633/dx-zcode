#!/usr/bin/env node
/**
 * 一键回滚：把 dx-zcode 从 DSH profile 中完全移除。
 *
 * 用于万一重启后 DSH 起不来时恢复。执行后重启 DSH 即回到安装前状态。
 *
 * 用法：
 *   node bin/rollback.mjs           # 只移除插件注册
 *   node bin/rollback.mjs --purge   # 同时删除影子目录与调用记录
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const profile = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
const pkgPath = path.join(profile, 'package.json')
const pluginDir = path.join(profile, 'node_modules', 'dx-zcode')
const shadowDir = path.join(os.homedir(), '.dsh', 'dx-zcode')

const purge = process.argv.includes('--purge')

console.log('\n=== dx-zcode 回滚 ===\n')

// ① 从 dependencies 与 bundles 移除
try {
  const raw = fs.readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(raw)
  let changed = false
  if (pkg.dependencies?.['dx-zcode'] !== undefined) {
    delete pkg.dependencies['dx-zcode']
    changed = true
    console.log('  ✓ 已从 dependencies 移除')
  }
  if (Array.isArray(pkg.dsh?.profile?.bundles)) {
    const before = pkg.dsh.profile.bundles.length
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== 'dx-zcode')
    if (pkg.dsh.profile.bundles.length !== before) {
      changed = true
      console.log('  ✓ 已从 dsh.profile.bundles 移除')
    }
  }
  if (changed) {
    // 原子写：先备份再替换
    fs.copyFileSync(pkgPath, `${pkgPath}.bak-dx-zcode`)
    const tmp = `${pkgPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, pkgPath)
    console.log(`  ✓ package.json 已更新（备份：package.json.bak-dx-zcode）`)
  } else {
    console.log('  · 未发现插件注册，无需改动')
  }
} catch (error) {
  console.log(`  ✗ 更新 package.json 失败：${error instanceof Error ? error.message : String(error)}`)
}

// ② 删除安装目录
try {
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true })
    console.log('  ✓ 已删除 node_modules/dx-zcode')
  } else {
    console.log('  · 安装目录不存在')
  }
} catch (error) {
  console.log(`  ✗ 删除安装目录失败：${error instanceof Error ? error.message : String(error)}`)
}

// ③ 可选清理影子目录
if (purge) {
  try {
    if (fs.existsSync(shadowDir)) {
      fs.rmSync(shadowDir, { recursive: true, force: true })
      console.log('  ✓ 已删除影子目录 ~/.dsh/dx-zcode')
    }
  } catch (error) {
    console.log(`  ✗ 删除影子目录失败：${error instanceof Error ? error.message : String(error)}`)
  }
} else {
  console.log('  · 保留影子目录（加 --purge 可删除）')
  console.log('    注意：原始 ZCode 目录从未被修改，删除影子目录不影响 ZCode 客户端')
}

console.log('\n=== 回滚完成，重启 DSH 即回到安装前状态 ===\n')
