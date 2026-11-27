// @ts-check
/**
 * DSH 桌面端渲染进程扩展（设置面板 UI / WebUI）
 *
 * 暗黑五色极简紧凑版（方案 C）：
 * - 色彩严格限定：黑 / 白 / 暗金 / 大红 / 绿
 * - 保留原生 ZCode SVG LOGO，突出「一键探测福利」与「一键领取福利」
 * - 福利四要素明晰：专属模型 / 生效时间 / 过期时间 / 已用与剩余量
 * - 支持「按账号（可折叠紧致行）」与「按福利包聚合」双视角切换
 * - 适配 DSH 500px–555px 窄容器，5 列自适应调用记录，异步全领实时进度与战报
 */

window.__ModuleLoader__.load({
  id: 'dx-zcode',
  factory: (require) => {
    const React = require('react')

    const messages = {
      zh: {
        title: 'DX Zcode',
        intro: '多账号池 · 福利聚合 · 官方直连网关',
        refresh: '刷新状态',
        loading: '正在连接服务…',
        unavailable: '面板暂不可用：后端接口未响应，请检查插件状态。',

        tabAccounts: '福利与额度',
        tabGateway: '转发网关',
        tabLogs: '调用记录',

        accountsTitle: '账号与福利聚合',
        accountsEmpty: '暂未添加任何账号，请点击上方「国内站」或「国际站」授权接入。',
        loginCn: '国内站',
        loginGlobal: '国际站',
        claimAll: '一键领取福利',
        detectWelfare: '一键探测福利',
        claiming: '正在探测各账号待领福利…',
        claimResult: '领取战报',
        claimNone: '当前暂无需要领取的新福利。',
        refreshQuota: '刷新',

        metricActive: '活跃账号',
        metricTotalQuota: '可用余额',
        metricPendingQuota: '待生效',
        metricModelsCount: '官方模型',

        sourceDesktop: '桌面端',
        sourceLoginRoot: '托管登录',
        sourceDual: '双通道',
        providerCn: '国内站',
        providerGlobal: '国际站',
        providerDual: '双通道',
        providerBigmodel: '国内站',
        providerUnknown: '官方渠道',
        enabled: '已启用',
        disabled: '已停用',
        availableTokens: '可用余额',
        welfareExpireTime: '过期时间',
        pendingTokens: '待生效',
        planDetails: '福利明细',
        noPlans: '暂无福利明细',
        planRemaining: '剩余',
        effectiveAt: '生效',
        expiresAt: '过期',
        planClaimed: '生效中',
        planClaimable: '待领取',

        modelsTitle: 'ZCode 官方专属模型',
        modelsDesc: '指定转发网关默认路由模型（GLM-5.3-Flash 优先消耗大额活动包）。',
        modelsSearch: '过滤模型名…',
        modelsEmpty: '无匹配模型',
        setDefaultModel: '设为默认',
        currentDefaultModel: '当前默认',

        gateway: '转发网关',
        gatewayHeroOn: '运行中',
        gatewayHeroOff: '已停止',
        endpointOpenAI: 'OpenAI 兼容端点',
        endpointAnthropic: 'Anthropic 原生端点',
        copy: '复制',
        copied: '已复制',

        logsTitle: '调用审计记录',
        logsEmpty: '暂无调用审计记录',
        clearLogs: '清空全部',
        clearFailed: '清空异常',
        refreshLogs: '刷新',

        version: '版本',
        cli: 'CLI',
        cliMissing: '托管直连',
        failed: '操作失败',
      },
    }

    const CSS_ID = 'dx-zcode/panel-compact-fivecolor-v10'
    const PANEL_CSS = `
.dxz-ios-root {
  --dxz-bg: #101115;
  --dxz-surface: #16181e;
  --dxz-inset: #1c1e26;
  --dxz-border: #282b35;
  --dxz-border-strong: #3a3e4d;

  --dxz-white: #f5f5f5;
  --dxz-gray: #b4b4bd;
  --dxz-dim: #82828d;

  --dxz-gold: #c9a24d;
  --dxz-gold-bg: rgba(201, 162, 77, 0.13);
  --dxz-gold-border: rgba(201, 162, 77, 0.4);

  --dxz-green: #22c55e;
  --dxz-green-bg: rgba(34, 197, 94, 0.13);
  --dxz-green-border: rgba(34, 197, 94, 0.36);

  --dxz-red: #ef4444;
  --dxz-red-bg: rgba(239, 68, 68, 0.13);
  --dxz-red-border: rgba(239, 68, 68, 0.38);

  --dxz-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow-x: hidden;
  padding: 14px 16px 18px;
  color: var(--dxz-white);
  background: var(--dxz-bg);
  border-radius: 12px;
  border: 1px solid var(--dxz-border);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
.dxz-ios-root *, .dxz-ios-root *::before, .dxz-ios-root *::after {
  box-sizing: border-box;
}
.dxz-num {
  font-variant-numeric: tabular-nums;
}

/* 顶部品牌与双核心按钮 */
.dxz-head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}
.dxz-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.dxz-logo-box {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: linear-gradient(145deg, #2b2d36 0%, #16171d 100%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.dxz-brand-text {
  min-width: 0;
  line-height: 1.3;
}
.dxz-brand-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--dxz-white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dxz-brand-sub {
  font-size: 12px;
  color: var(--dxz-dim);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dxz-btn-grp {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.dxz-btn-probe {
  background: var(--dxz-inset);
  color: var(--dxz-white);
  border: 1px solid var(--dxz-border-strong);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s, background 0.15s;
}
.dxz-btn-probe:hover:not(:disabled) {
  border-color: var(--dxz-gray);
  background: #232631;
}
.dxz-btn-probe:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dxz-btn-claim {
  background: var(--dxz-gold);
  color: #09090b;
  border: 1px solid var(--dxz-gold);
  border-radius: 8px;
  padding: 6px 13px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background 0.15s;
}
.dxz-btn-claim:hover:not(:disabled) {
  background: #d6b25e;
  border-color: #d6b25e;
}
.dxz-btn-claim:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.dxz-claim-pill {
  background: #09090b;
  color: var(--dxz-gold);
  border-radius: 999px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 700;
}

/* 页签与单行汇总栏 */
.dxz-tab-summary-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--dxz-border);
}
.dxz-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dxz-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 7px;
  font-size: 12.5px;
  background: transparent;
  color: var(--dxz-gray);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}
.dxz-tab-btn:hover {
  color: var(--dxz-white);
}
.dxz-tab-btn.active {
  background: var(--dxz-inset);
  color: var(--dxz-white);
  border-color: var(--dxz-border-strong);
  font-weight: 600;
}
.dxz-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.dxz-dot.green { background: var(--dxz-green); }
.dxz-dot.dim { background: var(--dxz-dim); }
.dxz-dot.gold { background: var(--dxz-gold); }
.dxz-dot.red { background: var(--dxz-red); }

.dxz-summary-inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 12.5px;
  color: var(--dxz-gray);
}
.dxz-summary-inline strong {
  font-weight: 700;
}

/* 提示条与异步进度战报 */
.dxz-notice-bar {
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  margin-bottom: 10px;
  word-break: break-word;
}
.dxz-notice-bar.green {
  background: var(--dxz-green-bg);
  color: var(--dxz-green);
  border: 1px solid var(--dxz-green-border);
}
.dxz-notice-bar.gold {
  background: var(--dxz-gold-bg);
  color: var(--dxz-gold);
  border: 1px solid var(--dxz-gold-border);
}
.dxz-notice-bar.red {
  background: var(--dxz-red-bg);
  color: var(--dxz-red);
  border: 1px solid var(--dxz-red-border);
}

.dxz-job-card {
  background: var(--dxz-surface);
  border: 1px solid var(--dxz-gold);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.dxz-job-card.done {
  border-color: var(--dxz-border-strong);
}
.dxz-job-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  margin-bottom: 7px;
}
.dxz-track {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.09);
  border-radius: 99px;
  overflow: hidden;
}
.dxz-track-fill {
  height: 100%;
  border-radius: 99px;
  transition: width 0.25s ease;
}
.dxz-report-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}
.dxz-report-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--dxz-inset);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}

/* 徽章（仅 4 种语义：暗金 / 绿 / 大红 / 灰） */
.dxz-tag {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 20px;
  padding: 1px 8px;
  border-radius: 5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.dxz-tag.gold {
  background: var(--dxz-gold-bg);
  color: var(--dxz-gold);
  border: 1px solid var(--dxz-gold-border);
}
.dxz-tag.green {
  background: var(--dxz-green-bg);
  color: var(--dxz-green);
  border: 1px solid var(--dxz-green-border);
}
.dxz-tag.red {
  background: var(--dxz-red-bg);
  color: var(--dxz-red);
  border: 1px solid var(--dxz-red-border);
}
.dxz-tag.gray {
  background: rgba(255, 255, 255, 0.05);
  color: var(--dxz-gray);
  border: 1px solid var(--dxz-border-strong);
}

/* 次级工具栏 */
.dxz-subbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.dxz-subbar-grp {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dxz-seg {
  display: inline-flex;
  background: var(--dxz-surface);
  border: 1px solid var(--dxz-border);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
}
.dxz-seg-btn {
  border: none;
  background: transparent;
  color: var(--dxz-gray);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
}
.dxz-seg-btn.active {
  background: var(--dxz-gold);
  color: #09090b;
  font-weight: 600;
}
.dxz-mini-btn {
  background: var(--dxz-surface);
  color: var(--dxz-gray);
  border: 1px solid var(--dxz-border);
  border-radius: 7px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.dxz-mini-btn:hover:not(:disabled) {
  color: var(--dxz-white);
  border-color: var(--dxz-border-strong);
}
.dxz-mini-btn.active {
  color: var(--dxz-gold);
  border-color: var(--dxz-gold-border);
  background: var(--dxz-gold-bg);
}
.dxz-mini-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 方案 C 统一细线表容器（舒展间距 + 标准可读字号） */
.dxz-list-panel {
  background: var(--dxz-surface);
  border: 1px solid var(--dxz-border);
  border-radius: 10px;
  overflow: hidden;
}
.dxz-acc-item {
  padding: 12px 14px;
  border-top: 1px solid var(--dxz-border);
}
.dxz-acc-item:first-child {
  border-top: none;
}
.dxz-acc-item.disabled {
  opacity: 0.55;
}
.dxz-acc-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  min-height: 26px;
}
.dxz-acc-head-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}
.dxz-acc-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--dxz-white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dxz-acc-id {
  font-size: 11.5px;
  font-family: var(--dxz-mono);
  color: var(--dxz-dim);
  white-space: nowrap;
}
.dxz-acc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.dxz-link-btn {
  background: transparent;
  border: 1px solid var(--dxz-border);
  border-radius: 5px;
  color: var(--dxz-gray);
  font-size: 12px;
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.dxz-link-btn:hover:not(:disabled) {
  color: var(--dxz-white);
  border-color: var(--dxz-border-strong);
}
.dxz-link-btn.gold {
  border-color: var(--dxz-gold-border);
  color: var(--dxz-gold);
  background: var(--dxz-gold-bg);
}
.dxz-link-btn.red {
  border-color: var(--dxz-red-border);
  color: var(--dxz-red);
}
.dxz-link-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 折叠摘要胶囊行 */
.dxz-pill-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

/* 展开后紧致双行福利明细 */
.dxz-welfare-list {
  margin-top: 10px;
}
.dxz-welfare-row {
  padding: 8px 0 9px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
}
.dxz-welfare-row:first-child {
  border-top: none;
  padding-top: 2px;
}
.dxz-welfare-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  margin-bottom: 5px;
}
.dxz-welfare-top-left {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.dxz-welfare-title {
  color: var(--dxz-white);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dxz-welfare-top-right {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}
.dxz-welfare-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 5px 12px;
  font-size: 12px;
  color: var(--dxz-gray);
  margin-bottom: 6px;
}

/* 按福利包聚合 2 列网格 */
.dxz-plan-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}
@media (max-width: 440px) {
  .dxz-plan-grid { grid-template-columns: 1fr; }
}
.dxz-plan-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--dxz-inset);
  border: 1px solid var(--dxz-border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}

/* Cupertino 开关 */
.dxz-cupertino-switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}
.dxz-cupertino-switch.disabled { opacity: 0.45; cursor: not-allowed; }
.dxz-cupertino-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.dxz-switch-track {
  position: absolute;
  inset: 0;
  background: #2b2e3a;
  border: 1px solid var(--dxz-border-strong);
  border-radius: 99px;
  transition: background 0.18s;
}
.dxz-cupertino-switch input:checked + .dxz-switch-track {
  background: var(--dxz-green);
  border-color: var(--dxz-green);
}
.dxz-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #f5f5f5;
  transition: transform 0.18s;
}
.dxz-cupertino-switch input:checked + .dxz-switch-track .dxz-switch-thumb {
  transform: translateX(14px);
}

/* 模型管理折叠抽屉 */
.dxz-models-drawer {
  background: var(--dxz-surface);
  border: 1px solid var(--dxz-border-strong);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.dxz-models-search {
  background: var(--dxz-bg);
  border: 1px solid var(--dxz-border-strong);
  border-radius: 6px;
  padding: 4px 10px;
  color: var(--dxz-white);
  font-size: 12px;
  width: 150px;
  outline: none;
}
.dxz-models-search:focus {
  border-color: var(--dxz-gold);
}
.dxz-btn-copy-gold {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--dxz-gold-bg);
  color: var(--dxz-gold);
  border: 1px solid var(--dxz-gold-border);
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
}

/* 网关页 */
.dxz-gw-tiles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
@media (max-width: 480px) {
  .dxz-gw-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.dxz-gw-tile {
  background: var(--dxz-surface);
  border: 1px solid var(--dxz-border);
  border-radius: 9px;
  padding: 9px 11px;
}
.dxz-gw-tile-lbl {
  font-size: 11.5px;
  color: var(--dxz-dim);
}
.dxz-gw-tile-val {
  font-size: 13px;
  font-weight: 700;
  font-family: var(--dxz-mono);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dxz-card-box {
  background: var(--dxz-surface);
  border: 1px solid var(--dxz-border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.dxz-code-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--dxz-inset);
  border: 1px solid var(--dxz-border);
  border-radius: 7px;
  padding: 8px 10px;
  font-family: var(--dxz-mono);
  font-size: 12px;
  color: var(--dxz-gold);
  word-break: break-all;
}

/* 调用记录 5 列自适应网格 */
.dxz-log-grid {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) 50px 80px 52px;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
}
.dxz-log-grid.head {
  background: var(--dxz-inset);
  border-bottom: 1px solid var(--dxz-border);
  font-size: 11.5px;
  color: var(--dxz-gray);
  font-weight: 600;
}
.dxz-log-grid.item {
  border-top: 1px solid var(--dxz-border);
  font-size: 12px;
  cursor: pointer;
}
.dxz-log-grid.item:first-of-type {
  border-top: none;
}
.dxz-log-grid.item:hover {
  background: rgba(255, 255, 255, 0.025);
}

/* 审计详情弹窗 */
.dxz-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.dxz-modal {
  background: var(--dxz-surface);
  border: 1px solid var(--dxz-border-strong);
  border-radius: 11px;
  width: 100%;
  max-width: 540px;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dxz-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--dxz-inset);
  border-bottom: 1px solid var(--dxz-border);
}
.dxz-modal-body {
  padding: 12px 14px;
  overflow-y: auto;
  font-family: var(--dxz-mono);
  font-size: 12px;
  color: var(--dxz-gray);
  white-space: pre-wrap;
  word-break: break-all;
}

.dxz-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--dxz-dim);
  margin-top: 14px;
  padding: 0 2px;
}
`

    function installStyles() {
      if (typeof document === 'undefined') return
      try {
        const existing = document.querySelectorAll('style[data-plugin="dx-zcode"]')
        for (let i = 0; i < existing.length; i++) {
          if (existing[i].dataset.pluginCss !== CSS_ID) {
            existing[i].remove()
          }
        }
        if (document.querySelector('style[data-plugin="dx-zcode"][data-plugin-css="' + CSS_ID + '"]')) return
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dx-zcode'
        tag.dataset.pluginCss = CSS_ID
        tag.textContent = PANEL_CSS
        document.head.appendChild(tag)
      } catch {
        /* 忽略注入异常 */
      }
    }

    function fmtNumber(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
      return n.toLocaleString('zh-CN')
    }

    function fmtTokens(n) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0'
      if (n >= 100000000) {
        const v = n / 100000000
        return Number.isInteger(v) ? `${v}亿` : `${v.toFixed(2).replace(/\.?0+$/, '')}亿`
      }
      if (n >= 10000) {
        const v = n / 10000
        return Number.isInteger(v) ? `${v}万` : `${v.toFixed(1).replace(/\.0$/, '')}万`
      }
      return n.toLocaleString('zh-CN')
    }

    function bucketLabel(b) {
      return String(b?.show_name || b?.model_name || '')
    }

    function isFlashBucket(b) {
      return bucketLabel(b).toLowerCase().includes('flash')
    }

    function isMainBucket(b) {
      const lbl = bucketLabel(b).toLowerCase()
      return lbl !== '' && !lbl.includes('flash')
    }

    function sumBucketStats(list, pred) {
      let avail = 0
      let total = 0
      let matched = 0
      const names = []
      for (const b of Array.isArray(list) ? list : []) {
        if (!pred(b)) continue
        matched++
        avail += Number(b.available_units ?? b.remaining_units ?? 0) || 0
        total += Number(b.total_units ?? 0) || 0
        const name = bucketLabel(b).trim()
        if (name && !names.includes(name)) names.push(name)
      }
      return { avail, total, matched, names }
    }

    function fmtDateTime(seconds, withYear = false) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '—'
      const d = new Date(seconds * 1000)
      const pad = (n) => String(n).padStart(2, '0')
      const Y = d.getFullYear()
      const M = pad(d.getMonth() + 1)
      const D = pad(d.getDate())
      const h = pad(d.getHours())
      const m = pad(d.getMinutes())
      return withYear ? `${Y}-${M}-${D} ${h}:${m}` : `${M}-${D} ${h}:${m}`
    }

    function fmtTime(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '—'
      const d = new Date(seconds * 1000)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }

    function fmtRemainShort(diffSec) {
      if (!Number.isFinite(diffSec) || diffSec <= 0) return ''
      const days = Math.floor(diffSec / 86400)
      const hours = Math.floor((diffSec % 86400) / 3600)
      const mins = Math.floor((diffSec % 3600) / 60)
      if (days > 0) return hours > 0 ? `余${days}天${hours}时` : `余${days}天`
      if (hours > 0) return `余${hours}h${mins}m`
      return `余${Math.max(1, mins)}分`
    }

    function fmtDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
      if (ms < 1000) return `${Math.round(ms)}ms`
      return `${(ms / 1000).toFixed(1)}s`
    }

    function inferPlanModels(pl) {
      if (Array.isArray(pl?.models) && pl.models.length > 0) return pl.models
      const caps = Array.isArray(pl?.capabilities) ? pl.capabilities : []
      const list = []
      for (const c of caps) {
        const s = String(c ?? '')
        if (!s.toLowerCase().startsWith('model:')) continue
        list.push(
          s.slice(6)
            .replace(/^glm-/i, 'GLM-')
            .replace(/-flash$/i, '-Flash')
            .replace(/-turbo$/i, '-Turbo')
            .replace(/-air$/i, '-Air')
            .replace(/-pro$/i, '-Pro')
        )
      }
      if (list.length > 0) return list
      const name = String(pl?.name ?? pl?.planId ?? '').toLowerCase()
      if (name.includes('5.4')) return ['GLM-5.4']
      if (name.includes('flash')) return ['GLM-5.3-Flash']
      return ['ZCode 专属']
    }

    /**
     * 把账号的 plans 与 balances 归一化为四要素完整的福利列表（方案 C）。
     */
    function buildAccountWelfares(account, nowSec) {
      const balances = Array.isArray(account?.welfare?.balances) ? account.welfare.balances : []
      const plans = Array.isArray(account?.welfare?.plans) ? account.welfare.plans : []
      const items = []
      const ineligibleNames = []

      for (const pl of plans) {
        const planId = String(pl.planId ?? pl.plan_id ?? '')
        const name = String(pl.name ?? planId)
        const modelStr = inferPlanModels(pl).join(' / ')
        const eff = Number(pl.effectiveAt ?? pl.effective_at ?? 0)
        const end = Number(pl.endsAt ?? pl.ends_at ?? 0)
        const grant = Number(pl.grantUnits ?? pl.grant_units ?? 0)

        if (pl.ineligible || pl.status === 'ineligible') {
          ineligibleNames.push(`${name}: 1004 无资格`)
          continue
        }

        if (pl.claimable) {
          items.push({
            key: `claim:${planId}`,
            planId,
            title: name,
            model: modelStr,
            status: 'claimable',
            statusLabel: '待领',
            used: 0,
            total: grant,
            remain: grant,
            pct: 100,
            effectiveText: eff > nowSec ? fmtDateTime(eff) : '领取后生效',
            expiresText: end > 0 ? fmtDateTime(end) : '见活动窗口',
            expiresRemain: end > nowSec ? fmtRemainShort(end - nowSec) : '',
            claimable: true,
          })
          continue
        }

        if (pl.claimed && eff > nowSec) {
          const effDt = new Date(eff * 1000)
          const pad = (n) => String(n).padStart(2, '0')
          const clock = `${pad(effDt.getHours())}:${pad(effDt.getMinutes())}`
          const remainHint = fmtRemainShort(eff - nowSec)
          items.push({
            key: `pend:${planId}`,
            planId,
            title: name,
            model: modelStr,
            status: 'pending',
            statusLabel: '待生效',
            used: 0,
            total: grant,
            remain: grant,
            pct: 100,
            pillText: `${modelStr} · 待生 ${fmtTokens(grant)} (${clock})`,
            effectiveText: `${fmtDateTime(eff)}${remainHint ? ` · ${remainHint}后` : ''}`,
            expiresText: end > 0 ? fmtDateTime(end) : '—',
            expiresRemain: end > nowSec ? fmtRemainShort(end - nowSec) : '',
            claimable: false,
          })
        }
      }

      const activePlans = plans.filter((pl) => pl.claimed && !pl.ineligible && Number(pl.effectiveAt ?? 0) <= nowSec)
      for (let i = 0; i < balances.length; i++) {
        const b = balances[i]
        const model = bucketLabel(b) || '通用额度'
        const total = Number(b.total_units ?? 0) || 0
        const remain = Number(b.available_units ?? b.remaining_units ?? 0) || 0
        const used = Math.max(0, total - remain)
        const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((remain / total) * 100))) : 0

        const matchedPlan = activePlans.find((pl) => {
          if (b.plan_id && pl.planId === String(b.plan_id)) return true
          return inferPlanModels(pl).some((m) => m.toLowerCase() === model.toLowerCase())
        }) || (activePlans.length === 1 ? activePlans[0] : null)

        const bEff = Number(b.effective_at ?? matchedPlan?.effectiveAt ?? 0)
        const bEnd = Number(b.expiry ?? b.expires_at ?? b.period_end ?? b.ends_at ?? matchedPlan?.endsAt ?? 0)
        const isLargePromo = total >= 20000000 || Boolean(matchedPlan && matchedPlan.endsAt > 0 && matchedPlan.startsAt > 0 && (matchedPlan.endsAt - matchedPlan.startsAt) >= 36 * 3600)
        // 日常每日 0 点重置额度不因为夜间 22 点以后就标大红；仅余量见底 (<=15%) 或大额跨天活动临期 (<=2h) 才标红
        const isExpiring = isLargePromo && bEnd > nowSec && (bEnd - nowSec) <= 2 * 3600
        const isLow = total > 0 && (remain / total) <= 0.15
        const status = isLow ? 'low' : (isExpiring ? 'expiring' : 'active')
        const statusLabel = isLow ? '告急' : (isExpiring ? '临期' : '生效中')
        const title = String(b.plan_name ?? matchedPlan?.name ?? (isFlashBucket(b) ? 'Flash 福利包' : '日常额度'))
        const expRemainStr = bEnd > nowSec ? fmtRemainShort(bEnd - nowSec) : ''
        const pillDetail = used === 0 ? `${fmtTokens(remain)}` : `余${fmtTokens(remain)}/${fmtTokens(total)}`

        items.push({
          key: `bal:${i}:${model}:${b.plan_id ?? ''}`,
          planId: String(b.plan_id ?? matchedPlan?.planId ?? `bucket:${model}`),
          title,
          model,
          status,
          statusLabel,
          used,
          total,
          remain,
          pct,
          pillText: `${model} · ${pillDetail}${isLargePromo && expRemainStr ? ` (${expRemainStr})` : ''}`,
          effectiveText: bEff > 0 ? fmtDateTime(bEff) : '已生效',
          expiresText: bEnd > 0 ? fmtDateTime(bEnd) : '每日 00:00 重置',
          expiresRemain: expRemainStr,
          claimable: false,
        })
      }

      // upstream balances 同步延迟兜底：有生效 plan 但 balances 为空时展示 plan
      if (balances.length === 0) {
        for (const pl of activePlans) {
          const end = Number(pl.endsAt ?? 0)
          if (end > 0 && end <= nowSec) continue
          const total = Number(pl.grantUnits ?? 0) || 0
          items.push({
            key: `actplan:${pl.planId}`,
            planId: String(pl.planId ?? ''),
            title: String(pl.name ?? pl.planId),
            model: inferPlanModels(pl).join(' / '),
            status: 'active',
            statusLabel: '生效中',
            used: 0,
            total,
            remain: total,
            pct: total > 0 ? 100 : 0,
            effectiveText: pl.effectiveAt > 0 ? fmtDateTime(pl.effectiveAt) : '已生效',
            expiresText: end > 0 ? fmtDateTime(end) : '—',
            expiresRemain: end > nowSec ? fmtRemainShort(end - nowSec) : '',
            claimable: false,
          })
        }
      }

      const persistedInelig = Array.isArray(account?.ineligiblePlans) ? account.ineligiblePlans : []
      for (const pid of persistedInelig) {
        if (!ineligibleNames.some((x) => x.includes(pid))) {
          ineligibleNames.push(`${pid}: 1004 无资格`)
        }
      }

      return { items, ineligibleNames }
    }

    async function copyToClipboard(text) {
      if (!text) return false
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {}
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch {
        return false
      }
    }

    const ROUTE = '/dx-zcode/api'

    async function post(body) {
      const res = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      return { ok: res.ok, status: res.status, data }
    }

    const h = React.createElement

    function IconGateway({ size = 14 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 2, y: 2, width: 20, height: 8, rx: 2 }),
        h('rect', { x: 2, y: 14, width: 20, height: 8, rx: 2 }),
        h('line', { x1: 6, y1: 6, x2: 6.01, y2: 6 }),
        h('line', { x1: 6, y1: 18, x2: 6.01, y2: 18 }))
    }
    function IconAccounts({ size = 14 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
        h('circle', { cx: 9, cy: 7, r: 4 }),
        h('path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }),
        h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }))
    }
    function IconLogs({ size = 14 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        h('polyline', { points: '14 2 14 8 20 8' }),
        h('line', { x1: 16, y1: 13, x2: 8, y2: 13 }),
        h('line', { x1: 16, y1: 17, x2: 8, y2: 17 }))
    }
    function IconCopy({ size = 11 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }),
        h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }))
    }
    function IconCheck({ size = 11 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('polyline', { points: '20 6 9 17 4 12' }))
    }
    function IconBox({ size = 12 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }),
        h('polyline', { points: '3.27 6.96 12 12.01 20.73 6.96' }),
        h('line', { x1: 12, y1: 22.08, x2: 12, y2: 12 }))
    }

    function CopyButton({ text, label = '', title = '复制' }) {
      const [copied, setCopied] = React.useState(false)
      const handleCopy = async () => {
        const ok = await copyToClipboard(text)
        if (ok) {
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        }
      }
      return h('button', {
        type: 'button',
        className: 'dxz-btn-copy-gold',
        title,
        onClick: handleCopy,
      },
        copied ? h(IconCheck, { size: 10 }) : h(IconCopy, { size: 10 }),
        copied ? '已复制' : (label || '复制'))
    }

    function CupertinoSwitch({ checked, onChange, disabled = false, title = '' }) {
      return h('label', {
        className: 'dxz-cupertino-switch' + (disabled ? ' disabled' : ''),
        title,
        onClick: (e) => e.stopPropagation(),
      },
        h('input', {
          type: 'checkbox',
          checked: !!checked,
          disabled,
          onChange: (e) => {
            if (!disabled && onChange) onChange(e.target.checked)
          },
        }),
        h('span', { className: 'dxz-switch-track' },
          h('span', { className: 'dxz-switch-thumb' })))
    }

    function Panel(props) {
      const t = props.t ?? ((/** @type {string} */ k) => k)
      installStyles()

      const [state, setState] = React.useState(/** @type {any} */ (null))
      const [pending, setPending] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [failed, setFailed] = React.useState(false)
      const [activeTab, setActiveTab] = React.useState('accounts')
      const [viewMode, setViewMode] = React.useState('by_account') // 'by_account' | 'by_plan'
      const [expandedMap, setExpandedMap] = React.useState(/** @type {Record<string, boolean>} */ ({}))
      const [showModels, setShowModels] = React.useState(false)
      const [modelSearch, setModelSearch] = React.useState('')
      const [probingId, setProbingId] = React.useState('')
      const [selectedLog, setSelectedLog] = React.useState(null)
      const [isProbing, setIsProbing] = React.useState(false)
      const [actionNotice, setActionNotice] = React.useState('')
      const [actionNoticeKind, setActionNoticeKind] = React.useState('green')

      const request = React.useCallback(async (action, opts = {}) => {
        if (!opts.silent) setPending(true)
        try {
          const { ok, data } = await post(action ?? { action: 'state' })
          if (!ok) {
            if (!opts.silent) {
              setFailed(true)
              setNotice(String(data?.error ?? t('failed')))
            }
          } else {
            setFailed(false)
            setState(data)
          }
          return data
        } catch (error) {
          if (!opts.silent) {
            setFailed(true)
            setNotice(error instanceof Error ? error.message : String(error))
          }
          return null
        } finally {
          if (!opts.silent) setPending(false)
        }
      }, [t])

      React.useEffect(() => { void request() }, [request])
      React.useEffect(() => { void request({ action: 'refresh' }, { silent: true }) }, [])

      const claimJob = state?.claimJob ?? null
      const isJobRunning = claimJob?.status === 'running'

      // 常规轮询 + 领取进行中高频轮询
      React.useEffect(() => {
        const interval = isJobRunning ? 1000 : (activeTab === 'logs' ? 2000 : 8000)
        const timer = setInterval(() => {
          void request(isJobRunning ? { action: 'claim-status' } : undefined, { silent: true })
            .then((d) => {
              if (d?.claimJob && !d.accounts && d.claimJob.status !== 'running') {
                void request({ action: 'state' }, { silent: true })
              }
            })
        }, interval)
        const onFocus = () => { void request({ action: 'refresh' }, { silent: true }) }
        window.addEventListener('focus', onFocus)
        return () => {
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [request, activeTab, isJobRunning])

      const act = React.useCallback(async (action) => request(action), [request])

      const showToast = (msg, kind = 'green', ms = 3500) => {
        setActionNotice(msg)
        setActionNoticeKind(kind)
        if (ms > 0) setTimeout(() => setActionNotice(''), ms)
      }

      const handleProbeAll = React.useCallback(async () => {
        setIsProbing(true)
        showToast('正在并发探测全池福利包、专属模型与生效/过期时间…', 'gold', 0)
        try {
          await request({ action: 'refresh' })
          showToast('探测完成：各账号福利与时间已刷新至最新', 'green', 3500)
        } catch (e) {
          showToast('探测失败: ' + (e instanceof Error ? e.message : String(e)), 'red', 5000)
        } finally {
          setIsProbing(false)
        }
      }, [request])

      const handleProbeOne = React.useCallback(async (accountId) => {
        setProbingId(accountId)
        try {
          await request({ action: 'probe-one', id: accountId }, { silent: true })
          showToast('单号探测完成，数据已更新', 'green', 2400)
        } finally {
          setProbingId('')
        }
      }, [request])

      const handleClearIneligible = React.useCallback(async (accountId) => {
        setProbingId(accountId)
        try {
          await request({ action: 'clear-ineligible', id: accountId }, { silent: true })
          showToast('已清除 1004 跳过标记并重测资格', 'gold', 2800)
        } finally {
          setProbingId('')
        }
      }, [request])

      const handleClaimAll = React.useCallback(async () => {
        await request({ action: 'claim-start' }, { silent: true })
      }, [request])

      const handleClaimSingle = React.useCallback(async (accountId) => {
        await request({ action: 'claim-start', only: [accountId] }, { silent: true })
      }, [request])

      const handleDismissReport = React.useCallback(async () => {
        await request({ action: 'claim-dismiss' }, { silent: true })
      }, [request])

      const handleToggleAccount = (account, checked) => {
        setState((prev) => {
          if (!prev) return prev
          const nextAccounts = (prev.accounts || []).map((a) => {
            if (a.id === account.id || (account.relatedIds && account.relatedIds.includes(a.id))) {
              return { ...a, enabled: checked }
            }
            return a
          })
          return { ...prev, accounts: nextAccounts }
        })
        void act({ action: checked ? 'enable' : 'disable', id: account.id })
      }

      const handleRemoveAccount = (account) => {
        const isDesktop = account.source === 'desktop'
        const promptMsg = isDesktop
          ? `确定要从插件中移除本机桌面账号「${account.userName || account.label || account.id}」吗？\n（仅停止插件接管，不删除原生目录）`
          : `确定要移除账号「${account.userName || account.label || account.id}」吗？`
        if (!window.confirm(promptMsg)) return
        setState((prev) => {
          if (!prev) return prev
          return { ...prev, accounts: (prev.accounts || []).filter((a) => a.id !== account.id) }
        })
        void act({ action: 'remove-account', id: account.id })
      }

      const handleToggleGateway = (checked) => {
        setState((prev) => (prev ? { ...prev, gateway: { ...(prev.gateway || {}), running: checked } } : prev))
        void act({ action: checked ? 'gateway-start' : 'gateway-stop' })
      }

      const handleSetDefaultModel = (modelId) => {
        setState((prev) => (prev ? { ...prev, defaultModel: modelId } : prev))
        void act({ action: 'set-default-model', modelId })
      }

      if (state === null) {
        return h('div', { className: 'dxz-ios-root', style: { padding: '28px 12px', textAlign: 'center', color: 'var(--dxz-gray)' } },
          t(pending ? 'loading' : 'unavailable'))
      }

      const accounts = Array.isArray(state.accounts) ? state.accounts : []
      const logs = Array.isArray(state.logs) ? state.logs : []
      const gateway = state.gateway ?? { running: false }
      const models = Array.isArray(state.models) ? state.models : []
      const channelMode = state.channelMode ?? 'cli'
      const nowSec = Math.floor(Date.now() / 1000)

      // 预计算每个账号的福利四要素与全局汇总
      let poolAvailTotal = 0
      let poolPendingTotal = 0
      let poolClaimableTotal = 0
      let claimableItemsCount = 0

      const normalizedAccounts = accounts.map((acc) => {
        const parsed = buildAccountWelfares(acc, nowSec)
        let accAvail = 0
        let accClaimable = 0
        let accPending = 0
        for (const w of parsed.items) {
          if (w.status === 'claimable') {
            accClaimable += w.total
            poolClaimableTotal += w.total
            claimableItemsCount++
          } else if (w.status === 'pending') {
            accPending += w.total
            poolPendingTotal += w.total
          } else {
            accAvail += w.remain
            poolAvailTotal += w.remain
          }
        }
        return {
          account: acc,
          items: parsed.items,
          ineligibleNames: parsed.ineligibleNames,
          accAvail,
          accClaimable,
          accPending,
        }
      })

      function tagClsForStatus(status) {
        if (status === 'low' || status === 'expiring') return 'red'
        if (status === 'claimable' || status === 'pending') return 'gold'
        return 'green'
      }

      function renderCompactWelfareRow(w, accountId) {
        const cls = tagClsForStatus(w.status)
        const isAlert = w.status === 'low' || w.status === 'expiring'
        const barColor = cls === 'red' ? 'var(--dxz-red)' : (cls === 'gold' ? 'var(--dxz-gold)' : 'var(--dxz-green)')
        const remainColor = cls === 'red' ? 'var(--dxz-red)' : (cls === 'gold' ? 'var(--dxz-gold)' : 'var(--dxz-white)')

        return h('div', { key: w.key, className: 'dxz-welfare-row' },
          h('div', { className: 'dxz-welfare-top' },
            h('div', { className: 'dxz-welfare-top-left' },
              h('span', { className: 'dxz-tag gold', style: { fontFamily: 'var(--dxz-mono)' } }, w.model),
              h('span', { className: 'dxz-welfare-title', title: w.title }, w.title)),
            h('div', { className: 'dxz-welfare-top-right dxz-num' },
              w.claimable
                ? h('span', { style: { fontWeight: 700, color: 'var(--dxz-gold)' } }, `可领 ${w.total > 0 ? fmtTokens(w.total) : '福利'}`)
                : h('span', { style: { color: remainColor, fontWeight: 700 } },
                  `余${fmtTokens(w.remain)}`,
                  h('span', { style: { color: 'var(--dxz-dim)', fontWeight: 400 } }, `/${fmtTokens(w.total)}(${w.pct}%)`)),
              h('span', { className: `dxz-tag ${cls}` }, w.statusLabel),
              w.claimable ? h('button', {
                type: 'button',
                className: 'dxz-link-btn gold',
                disabled: isJobRunning,
                onClick: (e) => {
                  e.stopPropagation()
                  void handleClaimSingle(accountId)
                },
              }, '单领') : null)),
          h('div', { className: 'dxz-welfare-meta dxz-num' },
            h('span', null, w.claimable ? '待一键领取' : `已用 ${fmtTokens(w.used)}`),
            h('span', null,
              `生 ${w.effectiveText} · 止 `,
              h('span', { style: { color: isAlert ? 'var(--dxz-red)' : 'var(--dxz-gray)' } },
                `${w.expiresText}${w.expiresRemain ? ` (${w.expiresRemain})` : ''}`))),
          h('div', { className: 'dxz-track' },
            h('div', { className: 'dxz-track-fill', style: { width: `${w.pct}%`, background: barColor } })))
      }

      function renderJobPanel() {
        if (!claimJob || claimJob.status === 'idle') return null
        if (claimJob.status === 'running') {
          const pct = claimJob.total > 0 ? Math.max(10, Math.round((claimJob.current / claimJob.total) * 100)) : 22
          return h('div', { key: 'job-running', className: 'dxz-job-card' },
            h('div', { className: 'dxz-job-head' },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--dxz-white)', fontWeight: 600 } },
                h('span', { className: 'dxz-dot gold' }),
                claimJob.stepText || '正在执行一键领取福利…'),
              h('span', { className: 'dxz-tag gold' }, claimJob.reuseBrowser ? '单 Edge 会话复用 · 自动跳过 1004' : '自动跳过 1004')),
            h('div', { className: 'dxz-track' },
              h('div', { className: 'dxz-track-fill', style: { width: `${pct}%`, background: 'var(--dxz-gold)' } })))
        }

        const rep = claimJob.report || { claimed: [], skipped: [], failed: [] }
        return h('div', { key: 'job-done', className: 'dxz-job-card done' },
          h('div', { className: 'dxz-job-head' },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--dxz-white)' } },
              h('span', { className: `dxz-tag ${rep.failed.length > 0 && rep.claimed.length === 0 ? 'red' : 'green'}` },
                claimJob.status === 'error' ? '异常' : '完成'),
              `成功 ${rep.claimed.length} · 跳过 ${rep.skipped.length} · 失败 ${rep.failed.length}`),
            h('button', {
              type: 'button',
              className: 'dxz-link-btn',
              onClick: () => { void handleDismissReport() },
            }, '收起')),
          h('div', { className: 'dxz-report-list' },
            rep.claimed.map((it, idx) => h('div', { key: `c:${idx}`, className: 'dxz-report-row' },
              h('span', { style: { color: 'var(--dxz-white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.account),
              h('span', { className: 'dxz-num', style: { color: 'var(--dxz-green)', flexShrink: 0 } }, `✓ ${it.detail}`))),
            rep.skipped.map((it, idx) => h('div', { key: `s:${idx}`, className: 'dxz-report-row' },
              h('span', { style: { color: 'var(--dxz-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.account),
              h('span', { style: { color: String(it.reason).includes('1004') ? 'var(--dxz-red)' : 'var(--dxz-dim)', flexShrink: 0 } }, it.reason))),
            rep.failed.map((it, idx) => h('div', { key: `f:${idx}`, className: 'dxz-report-row' },
              h('span', { style: { color: 'var(--dxz-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.account),
              h('span', { style: { color: 'var(--dxz-red)', flexShrink: 0 } }, it.error)))))
      }

      function renderByPlanView() {
        const groupMap = new Map()
        for (const item of normalizedAccounts) {
          const acc = item.account
          const accName = acc.userName || acc.label || acc.id
          for (const w of item.items) {
            const gKey = `${w.planId}::${w.model}`
            if (!groupMap.has(gKey)) {
              groupMap.set(gKey, {
                planId: w.planId,
                title: w.title,
                model: w.model,
                effectiveText: w.effectiveText,
                expiresText: w.expiresText,
                expiresRemain: w.expiresRemain,
                rows: [],
              })
            }
            groupMap.get(gKey).rows.push({ accName, accId: acc.id, w })
          }
        }

        const groups = Array.from(groupMap.values())
        if (groups.length === 0) {
          return h('div', { className: 'dxz-list-panel', style: { padding: '24px 12px', textAlign: 'center', color: 'var(--dxz-dim)' } },
            t('noPlans'))
        }

        return h('div', { className: 'dxz-list-panel' },
          groups.map((grp) => h('div', { key: `${grp.planId}::${grp.model}`, className: 'dxz-acc-item' },
            h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5 } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
                h('span', { className: 'dxz-tag gold', style: { fontFamily: 'var(--dxz-mono)' } }, grp.model),
                h('span', { style: { fontWeight: 600, color: 'var(--dxz-white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, grp.title)),
              h('span', { className: 'dxz-num', style: { fontSize: 12, color: 'var(--dxz-gray)' } },
                `生 ${grp.effectiveText} · 止 ${grp.expiresText}${grp.expiresRemain ? ` (${grp.expiresRemain})` : ''}`)),
            h('div', { className: 'dxz-plan-grid' },
              grp.rows.map(({ accName, accId, w }) => {
                const cls = tagClsForStatus(w.status)
                const col = cls === 'red' ? 'var(--dxz-red)' : (cls === 'gold' ? 'var(--dxz-gold)' : 'var(--dxz-green)')
                return h('div', { key: `${accId}:${w.key}`, className: 'dxz-plan-cell' },
                  h('span', { style: { color: 'var(--dxz-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, accName),
                  h('span', { className: 'dxz-num', style: { color: col, fontWeight: 600, flexShrink: 0 } },
                    w.claimable ? `待领 ${fmtTokens(w.total)}` : `用${fmtTokens(w.used)} · 余${fmtTokens(w.remain)}(${w.pct}%)`))
              })))))
      }

      function renderAccountsTab() {
        const blocks = []

        // 1. 次级工具栏：双视角切换 + 通道 + 模型 + 国内/国际站登录
        blocks.push(h('div', { key: 'subbar', className: 'dxz-subbar' },
          h('div', { className: 'dxz-subbar-grp' },
            h('div', { className: 'dxz-seg' },
              h('button', {
                type: 'button',
                className: 'dxz-seg-btn' + (viewMode === 'by_account' ? ' active' : ''),
                onClick: () => setViewMode('by_account'),
              }, '按账号'),
              h('button', {
                type: 'button',
                className: 'dxz-seg-btn' + (viewMode === 'by_plan' ? ' active' : ''),
                onClick: () => setViewMode('by_plan'),
              }, '按福利包')),
            h('button', {
              type: 'button',
              className: 'dxz-mini-btn' + (channelMode === 'direct' ? ' active' : ''),
              title: channelMode === 'direct' ? '官方直连通道（点击切为 CLI 模式）' : '官方 CLI 模式（点击切为直连）',
              onClick: () => {
                const next = channelMode === 'direct' ? 'cli' : 'direct'
                setState((prev) => (prev ? { ...prev, channelMode: next } : prev))
                void act({ action: 'set-channel-mode', mode: next })
              },
            }, channelMode === 'direct' ? '直连通道' : 'CLI通道'),
            h('button', {
              type: 'button',
              className: 'dxz-mini-btn' + (showModels ? ' active' : ''),
              onClick: () => setShowModels(!showModels),
            }, h(IconBox, { size: 11 }), `模型 (${models.length})`)),
          h('div', { className: 'dxz-subbar-grp' },
            h('button', {
              type: 'button',
              className: 'dxz-mini-btn',
              disabled: pending,
              onClick: () => { void act({ action: 'login', provider: 'bigmodel' }) },
            }, `+ ${t('loginCn')}`),
            h('button', {
              type: 'button',
              className: 'dxz-mini-btn',
              disabled: pending,
              onClick: () => { void act({ action: 'login', provider: 'zai' }) },
            }, `+ ${t('loginGlobal')}`))))

        // 2. 模型管理折叠抽屉
        if (showModels) {
          blocks.push(h('div', { key: 'models-drawer', className: 'dxz-models-drawer' },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 } },
              h('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dxz-white)' } }, t('modelsTitle')),
              h('input', {
                type: 'text',
                className: 'dxz-models-search',
                placeholder: t('modelsSearch'),
                value: modelSearch,
                onChange: (e) => setModelSearch(e.target.value),
              })),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto' } },
              models
                .filter((m) => !modelSearch || (m.id || m.label || '').toLowerCase().includes(modelSearch.toLowerCase()))
                .map((m) => {
                  const mid = m.id || m.label || ''
                  const isDefault = (state.defaultModel || '').toLowerCase() === mid.toLowerCase()
                  return h('div', {
                    key: mid,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      background: 'var(--dxz-inset)',
                      padding: '6px 10px',
                      borderRadius: 6,
                    },
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                      h('span', { style: { fontSize: 12.5, fontFamily: 'var(--dxz-mono)', fontWeight: 600, color: isDefault ? 'var(--dxz-gold)' : 'var(--dxz-white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, mid),
                      isDefault ? h('span', { className: 'dxz-tag gold' }, t('currentDefaultModel')) : null),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 } },
                      !isDefault ? h('button', {
                        type: 'button',
                        className: 'dxz-link-btn',
                        onClick: () => handleSetDefaultModel(mid),
                      }, t('setDefaultModel')) : null,
                      h(CopyButton, { text: mid, label: '复制' })))
                }))))
        }

        // 3. 异步领取进度 / 战报
        const jobPanel = renderJobPanel()
        if (jobPanel) blocks.push(jobPanel)

        // 4. 账号为空兜底
        if (normalizedAccounts.length === 0) {
          blocks.push(h('div', {
            key: 'empty-acc',
            className: 'dxz-list-panel',
            style: { padding: '26px 12px', textAlign: 'center', color: 'var(--dxz-dim)' },
          }, t('accountsEmpty')))
          return h('div', null, blocks)
        }

        // 5. 按福利包视图 vs 按账号折叠视图
        if (viewMode === 'by_plan') {
          blocks.push(h('div', { key: 'by-plan-view' }, renderByPlanView()))
          return h('div', null, blocks)
        }

        blocks.push(h('div', { key: 'by-account-list', className: 'dxz-list-panel' },
          normalizedAccounts.map(({ account, items, ineligibleNames, accAvail, accClaimable, accPending }) => {
            const isOpen = !!expandedMap[account.id]
            const idShort = String(account.id || '').replace(/^zc-/, '').slice(0, 6)
            const displayName = account.userName || account.label || account.id
            const claimCount = items.filter((w) => w.claimable).length
            const pendingCount = items.filter((w) => w.status === 'pending').length

            let statusBadge = h('span', { className: 'dxz-tag green dxz-num' }, `可用 ${fmtTokens(accAvail)}`)
            if (ineligibleNames.length > 0 && claimCount === 0 && accAvail === 0) {
              statusBadge = h('span', { className: 'dxz-tag red' }, '1004跳过')
            } else if (claimCount > 0) {
              statusBadge = h('span', { className: 'dxz-tag gold' }, `${claimCount}待领 ${accClaimable > 0 ? fmtTokens(accClaimable) : ''}`)
            } else if (pendingCount > 0 && accAvail === 0) {
              statusBadge = h('span', { className: 'dxz-tag gold' }, `待生效 ${fmtTokens(accPending)}`)
            } else if (account.error) {
              statusBadge = h('span', { className: 'dxz-tag red' }, '探测异常')
            }

            return h('div', { key: account.id, className: 'dxz-acc-item' + (account.enabled ? '' : ' disabled') },
              // 第 1 行：可点击展开收起的紧凑账号头
              h('div', {
                className: 'dxz-acc-head',
                onClick: () => setExpandedMap((prev) => ({ ...prev, [account.id]: !prev[account.id] })),
              },
                h('div', { className: 'dxz-acc-head-left' },
                  h('span', { className: 'dxz-acc-name', title: displayName }, displayName),
                  h('span', { className: 'dxz-acc-id' }, idShort),
                  statusBadge,
                  ineligibleNames.length > 0 && (claimCount > 0 || accAvail > 0)
                    ? h('span', { className: 'dxz-tag red' }, '含1004')
                    : null),
                h('div', { className: 'dxz-acc-actions' },
                  ineligibleNames.length > 0 ? h('button', {
                    type: 'button',
                    className: 'dxz-link-btn red',
                    disabled: probingId === account.id,
                    onClick: (e) => {
                      e.stopPropagation()
                      void handleClearIneligible(account.id)
                    },
                  }, '重测') : null,
                  h('button', {
                    type: 'button',
                    className: 'dxz-link-btn',
                    disabled: probingId === account.id,
                    onClick: (e) => {
                      e.stopPropagation()
                      void handleProbeOne(account.id)
                    },
                  }, probingId === account.id ? '探测中' : '探测'),
                  h(CupertinoSwitch, {
                    checked: account.enabled,
                    title: account.enabled ? '停用此账号' : '启用此账号',
                    onChange: (checked) => handleToggleAccount(account, checked),
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dxz-link-btn',
                    onClick: (e) => {
                      e.stopPropagation()
                      handleRemoveAccount(account)
                    },
                  }, '移除'),
                  h('span', { style: { fontSize: 12, color: 'var(--dxz-gray)', width: 14, textAlign: 'center' } },
                    isOpen ? '▾' : '▸'))),

              // 折叠态：清爽胶囊行（字号 12px、无双层括号）
              !isOpen
                ? (items.length > 0
                  ? h('div', { className: 'dxz-pill-wrap' },
                    items.map((w) => {
                      const cls = tagClsForStatus(w.status)
                      const label = w.pillText || (w.claimable
                        ? `${w.model} · 待领 ${w.total > 0 ? fmtTokens(w.total) : ''}`
                        : `${w.model} · 余${fmtTokens(w.remain)}`)
                      return h('span', { key: w.key, className: `dxz-tag ${cls} dxz-num` }, label)
                    }))
                  : (account.error
                    ? h('div', { style: { fontSize: 12, color: 'var(--dxz-red)', marginTop: 6 } }, account.error)
                    : null))
                : h('div', { className: 'dxz-welfare-list' },
                    ineligibleNames.map((msg, i) => h('div', {
                      key: `inelig:${i}`,
                      className: 'dxz-tag red',
                      style: { marginBottom: 6, display: 'inline-flex' },
                    }, msg)),
                    account.error ? h('div', {
                      className: 'dxz-tag red',
                      style: { marginBottom: 6, display: 'block', whiteSpace: 'normal' },
                    }, `异常：${account.error}`) : null,
                    items.length > 0
                      ? items.map((w) => renderCompactWelfareRow(w, account.id))
                      : h('div', { style: { fontSize: 12, color: 'var(--dxz-dim)', padding: '4px 0' } }, t('noPlans'))))
          })))

        return h('div', null, blocks)
      }

      function renderGatewayTab() {
        const base = 'http://' + (gateway.host || '127.0.0.1') + ':' + (gateway.port || 8799)
        const endpointOpenAI = base + '/v1/chat/completions'
        const endpointAnthropic = base + '/v1'

        return h('div', null,
          h('div', { className: 'dxz-gw-tiles' },
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, '监听端口'),
              h('div', { className: 'dxz-gw-tile-val', style: { color: 'var(--dxz-white)' } }, `:${gateway.port || 8799}`)),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, '运行状态'),
              h('div', { className: 'dxz-gw-tile-val', style: { color: gateway.running ? 'var(--dxz-green)' : 'var(--dxz-red)' } },
                gateway.running ? '● 运行中' : '○ 已停止')),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, '累计转发'),
              h('div', { className: 'dxz-gw-tile-val', style: { color: 'var(--dxz-gold)' } },
                `${gateway.metrics?.totalRequests || logs.length} 次`)),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, '默认路由'),
              h('div', { className: 'dxz-gw-tile-val', style: { color: 'var(--dxz-gold)' } },
                gateway.defaultModel || state.defaultModel || 'GLM-5.3-Flash'))),

          h('div', { className: 'dxz-card-box', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
            h('div', null,
              h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dxz-white)' } }, '本地兼容网关开关'),
              h('div', { style: { fontSize: 12, color: 'var(--dxz-gray)' } }, '供 Cursor / Claude Code / Cherry 等客户端本地连接')),
            h(CupertinoSwitch, {
              checked: gateway.running,
              title: gateway.running ? '点击停止网关' : '点击启动网关',
              onChange: (checked) => handleToggleGateway(checked),
            })),

          h('div', { className: 'dxz-card-box', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            h('div', null,
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: 12.5 } },
                h('span', { style: { color: 'var(--dxz-white)', fontWeight: 600 } }, t('endpointAnthropic')),
                h('span', { className: 'dxz-tag green' }, '原生直连')),
              h('div', { className: 'dxz-code-box' },
                h('span', null, endpointAnthropic),
                h(CopyButton, { text: endpointAnthropic, label: '复制' }))),
            h('div', null,
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: 12.5 } },
                h('span', { style: { color: 'var(--dxz-white)', fontWeight: 600 } }, t('endpointOpenAI')),
                h('span', { className: 'dxz-tag gold' }, '通用兼容')),
              h('div', { className: 'dxz-code-box' },
                h('span', null, endpointOpenAI),
                h(CopyButton, { text: endpointOpenAI, label: '复制' })))),

          h('div', { style: { fontSize: 12, color: 'var(--dxz-dim)', padding: '0 2px' } },
            gateway.authRequired
              ? '已启用网关鉴权，请在工具中填写配置的 gatewayAuthToken。'
              : '仅监听 127.0.0.1 本机免密接入；如需公网或多人鉴权请在插件设置填写密钥。'))
      }

      function renderLogsTab() {
        const totalCalls = logs.length
        const failedCalls = logs.filter((l) => !l.ok).length
        const avgDuration = totalCalls > 0 ? Math.round(logs.reduce((s, l) => s + (Number(l.durationMs) || 0), 0) / totalCalls) : 0
        const totalTokens = logs.reduce((s, l) => s + (Number(l.tokens?.total) || Number(l.tokens?.input || 0) + Number(l.tokens?.output || 0)), 0)
        const totalCachedTokens = logs.reduce((s, l) => s + (Number(l.tokens?.cached) || 0), 0)
        const totalInputTokens = logs.reduce((s, l) => s + (Number(l.tokens?.input) || 0), 0)
        const promptSum = totalInputTokens + totalCachedTokens
        const cacheRateStr = promptSum > 0 ? `${((totalCachedTokens / promptSum) * 100).toFixed(1)}%` : '0%'

        return h('div', null,
          h('div', { className: 'dxz-gw-tiles' },
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, '请求次数'),
              h('div', { className: 'dxz-gw-tile-val dxz-num' }, `${totalCalls} 次`)),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, 'Token 消耗'),
              h('div', { className: 'dxz-gw-tile-val dxz-num', style: { color: 'var(--dxz-gold)' } }, fmtTokens(totalTokens))),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, '缓存命中'),
              h('div', { className: 'dxz-gw-tile-val dxz-num', style: { color: 'var(--dxz-green)' } }, cacheRateStr)),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-lbl' }, '平均耗时 / 异常'),
              h('div', { className: 'dxz-gw-tile-val dxz-num' },
                h('span', { style: { color: 'var(--dxz-white)' } }, `${avgDuration}ms`),
                failedCalls > 0 ? h('span', { style: { color: 'var(--dxz-red)', marginLeft: 4 } }, `/${failedCalls}错`) : null))),

          h('div', { className: 'dxz-subbar' },
            h('span', { style: { fontSize: 12, color: 'var(--dxz-gray)' } }, `最近 ${Math.min(logs.length, 50)} 条（点击行看详情）`),
            h('div', { className: 'dxz-subbar-grp' },
              failedCalls > 0 ? h('button', {
                type: 'button',
                className: 'dxz-link-btn red',
                onClick: () => { void act({ action: 'logs-clear-failed' }) },
              }, t('clearFailed')) : null,
              h('button', {
                type: 'button',
                className: 'dxz-link-btn',
                onClick: () => { void act({ action: 'logs-clear' }) },
              }, t('clearLogs')))),

          // 5 列自适应网格（适配 500px–555px 无横向溢出）
          h('div', { className: 'dxz-list-panel' },
            h('div', { className: 'dxz-log-grid head' },
              h('div', null, '时间'),
              h('div', null, '模型 / 账号'),
              h('div', { style: { textAlign: 'center' } }, '状态'),
              h('div', { style: { textAlign: 'right' } }, 'Tokens'),
              h('div', { style: { textAlign: 'right' } }, '耗时')),
            logs.length === 0
              ? h('div', { style: { padding: '22px 10px', textAlign: 'center', color: 'var(--dxz-dim)' } }, t('logsEmpty'))
              : logs.slice(0, 50).map((log, idx) => {
                const tokTotal = Number(log.tokens?.total) || (Number(log.tokens?.input || 0) + Number(log.tokens?.output || 0))
                const cachedNum = Number(log.tokens?.cached) || 0
                return h('div', {
                  key: log.id || idx,
                  className: 'dxz-log-grid item dxz-num',
                  title: log.ok ? '点击查看调用明细' : (log.error || '调用失败'),
                  onClick: () => setSelectedLog(log),
                },
                  h('div', { style: { fontSize: 11.5, fontFamily: 'var(--dxz-mono)', color: 'var(--dxz-dim)' } }, fmtTime(Math.floor(log.at / 1000))),
                  h('div', { style: { minWidth: 0 } },
                    h('div', { style: { color: 'var(--dxz-white)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, log.model || '—'),
                    h('div', { style: { fontSize: 11.5, color: 'var(--dxz-gray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                      `${log.account || '—'} · ${log.channel === 'direct' ? '直连' : 'CLI'}`)),
                  h('div', { style: { textAlign: 'center' } },
                    h('span', { className: 'dxz-tag ' + (log.ok ? 'green' : 'red') }, log.ok ? '200' : 'ERR')),
                  h('div', { style: { textAlign: 'right', fontFamily: 'var(--dxz-mono)' } },
                    h('div', { style: { color: 'var(--dxz-white)', fontWeight: 600 } }, tokTotal > 0 ? fmtTokens(tokTotal) : '—'),
                    cachedNum > 0 ? h('div', { style: { fontSize: 11, color: 'var(--dxz-green)' } }, `省${fmtTokens(cachedNum)}`) : null),
                  h('div', { style: { textAlign: 'right', fontFamily: 'var(--dxz-mono)', color: 'var(--dxz-gray)', fontSize: 11.5 } }, fmtDuration(log.durationMs)))
              })),

          selectedLog ? h('div', { className: 'dxz-modal-overlay', onClick: () => setSelectedLog(null) },
            h('div', { className: 'dxz-modal', onClick: (e) => e.stopPropagation() },
              h('div', { className: 'dxz-modal-head' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { style: { fontWeight: 700, color: 'var(--dxz-white)' } }, '调用审计详情'),
                  h('span', { className: 'dxz-tag ' + (selectedLog.ok ? 'green' : 'red') }, selectedLog.ok ? '200 OK' : 'FAILED')),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h(CopyButton, { text: JSON.stringify(selectedLog, null, 2), label: '复制 JSON' }),
                  h('button', { type: 'button', className: 'dxz-link-btn', onClick: () => setSelectedLog(null) }, '关闭'))),
              h('div', { className: 'dxz-modal-body' },
                JSON.stringify(selectedLog, null, 2)))) : null)
      }

      // 原生 ZCode LOGO（白-银灰渐层 Z 矢量微标）
      const zhipuSvgVNode = h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' },
        h('defs', null,
          h('linearGradient', { id: 'zGradCompactV9', x1: '0', y1: '0', x2: '1', y2: '1' },
            h('stop', { offset: '0%', stopColor: '#ffffff' }),
            h('stop', { offset: '100%', stopColor: '#a1a1aa' }))),
        h('path', {
          fill: 'url(#zGradCompactV9)',
          d: 'M18.25 3A2.75 2.75 0 0 1 21 5.75v12.5A2.75 2.75 0 0 1 18.25 21H5.75A2.75 2.75 0 0 1 3 18.25V5.75A2.75 2.75 0 0 1 5.75 3zm-5.01 3.74L5.81 17.267h4.954l7.431-10.529zm-.08 8.977c-.24 0-.465.12-.598.312l-.873 1.239h6.193v-1.551zM6.121 8.284h4.729c.24 0 .466-.12.6-.312l.865-1.233c-.009 0-6.182.001-6.194-.006z',
        }))

      const claimBtnText = isJobRunning
        ? `领取中 (${claimJob.current || 0}/${claimJob.total || '?'})`
        : t('claimAll')

      return h('div', { className: 'dxz-ios-root' },
        // 1. 顶部品牌 LOGO + 双核心按钮
        h('div', { className: 'dxz-head-row' },
          h('div', { className: 'dxz-brand' },
            h('div', { className: 'dxz-logo-box' }, zhipuSvgVNode),
            h('div', { className: 'dxz-brand-text' },
              h('div', { className: 'dxz-brand-title' }, 'DXZCode 福利聚合'),
              h('div', { className: 'dxz-brand-sub' }, `${accounts.length} 账号 · 网关 ${gateway.running ? '运行中' : '未启动'}`))),
          h('div', { className: 'dxz-btn-grp' },
            h('button', {
              type: 'button',
              className: 'dxz-btn-probe',
              disabled: pending || isProbing || isJobRunning,
              onClick: () => { void handleProbeAll() },
            }, isProbing ? '探测中…' : t('detectWelfare')),
            h('button', {
              type: 'button',
              className: 'dxz-btn-claim',
              disabled: pending || isProbing || isJobRunning,
              onClick: () => { void handleClaimAll() },
            },
              claimBtnText,
              (!isJobRunning && claimableItemsCount > 0) ? h('span', { className: 'dxz-claim-pill dxz-num' }, claimableItemsCount) : null))),

        // 2. 页签 + 单行汇总指标
        h('div', { className: 'dxz-tab-summary-row' },
          h('div', { className: 'dxz-tabs' },
            [
              { id: 'accounts', label: t('tabAccounts'), icon: IconAccounts },
              { id: 'gateway', label: t('tabGateway'), icon: IconGateway, hasDot: gateway.running },
              { id: 'logs', label: t('tabLogs'), icon: IconLogs },
            ].map((item) => h('button', {
              key: item.id,
              type: 'button',
              className: 'dxz-tab-btn' + (activeTab === item.id ? ' active' : ''),
              onClick: () => setActiveTab(item.id),
            },
              h(item.icon, { size: 13 }),
              item.label,
              item.hasDot ? h('span', { className: 'dxz-dot green' }) : null))),
          h('div', { className: 'dxz-summary-inline dxz-num' },
            h('span', null, '可用 ', h('strong', { style: { color: 'var(--dxz-green)' } }, fmtTokens(poolAvailTotal))),
            h('span', null, '待生 ', h('strong', { style: { color: 'var(--dxz-gold)' } }, fmtTokens(poolPendingTotal))),
            h('span', null, '可领 ', h('strong', { style: { color: poolClaimableTotal > 0 ? 'var(--dxz-gold)' : 'var(--dxz-white)' } }, fmtTokens(poolClaimableTotal))))),

        // 3. 异常 / 探测提示条
        notice !== '' ? h('div', { className: 'dxz-notice-bar ' + (failed ? 'red' : 'green'), role: failed ? 'alert' : 'status' }, notice) : null,
        actionNotice !== '' ? h('div', { className: 'dxz-notice-bar ' + actionNoticeKind }, actionNotice) : null,

        // 4. 当前页签内容
        activeTab === 'accounts' ? renderAccountsTab() : (activeTab === 'gateway' ? renderGatewayTab() : renderLogsTab()),

        // 5. 极简页脚
        h('div', { className: 'dxz-footer' },
          h('span', null, `${t('version')}: ${state.version ?? '0.4.0'}`),
          h('span', null, `${t('cli')}: ${state.cli?.version ?? t('cliMissing')}`)))
    }

    /** 侧栏 / 设置导航图标 */
    function GlyphIcon({ size = 16 } = {}) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        React.createElement('rect', { x: 3, y: 8, width: 18, height: 4, rx: 1 }),
        React.createElement('path', { d: 'M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8' }),
        React.createElement('path', { d: 'M12 8v13' }),
        React.createElement('path', { d: 'M12 8c-2.5 0-5-1-5-3s3-2.2 5 3Z' }),
        React.createElement('path', { d: 'M12 8c2.5 0 5-1 5-3s-3-2.2-5 3Z' }))
    }

    /** 插件客户端入口注册 */
    function apply(ctx) {
      const namespace = 'settings.dx-zcode'
      ctx.effect(() => ctx.locale.register(namespace, messages), 'dx-zcode: 面板文案')
      const t = ctx.locale.bind(namespace)
      installStyles()

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dx-zcode',
        order: 460,
        label: () => t('title'),
        inject: () => ({ t }),
      }, Panel))
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'dx-zcode',
        inject: () => ({}),
      }, GlyphIcon))

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'dx-zcode',
        order: 30,
        label: () => t('title'),
        inject: () => ({ t }),
      }, GlyphIcon))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'dx-zcode',
        inject: () => ({ t }),
      }, Panel))

      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dx-zcode',
        locale: namespace,
        inject: () => ({ t }),
      }, Panel))
    }

    return { name: 'dx-zcode-client', inject: ['slots', 'locale'], apply }
  },
})
