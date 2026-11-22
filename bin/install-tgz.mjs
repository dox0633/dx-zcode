#!/usr/bin/env node
/**
 * 正式安装器：把 dx-zcode 打包成 .tgz，落入持久 pkgs 库，
 * 以 file:<tgz> 依赖装进 DSH desktop profile，并注册 bundle。
 *
 * 与 dsh-purge-community 的自更新器同一模式 —— 该形态在插件管理器
 * 的对账机制下长期存活（目录型 file: 依赖曾被清理，tgz 型从未）。
 *
 * 幂等：重复运行只更新 tgz 与依赖指向，不改其他字段。
 * 原子写 manifest，先备份。
 *
 * 用法：
 *   node bin/install-tgz.mjs            # 打包 + 安装 + 校验
 *   node bin/install-tgz.mjs --skip-pack   # 复用已有 tgz（已入持久库）
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SRC = path.resolve(import.meta.dirname, "..");
const PKG = JSON.parse(fs.readFileSync(path.join(SRC, "package.json"), "utf8"));
const NAME = PKG.name;
const PROFILE = process.env.DSH_WELFARE_PROFILE
  ?? path.join(os.homedir(), ".dsh", "profiles", "desktop");
const BASE = process.env.DSH_WELFARE_BASE
  ?? path.join(os.homedir(), ".dsh", "dx-zcode");

const log = (msg) => process.stdout.write(msg + "\n");
const die = (msg) => { process.stderr.write(msg + "\n"); process.exit(1); };

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) die(`${cmd} ${args.join(" ")} 失败 (exit ${r.status})\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function atomicWrite(file, text) {
  fs.writeFileSync(file, text);
}

// ── 1. 打包 ────────────────────────────────────────────────────────────
let tgz;
if (process.argv.includes("--skip-pack")) {
  const prev = process.env.DSH_WELFARE_TGZ;
  if (!prev || !fs.existsSync(prev)) die("--skip-pack 需要 DSH_WELFARE_TGZ 指向已有 tgz");
  tgz = prev;
} else {
  log("[1/5] npm pack ...");
  const out = sh("npm", ["pack", "--pack-destination", SRC], SRC);
  tgz = path.join(SRC, out.trim().split("\n").at(-1).trim());
  if (!fs.existsSync(tgz)) die(`打包产物缺失: ${tgz}`);
}
log(`      tgz: ${tgz} (${fs.statSync(tgz).size} bytes)`);

// ── 2. 持久 pkgs 库 ────────────────────────────────────────────────────
const hash = createHash("sha256").update(fs.readFileSync(tgz)).digest("hex");
const stable = path.join(BASE, "pkgs", hash);
fs.mkdirSync(stable, { recursive: true, mode: 0o700 });
const keep = path.join(stable, path.basename(tgz));
if (path.resolve(tgz) !== path.resolve(keep)) fs.copyFileSync(tgz, keep);
const fileUrl = "file:" + keep.replace(/\\/g, "/");
log(`[2/5] 持久库: ${keep}`);
log(`      依赖 spec: ${fileUrl}`);

// ── 3. manifest 原子更新 ───────────────────────────────────────────────
const manifestFile = path.join(PROFILE, "package.json");
const raw = fs.readFileSync(manifestFile, "utf8");
const manifest = JSON.parse(raw);
const backup = manifestFile + ".bak-welfare-tgz-" + new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(manifestFile, backup);
log(`[3/5] 备份: ${backup}`);

manifest.dependencies ??= {};
// 迁移清理：旧身份（dsh-zcode-welfare）的依赖与 bundle 一并移除
const LEGACY_NAMES = ["dsh-zcode-welfare"];
for (const legacy of LEGACY_NAMES) {
  if (legacy === NAME) continue;
  delete manifest.dependencies[legacy];
  if (Array.isArray(manifest.dsh?.profile?.bundles)) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((b) => b !== legacy);
  }
}
manifest.dependencies[NAME] = fileUrl;
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
const bundles = manifest.dsh.profile.bundles ?? [];
if (!bundles.includes(NAME)) manifest.dsh.profile.bundles = [...bundles, NAME];
atomicWrite(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
log(`      bundles: ${manifest.dsh.profile.bundles.join(", ")}`);

// ── 4. pnpm install ────────────────────────────────────────────────────
log("[4/5] pnpm install（profile 内）...");
sh("pnpm", ["install"], PROFILE);

// ── 5. 校验 ────────────────────────────────────────────────────────────
const installedPkg = path.join(PROFILE, "node_modules", NAME, "package.json");
if (!fs.existsSync(installedPkg)) die(`✗ 安装后未找到 ${installedPkg}`);
const installed = JSON.parse(fs.readFileSync(installedPkg, "utf8"));
if (installed.name !== NAME) die(`✗ 包名不符: ${installed.name}`);
if (installed.dsh?.bundle?.patch === undefined) die("✗ 安装副本缺少 dsh.bundle.patch —— 不会被当作 profile layer");
log(`[5/5] 已安装 ${installed.name}@${installed.version}`);
log(`      dsh.bundle.patch: ${installed.dsh.bundle.patch}`);

// ── 6. 定位并持久化 CLI 内核 ───────────────────────────────────────────
// 安装器跑在完整环境里（PATH/ProgramFiles 齐全）；DSH 运行时进程环境受限，
// locateCli 在那里可能找不到 —— 这里发现的路径会被写进 cli-path.json，
// 运行时把它作为首选候选直接命中。
try {
  const { locateCli } = await import("../lib/credentials.js");
  const cli = locateCli("");
  log(`[6/6] CLI 内核已持久化: ${cli.path} (v${cli.version}, builtin=${cli.hasBuiltin})`);
} catch (e) {
  log(`[6/6] ⚠ CLI 定位失败（登录与模型通道将不可用）: ${e instanceof Error ? e.message : String(e)}`);
}
log("✓ 完成。重启 DSH 生效（运行中的实例可能经 HMR 热加载，无需重启即可生效）。");
