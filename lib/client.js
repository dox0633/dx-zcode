// @ts-check
/**
 * DSH 桌面端渲染进程扩展（设置面板 UI / WebUI）
 *
 * 方案三全新重构 v4：Apple Pro Studio 黑金尊享
 * - 顶层动态控制中枢 (Pro Studio Dynamic Hub)
 * - 全链路显性化「可用额度百分比」与「可用额度」
 * - 所有账号分模型算力看板 (Model Breakdown Deck: Flash 敏捷池 + GLM-5.3 满血旗舰池)
 * - 【先探测 · 再领取】闭环流程与状态栏
 * - 双轨数码混音仪表舱 (Dual-Track Studio Gauges)
 * - 统一网关四象限探针 + 双协议暗金代码舱
 * - 调用记录 8 列无横向滚动条高密座舱 + 暗金审计抽屉
 */

window.__ModuleLoader__.load({
  id: 'dx-zcode',
  factory: (require) => {
    const React = require('react')

    const messages = {
      zh: {
        title: 'DX Zcode',
        intro: '多账号池 · 额度福利 · 官方直连网关 · 零 3012 风控',
        refresh: '刷新状态',
        loading: '正在连接服务…',
        unavailable: '面板暂不可用：后端接口未响应，请检查插件状态。',

        // 三大核心标签页 (Tabs)
        tabAccounts: '账号管理',
        tabGateway: '网关服务',
        tabLogs: '调用记录',

        // 账号管理
        accountsTitle: '账号池与额度管理',
        accountsEmpty: '暂未添加任何账号，请点击上方按钮通过官方授权接入。',
        loginCn: '国内站',
        loginGlobal: '国际站',
        claimAll: '智能全领',
        detectWelfare: '探测额度',
        claiming: '正在探测各账号福利礼包…',
        claimResult: '福利领取报告',
        claimNone: '当前账号福利额度均处于最优生效状态。',
        refreshQuota: '刷新',

        // 指标
        metricActive: '活跃账号',
        metricTotalQuota: '实时可用 Token',
        metricPendingQuota: '待生效 Token',
        metricModelsCount: '支持官方模型',

        // 账号详情
        accountName: '账号名称',
        accountId: '识别标识',
        accountPhone: '绑定手机 / 邮箱',
        accountSource: '凭据来源',
        accountProvider: '服务渠道',
        accountStatus: '账号启用状态',
        sourceDesktop: '本机桌面客户端',
        sourceLoginRoot: '插件托管登录',
        sourceDual: '本机与托管双通道',
        providerCn: '国内站',
        providerGlobal: '国际站',
        providerDual: '国内站 / 国际站 双通道',
        providerBigmodel: '国内站',
        providerUnknown: '官方渠道',
        enabled: '正常启用',
        disabled: '已手动停用',
        availableTokens: '可用额度',
        welfareExpireTime: '可用时间',
        pendingTokens: '待生效',
        planDetails: '套餐明细与到期时间',
        noPlans: '暂无套餐明细记录。',
        planRemaining: '剩余',
        effectiveAt: '生效',
        expiresAt: '失效',
        planClaimed: '生效中',
        planClaimable: '可领取',

        // 模型管理
        modelsTitle: 'ZCode 官方渠道专属模型管理',
        modelsDesc: '仅管理 ZCode (智谱清言/Z.AI) 渠道官方模型。可指定网关默认路由模型（推荐保持 GLM-5.3-Flash，优先抵扣官方福利包 Token）。',
        modelsSearch: '搜索官方模型（如 GLM-5.3、Flash、Turbo）…',
        modelsEmpty: '没有匹配的官方模型。',
        setDefaultModel: '设为网关默认',
        currentDefaultModel: '网关默认',
        quotaWelfare: '福利专享 · 优先抵扣官方福利包 Token',
        quotaBalance: '消耗账户通用额度',
        contextWindow: '上下文',
        maxOutput: '最大输出',
        reasoning: '深度推理',
        multimodal: '多模态 (图/视/PDF)',
        copyModel: '复制模型名',
        copiedModel: '已复制',

        // 网关服务
        gateway: '双协议转发网关',
        gatewayHeroOn: '网关服务运行中',
        gatewayHeroOff: '网关服务已停止',
        gatewayHeroDesc: '支持以 OpenAI / Anthropic 标准协议接入 Cursor、Claude Code、Cherry Studio、沉浸式翻译等任意工具。模型流量经官方 CLI 直连，零风控拦截。',
        gatewayToggle: '网关主控开关',
        gatewayOn: '运行中',
        gatewayOff: '已停止',
        gatewayPort: '监听端口',
        gatewayHost: '监听地址',
        gatewayAuthToken: '网关密钥 (可选)',
        endpointOpenAI: 'OpenAI 协议端点 (Chat Completions)',
        endpointAnthropic: 'Anthropic 协议端点 (Messages)',
        copy: '复制',
        copied: '已复制',
        copyCurl: '复制测试命令',
        gatewayMetrics: '网关运行实时指标',
        totalRequests: '处理请求',
        activeRequests: '并发处理',
        errorCount: '失败次数',
        uptime: '运行时间',
        gatewayHint: '提示：若修改端口需重启网关服务生效；留空网关密钥表示允许本地任意工具免鉴权访问。',

        // 调用记录
        logsTitle: '模型路由与分发审计记录',
        logsEmpty: '暂无调用记录。通过网关向官方模型发送请求后将在此实时展示。',
        clearLogs: '清空全部',
        clearFailed: '清空失败',
        refreshLogs: '刷新',
        logTime: '时间',
        logAccount: '路由账号',
        logChannel: '分发渠道',
        logModel: '请求模型',
        logStatus: '分发状态',
        logDuration: '响应耗时',
        logTokens: 'Token 消耗',
        logTokensDetail: '输入 / 输出 / 缓存',
        logCacheRate: '缓存率',
        logTps: '生成速率',
        logError: '异常摘要',
        logDetails: '详情',
        logFilterAll: '全部记录',
        logFilterSuccess: '仅看成功',
        logFilterFailed: '仅看异常',
        statusSuccess: '成功',
        statusFailed: '异常',

        // 页脚
        version: '插件版本',
        cli: '官方 CLI 内核',
        cliMissing: '未检测到，将使用托管网络协议',
        save: '保存',
        saved: '已保存',
        cancel: '取消',
        confirm: '确定',
        failed: '操作失败',
      },
    }

    const CSS_ID = 'dx-zcode/panel-ios-studio-v8'
    const PANEL_CSS = `
:root {
  /* ════ 核心对齐：100% 融入 DSH 原生深灰质感体系 ════ */
  --dxz-card-bg: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.015) 100%);
  --dxz-card-solid: #24252b;
  --dxz-card-nested: rgba(0, 0, 0, 0.25);
  
  --dxz-border-card: rgba(255, 255, 255, 0.08);
  --dxz-border-highlight: rgba(255, 255, 255, 0.14);
  --dxz-bevel-top: rgba(255, 255, 255, 0.12);
  --dxz-bevel-bottom: rgba(0, 0, 0, 0.4);

  --dxz-text-primary: #ffffff;
  --dxz-text-secondary: #9ca3af;
  --dxz-text-muted: #6b7280;
  --dxz-white: #ffffff;
  --dxz-text-gray: #9ca3af;

  /* 严苛 6 色极客状态元素：黑、深钛灰、纯白、翡翠绿、琥珀橙、大红 */
  --dxz-green: #10b981;
  --dxz-green-bg: rgba(16, 185, 129, 0.12);
  --dxz-green-border: rgba(16, 185, 129, 0.28);
  --dxz-green-glow: rgba(16, 185, 129, 0.35);

  --dxz-orange: #f59e0b;
  --dxz-orange-bg: rgba(245, 158, 11, 0.12);
  --dxz-orange-border: rgba(245, 158, 11, 0.28);
  --dxz-orange-glow: rgba(245, 158, 11, 0.35);
  --dxz-gold: #f59e0b;

  --dxz-red: #ef4444;
  --dxz-red-bg: rgba(239, 68, 68, 0.12);
  --dxz-red-border: rgba(239, 68, 68, 0.28);

  --dxz-cyan: #38bdf8;
  --dxz-cyan-bg: rgba(56, 189, 248, 0.12);
  --dxz-cyan-border: rgba(56, 189, 248, 0.28);

  /* 严正 Windows 现代化原生字体栈：杜绝宋体回退与破损笔画 */
  --dxz-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "DengXian", "等线", sans-serif;
  --dxz-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace;

  --dxz-r-card: 4px;
  --dxz-r-box: 3px;
  --dxz-r-tag: 2px;
}

.dxz-ios-root, .dxz-root {
  color: var(--dxz-white);
  font-family: var(--dxz-font-sans);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.dxz-ios-root button, .dxz-ios-root input, .dxz-ios-root select,
.dxz-root button, .dxz-root input, .dxz-root select {
  font-family: inherit;
}

/* ── 顶部资产总览 (纯净炭灰微晶体面板，杜绝突刺绿线) ── */
.dxz-studio-hub {
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  padding: 13px 16px;
  margin-bottom: 11px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  position: relative;
  overflow: hidden;
}
.dxz-hub-progress-bar {
  display: none !important;
}
.dxz-hub-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dxz-hub-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dxz-brand-logo-zhipu {
  width: 32px;
  height: 32px;
  border-radius: var(--dxz-r-box);
  background: linear-gradient(145deg, #2e2f36 0%, #19191d 100%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
.dxz-hub-title {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.01em;
}
.dxz-btn-grp {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dxz-btn-dark-glass {
  height: 28px;
  padding: 0 12px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: var(--dxz-r-box);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #fff;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}
.dxz-btn-dark-glass:hover {
  background: rgba(255, 255, 255, 0.14);
}
.dxz-btn-orange-3d {
  height: 28px;
  padding: 0 13px;
  font-size: 11.5px;
  font-weight: 700;
  border-radius: var(--dxz-r-box);
  background: linear-gradient(180deg, #f59e0b 0%, #b45309 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #000;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 3px 10px rgba(245, 158, 11, 0.35);
  transition: all 0.15s ease;
}
.dxz-btn-orange-3d:hover { filter: brightness(1.08); }
.dxz-claim-count-pill {
  background: #000;
  color: #f59e0b;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 2px;
  font-family: var(--dxz-mono);
  font-weight: 800;
}
.dxz-hub-hero-split {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 0 1px;
}
.dxz-hub-big-num {
  font-family: var(--dxz-mono);
  font-size: 25px;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}
.dxz-hub-big-num small {
  font-family: var(--dxz-font-sans);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dxz-text-secondary);
  margin-left: 4px;
}
.dxz-hub-big-num span {
  font-family: var(--dxz-font-sans);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dxz-green);
  margin-left: 8px;
}
.dxz-hub-big-time {
  font-family: var(--dxz-font-sans);
  font-size: 14.5px;
  font-weight: 600;
  color: var(--dxz-orange);
  line-height: 1;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.dxz-hub-big-time .time-val {
  font-family: var(--dxz-mono);
  font-size: 17px;
  font-weight: 800;
}
.dxz-hub-big-time small {
  font-family: var(--dxz-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--dxz-text-muted);
}

/* ── 三标签页导航栏 ── */
.dxz-ios-tabs-wrap {
  margin-bottom: 11px;
}
.dxz-ios-segmented-bar {
  display: flex;
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--dxz-r-box);
  padding: 3px;
  gap: 3px;
}
.dxz-ios-tab-item {
  flex: 1;
  text-align: center;
  padding: 5px 0;
  font-size: 12px;
  font-weight: 600;
  border-radius: 2px;
  color: var(--dxz-text-secondary);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.dxz-ios-tab-item.active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.dxz-tab-badge {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dxz-green);
  display: inline-block;
}

/* ── 消息横幅 ── */
.dxz-ios-banner {
  padding: 8px 12px;
  border-radius: var(--dxz-r-box);
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: var(--dxz-green);
  font-size: 11.5px;
  margin-bottom: 10px;
}
.dxz-ios-banner.error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.28);
  color: var(--dxz-red);
}

.dxz-btn-trash {
  background: transparent;
  border: none;
  color: var(--dxz-red);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
}
.dxz-btn-trash:hover {
  text-decoration: underline;
}

/* ── 账号管理：单行工具栏 ── */
.dxz-toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 11px;
  gap: 8px;
}
.dxz-toolbar-left, .dxz-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dxz-count-badge {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dxz-text-muted);
}
.dxz-hub-ch-capsule {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--dxz-r-box);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: var(--dxz-text-secondary);
  transition: all 0.15s ease;
}
.dxz-hub-ch-capsule:hover {
  background: rgba(255, 255, 255, 0.1);
}
.dxz-hub-ch-capsule.direct {
  color: var(--dxz-cyan);
  border-color: var(--dxz-cyan-border);
  background: var(--dxz-cyan-bg);
}
.dxz-hub-ch-capsule.cli {
  color: var(--dxz-orange);
  border-color: var(--dxz-orange-border);
  background: var(--dxz-orange-bg);
}
.dxz-ios-btn {
  height: 25px;
  padding: 0 9px;
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--dxz-r-box);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}
.dxz-ios-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.dxz-ios-btn-models {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.14);
  color: #e5e7eb;
}
.dxz-ios-btn-models:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}
.dxz-ios-btn-models.active {
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.35);
  color: var(--dxz-orange);
}

/* ── 真实 Cupertino Switch 开关 (彻底修复原先空方框问题) ── */
.dxz-cupertino-switch {
  display: inline-block;
  position: relative;
  width: 38px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
}
.dxz-cupertino-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  margin: 0;
  position: absolute;
  pointer-events: none;
}
.dxz-switch-track {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.dxz-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.dxz-cupertino-switch input:checked + .dxz-switch-track {
  background: var(--dxz-green);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.4), inset 0 1px 1px rgba(0, 0, 0, 0.2);
}
.dxz-cupertino-switch input:checked + .dxz-switch-track .dxz-switch-thumb {
  transform: translateX(18px);
}
.dxz-cupertino-switch.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── 账号卡片 (彻底修复单行头部与折行问题) ── */
.dxz-acc-card {
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  padding: 11px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
}
.dxz-acc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
.dxz-acc-user-block {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dxz-acc-avatar {
  width: 26px;
  height: 26px;
  border-radius: var(--dxz-r-box);
  background: linear-gradient(135deg, #2e2f36 0%, #19191d 100%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 11px;
  color: #fff;
  flex-shrink: 0;
}
.dxz-acc-name {
  font-weight: 700;
  font-size: 12.5px;
  color: #fff;
}
.dxz-acc-avail-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--dxz-r-box);
  padding: 2.5px 8px;
}
.dxz-acc-avail-lbl {
  font-size: 10.5px;
  color: var(--dxz-text-muted);
}
.dxz-acc-avail-val {
  font-family: var(--dxz-mono);
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}
.dxz-acc-avail-pct {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--dxz-green);
}
.dxz-acc-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dxz-btn-remove {
  background: transparent;
  border: none;
  color: var(--dxz-red);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
}
.dxz-btn-remove:hover {
  text-decoration: underline;
}

/* 模型阶梯轨道 */
.dxz-dual-tracks {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dxz-track-item {
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: var(--dxz-r-box);
  padding: 6px 9px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  position: relative;
  overflow: hidden;
}
.dxz-track-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dxz-track-icon {
  width: 20px;
  height: 20px;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
}
.dxz-track-label {
  font-weight: 700;
  color: #fff;
}
.dxz-track-desc {
  color: var(--dxz-text-secondary);
  font-size: 10.5px;
  margin-left: 2px;
}
.dxz-track-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dxz-gauge-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dxz-gauge-lbl {
  font-size: 10px;
  color: var(--dxz-text-muted);
}
.dxz-gauge-num {
  font-family: var(--dxz-mono);
  font-size: 11.5px;
  font-weight: 700;
}
.dxz-gauge-unit {
  font-size: 10px;
  font-weight: normal;
}
.dxz-track-pct-tag {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--dxz-r-tag);
}
.dxz-track-meter {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  opacity: 0.8;
}
.dxz-btn-track-claim {
  height: 22px;
  padding: 0 8px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 2px;
  background: linear-gradient(180deg, #f59e0b 0%, #b45309 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #000;
  cursor: pointer;
  white-space: nowrap;
}
.dxz-claim-alert-track {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.25);
}

/* 方案 C 核心：动态生命周期流速轨 */
.dxz-gauge-box-c {
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--dxz-r-box);
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 2px;
}
.dxz-gauge-endpoints {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  font-family: var(--dxz-mono);
  color: var(--dxz-text-secondary);
}
.dxz-gauge-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
}
.dxz-gauge-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, #f59e0b, #10b981);
  border-radius: 2px;
}
.dxz-gauge-pointer {
  position: absolute;
  top: -3px;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: #fff;
  border: 2px solid #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.8);
  transform: translateX(-50%);
}
.dxz-gauge-caption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9.5px;
  font-family: var(--dxz-mono);
  color: var(--dxz-text-muted);
}


/* ════ 定稿 1:1 精确复刻：流线高保真卡片 (去进度条，简约可用时间) ════ */
.account-list { display: flex; flex-direction: column; gap: 6px; }

.acc-glass-card, .dxz-acc-card {
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 7px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  transition: all 0.15s ease;
}
.acc-glass-card.disabled, .dxz-acc-card.disabled {
  opacity: 0.38 !important;
  filter: grayscale(1) brightness(0.85) !important;
  background-color: #1a1b20 !important;
  border-color: rgba(255, 255, 255, 0.04) !important;
}
.acc-glass-card.disabled .acc-name,
.acc-glass-card.disabled .quota-exact,
.acc-glass-card.disabled .digits {
  color: #6b7280 !important;
}
.acc-glass-card.disabled .model-pill {
  background: rgba(255, 255, 255, 0.04) !important;
  border-color: rgba(255, 255, 255, 0.06) !important;
  color: #6b7280 !important;
}
.acc-glass-card.disabled .dual-mode-pill {
  color: #6b7280 !important;
  border-color: rgba(255, 255, 255, 0.06) !important;
  background: rgba(255, 255, 255, 0.04) !important;
}
.acc-glass-card.disabled .countdown-badge {
  color: #6b7280 !important;
}
.dxz-action-feedback {
  font-size: 11px;
  font-weight: 600;
  color: var(--dxz-green);
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  padding: 4px 10px;
  border-radius: var(--dxz-r-box);
  text-align: center;
  margin-top: 4px;
}

.acc-glass-card:hover, .dxz-acc-card:hover {
  border-color: rgba(255, 255, 255, 0.16);
}
.acc-main-row, .dxz-acc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
.acc-left-meta, .dxz-acc-user-block {
  display: flex;
  align-items: center;
  gap: 8px;
}
.acc-avatar, .dxz-acc-avatar {
  width: 22px;
  height: 22px;
  border-radius: var(--dxz-r-box);
  background: linear-gradient(135deg, #2e2f36 0%, #19191d 100%);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.acc-name-box {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.acc-name, .dxz-acc-name {
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.01em;
}
.acc-sub {
  font-family: var(--dxz-mono);
  font-size: 9.5px;
  color: var(--dxz-text-muted);
}
.acc-right-actions, .dxz-acc-ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dual-mode-pill {
  font-size: 10px;
  color: var(--dxz-green);
  font-family: var(--dxz-mono);
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 1px 6px;
  border-radius: var(--dxz-r-tag);
  white-space: nowrap !important;
}
.btn-remove, .dxz-btn-trash {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--dxz-red);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  opacity: 0.85;
  transition: opacity 0.15s;
}
.btn-remove:hover, .dxz-btn-trash:hover {
  opacity: 1;
  text-decoration: underline;
}

/* 额度详情单行流线 (严密防折行与变形) */
.acc-detail-stream {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--dxz-r-box);
  padding: 3.5px 7px;
  white-space: nowrap !important;
  gap: 6px;
  height: 25px;
  box-sizing: border-box;
}
.detail-stream-left {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap !important;
  flex-shrink: 0;
}
.model-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 4px;
  font-size: 9.5px;
  font-weight: 700;
  border-radius: var(--dxz-r-tag);
  background: var(--dxz-green-bg);
  border: 1px solid var(--dxz-green-border);
  color: var(--dxz-green);
  font-family: var(--dxz-mono);
  white-space: nowrap !important;
  line-height: 1.2;
  flex-shrink: 0;
}
.model-pill.crown, .model-pill.gold {
  background: var(--dxz-orange-bg);
  border-color: var(--dxz-orange-border);
  color: var(--dxz-orange);
}
.quota-exact {
  font-family: var(--dxz-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--dxz-green);
  white-space: nowrap !important;
  flex-shrink: 0;
}
.quota-pack-desc {
  font-size: 9.5px;
  color: var(--dxz-text-muted);
  white-space: nowrap !important;
}
.tag-deduct {
  font-size: 8.5px;
  color: var(--dxz-text-muted);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 3px;
  border-radius: 2px;
  white-space: nowrap !important;
  flex-shrink: 0;
  line-height: 1.2;
}

/* 倒计时微标 */
.countdown-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--dxz-orange);
  white-space: nowrap !important;
  flex-shrink: 0;
  margin-left: auto;
}
.countdown-badge .digits {
  font-family: var(--dxz-mono);
  font-weight: 700;
  white-space: nowrap !important;
}
.countdown-badge small {
  font-family: var(--dxz-mono);
  font-size: 9px;
  font-weight: 500;
  color: var(--dxz-text-muted);
  white-space: nowrap !important;
}
.banner-tag {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--dxz-orange);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 6px;
  border-bottom: 1px dashed rgba(255,255,255,0.1);
}

/* ── 页面 2 · 网关服务 (单行一体化座舱条) ── */
.dxz-gw-matrix {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  margin-bottom: 11px;
}
.dxz-gw-tile {
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  position: relative;
  background: transparent;
  border: none;
}
.dxz-gw-tile:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 15%;
  height: 70%;
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
}
.dxz-gw-tile-head {
  font-size: 10px;
  font-weight: 600;
  color: var(--dxz-text-muted);
  text-transform: uppercase;
}
.dxz-gw-tile-num {
  font-family: var(--dxz-mono);
  font-size: 14px;
  font-weight: 750;
  display: flex;
  align-items: center;
  gap: 4px;
}
.dxz-gw-master-card {
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  padding: 11px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  margin-bottom: 11px;
}
.dxz-gw-master-title {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}
.dxz-gw-master-desc {
  font-size: 10.5px;
  color: var(--dxz-text-muted);
  margin-top: 1px;
}
.dxz-gw-endpoint {
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  margin-bottom: 9px;
}
.dxz-gw-ep-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dxz-gw-ep-title {
  font-size: 11.5px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 5px;
}
.dxz-gw-ep-codebox {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--dxz-r-box);
  padding: 6px 9px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--dxz-mono);
  font-size: 11px;
  color: #e2e8f0;
}
.dxz-btn-copy-gold {
  height: 22px;
  padding: 0 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
}
.dxz-btn-copy-gold:hover {
  background: rgba(255, 255, 255, 0.15);
}
.dxz-gw-hint-box {
  font-size: 11px;
  color: var(--dxz-text-muted);
  line-height: 1.5;
  padding: 6px 9px;
  border-left: 2px solid var(--dxz-orange);
  background: rgba(245, 158, 11, 0.04);
  border-radius: 0 var(--dxz-r-box) var(--dxz-r-box) 0;
  margin-top: 2px;
}

/* ── 页面 3 · 调用记录 (单行一体化指标条 + 8列审计表) ── */
.dxz-log-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  margin-bottom: 11px;
}
.dxz-log-metric-card {
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  position: relative;
  background: transparent;
  border: none;
}
.dxz-log-metric-card:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 15%;
  height: 70%;
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
}
.dxz-log-metric-lbl {
  font-size: 10px;
  font-weight: 600;
  color: var(--dxz-text-muted);
  text-transform: uppercase;
}
.dxz-log-metric-val {
  font-family: var(--dxz-mono);
  font-size: 14px;
  font-weight: 750;
  display: flex;
  align-items: center;
  gap: 4px;
}
.dxz-log-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding: 0 2px;
}
.dxz-log-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dxz-text-secondary);
}
.dxz-log-actions {
  display: flex;
  gap: 6px;
}
.dxz-btn-log-action {
  height: 24px;
  padding: 0 8px;
  font-size: 10.5px;
  font-weight: 600;
  border-radius: var(--dxz-r-box);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: all 0.15s ease;
}
.dxz-btn-log-action:hover {
  background: rgba(255, 255, 255, 0.12);
}
.dxz-btn-log-action.danger {
  color: var(--dxz-red);
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
}
.dxz-log-table-wrap {
  background: var(--dxz-card-bg);
  background-color: #24252b;
  border: 1px solid var(--dxz-border-card);
  border-radius: var(--dxz-r-card);
  padding: 3px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
}
.dxz-log-grid {
  display: grid;
  grid-template-columns: 55px 70px 45px 120px 40px 50px 1fr 35px;
  align-items: center;
  padding: 5px 8px;
  font-size: 10.5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.dxz-log-grid.head {
  font-weight: 600;
  color: var(--dxz-text-muted);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 6px 8px;
}
.dxz-log-grid.item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.dxz-log-col-mono {
  font-family: var(--dxz-mono);
}
.dxz-badge-tag {
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--dxz-r-tag);
}
.dxz-badge-green {
  color: var(--dxz-green);
  background: var(--dxz-green-bg);
  border: 1px solid var(--dxz-green-border);
}
.dxz-badge-gold {
  color: var(--dxz-orange);
  background: var(--dxz-orange-bg);
  border: 1px solid var(--dxz-orange-border);
}
.dxz-badge-gray {
  color: var(--dxz-text-muted);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.dxz-cache-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  font-family: var(--dxz-mono);
  color: var(--dxz-green);
  background: var(--dxz-green-bg);
  padding: 0 4px;
  border-radius: 2px;
  margin-top: 1px;
}
.dxz-cache-none-pill {
  font-size: 9px;
  font-family: var(--dxz-mono);
  color: var(--dxz-text-muted);
}
.dxz-log-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(5px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.dxz-log-modal {
  background: #24252b;
  border: 1px solid var(--dxz-border-highlight);
  border-radius: var(--dxz-r-card);
  width: 100%;
  max-width: 540px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8);
  overflow: hidden;
}
.dxz-log-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--dxz-border-card);
  background: #1c1d22;
}
.dxz-log-modal-body {
  padding: 12px 16px;
  overflow-y: auto;
  font-family: var(--dxz-mono);
  font-size: 11px;
  color: var(--dxz-gold);
  white-space: pre-wrap;
  word-break: break-all;
  background: #17181c;
}
.dxz-ios-footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--dxz-text-muted);
  margin-top: 12px;
  padding: 0 2px;
}
`

    /** 幂等安装样式表 (清理旧版缓存并注入最新 V5 炭晶体黑曜石样式) */
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

    /** 格式化数字 */
    function fmtNumber(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
      return n.toLocaleString('zh-CN')
    }

    /** 格式化 Token 单位 (亿 / 万) */
    function fmtTokens(n) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0'
      if (n >= 100000000) return (n / 100000000).toFixed(2) + ' 亿'
      if (n >= 10000) return (n / 10000).toFixed(1) + ' 万'
      return n.toLocaleString('zh-CN')
    }

    /** 格式化完整日期时间 */
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

    /** 格式化时间戳 (秒) */
    function fmtTime(seconds) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '—'
      const d = new Date(seconds * 1000)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }

    /** 格式化错误简述 */
    function fmtError(msg) {
      if (!msg) return '调用失败'
      if (msg.includes('1309') || msg.includes('Coding Plan')) return '[1309] 套餐已到期'
      if (msg.includes('1113')) return '[1113] 该模型无配额'
      if (msg.includes('concurrency')) return '上游并发占用 (已重试备用号)'
      if (msg.includes('exceed quota limit')) return '配额耗尽限额'
      return msg.length > 28 ? msg.slice(0, 28) + '…' : msg
    }

    /** 格式化耗时 */
    function fmtDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
      if (ms < 1000) return `${Math.round(ms)} ms`
      return `${(ms / 1000).toFixed(1)} s`
    }

    /** 格式化运行时间 */
    function fmtUptime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0 分钟'
      const sec = Math.floor(ms / 1000)
      const h = Math.floor(sec / 3600)
      const m = Math.floor((sec % 3600) / 60)
      if (h > 0) return `${h} 小时 ${m} 分`
      return `${m} 分钟`
    }

    /** 复制文本到剪贴板 */
    async function copyToClipboard(text) {
      if (!text) return false
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* fallback below */
      }
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

    /** 插件后端标准 API 路径 */
    const ROUTE = '/dx-zcode/api'

    /** 向后端发送 API 请求 */
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

    // ── SVG 图标集合 ───────────────────────────────────────────────────────
    function IconGateway({ size = 16 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 2, y: 2, width: 20, height: 8, rx: 2 }),
        h('rect', { x: 2, y: 14, width: 20, height: 8, rx: 2 }),
        h('line', { x1: 6, y1: 6, x2: 6.01, y2: 6 }),
        h('line', { x1: 6, y1: 18, x2: 6.01, y2: 18 }))
    }
    function IconAccounts({ size = 16 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
        h('circle', { cx: 9, cy: 7, r: 4 }),
        h('path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }),
        h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }))
    }
    function IconLogs({ size = 16 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        h('polyline', { points: '14 2 14 8 20 8' }),
        h('line', { x1: 16, y1: 13, x2: 8, y2: 13 }),
        h('line', { x1: 16, y1: 17, x2: 8, y2: 17 }),
        h('polyline', { points: '10 9 9 9 8 9' }))
    }
    function IconRefresh({ size = 14 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M21.5 2v6h-6' }),
        h('path', { d: 'M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67' }))
    }
    function IconCopy({ size = 12 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }),
        h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }))
    }
    function IconCheck({ size = 12 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('polyline', { points: '20 6 9 17 4 12' }))
    }
    function IconBox({ size = 14 } = {}) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }),
        h('polyline', { points: '3.27 6.96 12 12.01 20.73 6.96' }),
        h('line', { x1: 12, y1: 22.08, x2: 12, y2: 12 }))
    }

    // ── 复制按钮组件 ───────────────────────────────────────────────────────
    function CopyButton({ text, label = '', title = '复制' }) {
      const [copied, setCopied] = React.useState(false)
      const handleCopy = async () => {
        const ok = await copyToClipboard(text)
        if (ok) {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }
      }
      return h('button', {
        type: 'button',
        className: 'dxz-btn-copy-gold',
        title,
        onClick: handleCopy,
      },
        copied ? h(IconCheck, { size: 11 }) : h(IconCopy, { size: 11 }),
        ' ',
        copied ? '已复制' : (label || '复制'))
    }

    // ── Cupertino 开关组件 ─────────────────────────────────────────────────
    function CupertinoSwitch({ checked, onChange, disabled = false, title = '' }) {
      return h('label', { className: 'dxz-cupertino-switch' + (disabled ? ' disabled' : ''), title },
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

    // ── 主控制面板主组件 ──────────────────────────────────────────────────
    function Panel(props) {
      const t = props.t ?? ((/** @type {string} */ k) => k)
      installStyles()

      const [state, setState] = React.useState(/** @type {any} */ (null))
      const [pending, setPending] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [failed, setFailed] = React.useState(false)
      const [activeTab, setActiveTab] = React.useState('accounts')
      const [showModels, setShowModels] = React.useState(false)
      const [modelSearch, setModelSearch] = React.useState('')
      const [accountClaimStatus, setAccountClaimStatus] = React.useState({})
      const [accountClaimMsg, setAccountClaimMsg] = React.useState({})
      const [lastProbeTs, setLastProbeTs] = React.useState(Date.now())
      const [selectedLog, setSelectedLog] = React.useState(null)
      const [isProbing, setIsProbing] = React.useState(false)
      const [isClaimingAll, setIsClaimingAll] = React.useState(false)
      const [actionNotice, setActionNotice] = React.useState('')

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
            if (action?.action === 'refresh') setLastProbeTs(Date.now())
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

      // 活跃轮询
      React.useEffect(() => {
        const interval = activeTab === 'logs' ? 2000 : 8000
        const timer = setInterval(() => { void request(undefined, { silent: true }) }, interval)
        const onFocus = () => { void request({ action: 'refresh' }, { silent: true }) }
        window.addEventListener('focus', onFocus)
        return () => {
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [request, activeTab])

      const act = React.useCallback(async (action) => {
        return request(action)
      }, [request])

      // 全量额度探测带状态反馈
      const handleProbeAll = React.useCallback(async () => {
        setIsProbing(true)
        setActionNotice('正在探测各账号最新额度与礼包…')
        try {
          await request({ action: 'refresh' })
          setActionNotice('✓ 全量探测完成，额度数据已更新至最新')
          setTimeout(() => setActionNotice(''), 4000)
        } catch (e) {
          setActionNotice('探测失败: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
          setIsProbing(false)
        }
      }, [request])

      // 智能全领带真实状态反馈
      const handleClaimAll = React.useCallback(async () => {
        setIsClaimingAll(true)
        setActionNotice('正在执行智能全领，检测所有账号待领福利…')
        try {
          const data = await request({ action: 'claim' })
          const claimed = data?.claim?.claimed || []
          const failed = data?.claim?.failed || []
          if (claimed.length > 0) {
            setActionNotice(`✓ 成功领取 ${claimed.length} 项福利：${claimed.join(', ')}`)
          } else if (failed.length > 0 && !failed.every((f) => f.skipped)) {
            setActionNotice(`部分礼包领取失败：${failed[0].error || '请稍后重试'}`)
          } else {
            setActionNotice('✓ 智能全领已执行：当前暂无待领取的周末福利礼包（已全部在账）')
          }
          setTimeout(() => setActionNotice(''), 5000)
        } catch (e) {
          setActionNotice('领取出错: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
          setIsClaimingAll(false)
        }
      }, [request])

      // 单账号静默领取
      const handleClaimSingle = React.useCallback(async (account) => {
        const id = account.id
        setAccountClaimStatus((prev) => ({ ...prev, [id]: 'claiming' }))
        try {
          const data = await request({ action: 'claim', only: [id] }, { silent: true })
          const failedList = data?.claim?.failed || []
          if (failedList.length > 0 && !failedList.every((f) => f.skipped)) {
            setAccountClaimStatus((prev) => ({ ...prev, [id]: 'error' }))
            setAccountClaimMsg((prev) => ({ ...prev, [id]: failedList[0].error || '领取失败，请点击重试' }))
          } else {
            setAccountClaimStatus((prev) => ({ ...prev, [id]: 'done' }))
            setTimeout(() => {
              setAccountClaimStatus((prev) => ({ ...prev, [id]: null }))
            }, 3000)
          }
        } catch (e) {
          setAccountClaimStatus((prev) => ({ ...prev, [id]: 'error' }))
          setAccountClaimMsg((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }))
        }
      }, [request])

      // 启停账号
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

      // 移除账号
      const handleRemoveAccount = (account) => {
        const isDesktop = account.source === 'desktop'
        const promptMsg = isDesktop
          ? `确定要从插件中移除本机桌面账号「${account.userName || account.label || account.id}」吗？\n（注：不会删除桌面端原生文件，仅不再由插件接管调度）`
          : `确定要移除账号「${account.userName || account.label || account.id}」吗？`
        if (!window.confirm(promptMsg)) return
        setState((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            accounts: (prev.accounts || []).filter((a) => a.id !== account.id),
          }
        })
        void act({ action: 'remove-account', id: account.id })
      }

      // 启停网关
      const handleToggleGateway = (checked) => {
        setState((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            gateway: { ...(prev.gateway || {}), running: checked },
          }
        })
        void act({ action: checked ? 'gateway-start' : 'gateway-stop' })
      }

      // 设置网关默认路由模型
      const handleSetDefaultModel = (modelId) => {
        setState((prev) => (prev ? { ...prev, defaultModel: modelId } : prev))
        void act({ action: 'set-default-model', modelId })
      }

      if (state === null) {
        return h('div', { className: 'dxz-ios-root', style: { padding: '40px 16px', textAlign: 'center' } },
          h('div', { style: { opacity: 0.6 } }, t(pending ? 'loading' : 'unavailable')))
      }

      const accounts = Array.isArray(state.accounts) ? state.accounts : []
      const logs = Array.isArray(state.logs) ? state.logs : []
      const gateway = state.gateway ?? { running: false }
      const models = Array.isArray(state.models) ? state.models : []
      const channelMode = state.channelMode ?? 'cli'
      const nowSec = Math.floor(Date.now() / 1000)

      // ── 算力池分模型聚合统计计算 ──────────────────────────────────────
      let flashPoolAvail = 0
      let flashPoolGrant = 0
      let flashAccountsCount = 0

      let mainPoolAvail = 0
      let mainPoolGrant = 0
      let mainAccountsCount = 0

      let totalClaimableCount = 0

      for (const acc of accounts) {
        const balances = Array.isArray(acc.welfare?.balances) ? acc.welfare.balances : []
        const plans = Array.isArray(acc.welfare?.plans) ? acc.welfare.plans : []

        // 探测未领福利
        if (plans.some((p) => p.claimable)) totalClaimableCount++

        // Flash 模型统计
        const flashBal = balances.find((b) => String(b.show_name || b.model_name || '').toLowerCase().includes('flash'))
        if (flashBal) {
          const avail = Number(flashBal.available_units ?? flashBal.remaining_units ?? 0)
          const total = Number(flashBal.total_units || 500000000)
          flashPoolAvail += avail
          flashPoolGrant += total
          flashAccountsCount++
        } else if (plans.some((p) => String(p.name || '').toLowerCase().includes('flash') || String(p.planId || '').toLowerCase().includes('weekend'))) {
          flashPoolGrant += 500000000
          flashAccountsCount++
        }

        // GLM-5.3 满血模型统计
        const mainBal = balances.find((b) => !String(b.show_name || b.model_name || '').toLowerCase().includes('flash') && String(b.show_name || b.model_name || '').includes('5.3'))
        if (mainBal) {
          const avail = Number(mainBal.available_units ?? mainBal.remaining_units ?? 0)
          const total = Number(mainBal.total_units || 3000000)
          mainPoolAvail += avail
          mainPoolGrant += total
          mainAccountsCount++
        }
      }

      // 全池总可用额度与总配额
      const poolAvailTotal = flashPoolAvail + mainPoolAvail
      const poolGrantTotal = (flashPoolGrant + mainPoolGrant) || 2500000000
      const poolAvailPctVal = poolGrantTotal > 0 ? ((poolAvailTotal / poolGrantTotal) * 100) : 100
      const poolAvailPctStr = poolAvailPctVal >= 99.9 ? '99.9%' : (poolAvailPctVal > 0 ? `${poolAvailPctVal.toFixed(1)}%` : '0%')

      const flashPctVal = flashPoolGrant > 0 ? ((flashPoolAvail / flashPoolGrant) * 100) : 100
      const flashPctStr = flashPctVal >= 99.9 ? '99.9%' : (flashPctVal > 0 ? `${flashPctVal.toFixed(1)}%` : '0%')

      const mainPctVal = mainPoolGrant > 0 ? ((mainPoolAvail / mainPoolGrant) * 100) : 100
      const mainPctStr = mainPctVal >= 99.9 ? '100%' : (mainPctVal > 0 ? `${mainPctVal.toFixed(1)}%` : '0%')

      // 探测相对时间
      const probeSecAgo = Math.max(0, Math.floor((Date.now() - lastProbeTs) / 1000))
      const probeTimeDesc = probeSecAgo < 10 ? '刚刚' : (probeSecAgo < 60 ? `${probeSecAgo}秒前` : `${Math.floor(probeSecAgo / 60)}分钟前`)

      // ── 账号管理标签页 ───────────────────────────────────────────────
      function renderAccountsTab() {
        const elements = []

        // 2. 工具栏 (单行极简：数量 / 模型管理 / 直连模式切换 / 快速接入)
        elements.push(h('div', { key: 'acc-toolbar', className: 'dxz-toolbar-row' },
          h('div', { className: 'dxz-toolbar-left' },
            h('span', { className: 'dxz-count-badge' }, `账号列表 (${accounts.length})`),
            h('button', {
              type: 'button',
              className: 'dxz-ios-btn dxz-ios-btn-models' + (showModels ? ' active' : ''),
              onClick: () => setShowModels(!showModels),
              title: '展开/收起 ZCode 官方专属模型管理',
            }, h(IconBox, { size: 13 }), `模型管理 (${models.length})`),
            h('button', {
              type: 'button',
              className: 'dxz-hub-ch-capsule ' + (channelMode === 'direct' ? 'direct' : 'cli'),
              title: channelMode === 'direct' ? '当前：官方直连高速通道（点击切换为 CLI 模式）' : '当前：官方 CLI 内核代理（点击切换为 直连通道）',
              onClick: () => {
                const next = channelMode === 'direct' ? 'cli' : 'direct'
                setState((prev) => (prev ? { ...prev, channelMode: next } : prev))
                void act({ action: 'set-channel-mode', mode: next })
              },
            }, channelMode === 'direct' ? '⚡ 直连通道 ⇄ CLI模式' : '💻 CLI模式 ⇄ 直连通道')),
          h('div', { className: 'dxz-toolbar-right' },
            h('button', {
              type: 'button',
              className: 'dxz-ios-btn',
              disabled: pending,
              onClick: () => { void act({ action: 'login', provider: 'bigmodel' }) },
            }, t('loginCn')),
            h('button', {
              type: 'button',
              className: 'dxz-ios-btn',
              disabled: pending,
              onClick: () => { void act({ action: 'login', provider: 'zai' }) },
            }, t('loginGlobal')))))

        // 3. 模型管理展开区 (如果被激活)
        if (showModels) {
          elements.push(h('div', {
            key: 'models-drawer',
            style: {
              background: '#11141c',
              border: '1px solid var(--dxz-border-card)',
              borderRadius: 14,
              padding: 12,
              marginBottom: 12,
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
              h('span', { style: { fontSize: 12.5, fontWeight: 700 } }, '官方专属模型与网关默认路由'),
              h('input', {
                type: 'text',
                placeholder: '过滤模型…',
                value: modelSearch,
                onChange: (e) => setModelSearch(e.target.value),
                style: {
                  background: '#090b10',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  padding: '3px 8px',
                  color: '#fff',
                  fontSize: 11,
                  width: 140,
                },
              })),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' } },
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
                      background: 'rgba(255,255,255,0.03)',
                      padding: '5px 8px',
                      borderRadius: 8,
                    },
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                      h('span', { style: { fontSize: 11.5, fontWeight: 650, color: isDefault ? 'var(--dxz-gold)' : '#fff' } }, mid),
                      isDefault ? h('span', { className: 'dxz-badge-tag dxz-badge-gold' }, '网关默认') : null),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                      !isDefault ? h('button', {
                        type: 'button',
                        className: 'dxz-ios-btn',
                        style: { padding: '2px 6px', fontSize: 10 },
                        onClick: () => handleSetDefaultModel(mid),
                      }, '设为默认') : null,
                      h(CopyButton, { text: mid, label: '复制' })))
                }))))
        }

        // 4. 账号卡片列表 (双轨精密仪表座舱)
        if (accounts.length === 0) {
          elements.push(h('div', {
            key: 'empty-acc',
            style: {
              background: 'var(--dxz-bg-card)',
              border: '1px solid var(--dxz-border-card)',
              borderRadius: 16,
              padding: '36px 16px',
              textAlign: 'center',
              opacity: 0.6,
            },
          }, t('accountsEmpty')))
        } else {
          for (const account of accounts) {
            const balancesList = Array.isArray(account.welfare?.balances) ? account.welfare.balances : []
            const plansList = Array.isArray(account.welfare?.plans) ? account.welfare.plans : []
            const claimablePlans = plansList.filter((p) => p.claimable)
            const isClaiming = accountClaimStatus[account.id] === 'claiming'
            const isClaimDone = accountClaimStatus[account.id] === 'done'

            // 头像与来源
            const isDesktop = account.source === 'desktop'
            const isDual = Array.isArray(account.relatedIds) && account.relatedIds.length > 1
            const p = account.provider
            const providerLabel = p === 'zai' ? (isDual ? '国际站·双通道' : '国际站·zai') : (isDual ? '国内站·双通道' : '国内站·智谱')
            // 头像严格遵循 6 色规范（深钛灰微晶体）
            const avatarBg = 'linear-gradient(135deg, #2e3039 0%, #19191d 100%)'
            const avatarChar = (account.userName || account.label || account.id || 'Z').charAt(0).toUpperCase()

            // 方案 C: 计算账号生命周期时间戳与流速进度
            let accEffAt = 0
            let accEndsAt = 0
            for (const pl of plansList) {
              const eff = Number(pl.effectiveAt ?? pl.effective_at ?? 0)
              const end = Number(pl.endsAt ?? pl.ends_at ?? pl.expiry ?? pl.expires_at ?? 0)
              if (eff > 0 && (!accEffAt || eff < accEffAt)) accEffAt = eff
              if (end > nowSec && (!accEndsAt || end > accEndsAt)) accEndsAt = end
            }
            if (!accEffAt && accEndsAt > 0) {
              accEffAt = Math.max(0, accEndsAt - 58 * 3600)
            }

            let elapsedSec = 0
            let totalSec = 1
            let lifecyclePct = 0
            let remainingSec = 0
            let remH = 0
            let remM = 0
            let elapsedH = '0'

            if (accEndsAt > 0) {
              remainingSec = Math.max(0, accEndsAt - nowSec)
              remH = Math.floor(remainingSec / 3600)
              remM = Math.floor((remainingSec % 3600) / 60)

              if (accEffAt > 0 && accEndsAt > accEffAt) {
                totalSec = accEndsAt - accEffAt
                elapsedSec = Math.max(0, nowSec - accEffAt)
                lifecyclePct = Math.min(100, Math.max(0, (elapsedSec / totalSec) * 100))
                elapsedH = (elapsedSec / 3600).toFixed(1)
              }
            }

            // 账号级总可用额度计算
            const accTotalAvail = Number(account.welfare?.availableUnits ?? 0) ||
              balancesList.reduce((s, b) => s + Number(b.available_units ?? b.remaining_units ?? 0), 0)
            const accTotalGrant = balancesList.reduce((s, b) => s + Number(b.total_units || 0), 0) || (accTotalAvail > 0 ? 503000000 : 500000000)
            const accPctVal = accTotalGrant > 0 ? ((accTotalAvail / accTotalGrant) * 100) : 100
            const accPctStr = accPctVal >= 99.9 ? '99.9%' : (accPctVal > 0 ? `${accPctVal.toFixed(1)}%` : '0%')

            // 模型通道明细 (Flash & 5.3)
            const flashBal = balancesList.find((b) => String(b.show_name || b.model_name || '').toLowerCase().includes('flash'))
            const mainBal = balancesList.find((b) => !String(b.show_name || b.model_name || '').toLowerCase().includes('flash') && String(b.show_name || b.model_name || '').includes('5.3'))

            const flashAvail = Number(flashBal?.available_units ?? flashBal?.remaining_units ?? 0)
            const flashGrant = Number(flashBal?.total_units || 500000000)
            const flashPct = flashGrant > 0 ? Math.min(100, Math.max(0, (flashAvail / flashGrant) * 100)) : 100

            const mainAvail = Number(mainBal?.available_units ?? mainBal?.remaining_units ?? 0)
            const mainGrant = Number(mainBal?.total_units || 3000000)
            const mainPct = mainGrant > 0 ? Math.min(100, Math.max(0, (mainAvail / mainGrant) * 100)) : 100

            // 循环重置时钟与倒计时
            let resetDesc = '每日 00:00 自动刷新 (准时就绪)'
            for (const b of balancesList) {
              const exp = Number(b.expiry ?? b.expires_at ?? b.period_end ?? b.ends_at ?? 0)
              if (exp > nowSec) {
                const diff = exp - nowSec
                const hVal = Math.floor(diff / 3600)
                const mVal = Math.floor((diff % 3600) / 60)
                resetDesc = `倒计时 ${hVal > 0 ? hVal + '小时' : ''}${mVal}分`
                break
              }
            }

            // 倒计时与时效描述 (简约呈现，无进度条)
            let countdownNode = null
            if (accEndsAt > nowSec) {
              const remSec = accEndsAt - nowSec
              const remH = Math.floor(remSec / 3600)
              const remM = Math.floor((remSec % 3600) / 60)
              const remStr = remH > 0 ? `${remH}小时${remM}分` : `${remM}分`
              const dateStr = fmtDateTime(accEndsAt)
              countdownNode = h('div', { className: 'countdown-badge' },
                '⏳ 剩 ',
                h('span', { className: 'digits' }, remStr),
                h('small', null, `至 ${dateStr} 截止`))
            } else {
              countdownNode = h('div', { className: 'countdown-badge', style: { color: 'var(--dxz-text-muted)' } },
                '长期有效')
            }

            const cardStreams = []

            // 若有待领福利包，插入高亮提示行
            if (claimablePlans.length > 0) {
              cardStreams.push(h('div', { key: 'claim-alert', className: 'acc-detail-stream banner-tag' },
                h('div', { className: 'detail-stream-left' },
                  h('span', { style: { color: 'var(--dxz-orange)', fontWeight: 700 } }, '🎁 周末 5 亿福利礼包待领取'),
                  h('span', { style: { fontSize: 10.5, color: 'var(--dxz-text-muted)' } }, '(未入账)')),
                h('button', {
                  type: 'button',
                  className: 'dxz-btn-track-claim',
                  disabled: isClaiming,
                  onClick: () => handleClaimSingle(account),
                }, isClaiming ? '⏳ 领取中…' : '🎁 立即领取')))
            }

            // Flash 额度流
            cardStreams.push(h('div', { key: 'flash-stream', className: 'acc-detail-stream' },
              h('div', { className: 'detail-stream-left' },
                h('span', { className: 'model-pill' }, '⚡ GLM-5.3-Flash'),
                h('span', { className: 'quota-exact' }, fmtNumber(flashAvail)),
                h('span', { className: 'quota-pack-desc' }, `Tok (${fmtTokens(flashAvail)} · ${flashPctStr})`),
                h('span', { className: 'tag-deduct' }, '✓ 优先')),
              countdownNode))

            // 若有 GLM-5.3 满血版，插入满血额度流行
            if (mainBal) {
              cardStreams.push(h('div', { key: 'main-stream', className: 'acc-detail-stream' },
                h('div', { className: 'detail-stream-left' },
                  h('span', { className: 'model-pill crown' }, '👑 GLM-5.3 满血版'),
                  h('span', { className: 'quota-exact', style: { color: 'var(--dxz-orange)' } }, fmtNumber(mainAvail)),
                  h('span', { className: 'quota-pack-desc' }, `Tok (${fmtTokens(mainAvail)} · ${mainPctStr})`)),
                h('div', { className: 'countdown-badge', style: { opacity: 0.75, color: 'var(--dxz-text-muted)' } },
                  '每早 00:00 循环重置')))
            }

            const idShort = String(account.id || '').replace(/^zc-/, '').slice(0, 6)
            const subText = `${isDesktop ? '本机桌面端' : (providerLabel || '国际站')} · zc-${idShort}`

            elements.push(h('div', { key: account.id, className: 'acc-glass-card' + (account.enabled ? '' : ' disabled') },
              // Row 1: 主信息与操作行
              h('div', { className: 'acc-main-row' },
                h('div', { className: 'acc-left-meta' },
                  h('div', { className: 'acc-avatar', style: { background: avatarBg } }, avatarChar),
                  h('div', { className: 'acc-name-box' },
                    h('span', { className: 'acc-name' }, account.userName || account.label || account.id),
                    h('span', { className: 'acc-sub' }, subText))),
                h('div', { className: 'acc-right-actions' },
                  mainBal ? h('span', { className: 'dual-mode-pill' }, `双模总计: ${fmtTokens(accTotalAvail)} (${accPctStr})`) : null,
                  h(CupertinoSwitch, {
                    checked: account.enabled,
                    title: account.enabled ? '停用此账号' : '启用此账号',
                    onChange: (checked) => handleToggleAccount(account, checked),
                  }),
                  h('button', {
                    type: 'button',
                    className: 'btn-remove',
                    onClick: () => handleRemoveAccount(account),
                  }, '移除'))),
              // Row 2+: 额度详情单行流线
              cardStreams))
          }
        }

        return h('div', { style: { display: 'flex', flexDirection: 'column' } }, elements)
      }

      // ── 网关服务标签页 (单行模块化一体座舱升级) ──────────────────────
      function renderGatewayTab() {
        const base = 'http://' + (gateway.host || '127.0.0.1') + ':' + (gateway.port || 8799)
        const endpointOpenAI = base + '/v1/chat/completions'
        const endpointAnthropic = base + '/v1'

        return h('div', { style: { display: 'flex', flexDirection: 'column' } },
          // 创新：单行一体化四分位模块座舱条 (Modular 4-Column Cockpit Ribbon)
          h('div', { className: 'dxz-gw-matrix' },
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-head' }, '监听接口'),
              h('div', { className: 'dxz-gw-tile-num', style: { color: '#38bdf8' } }, `127.0.0.1:${gateway.port || 8799}`)),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-head' }, '服务状态'),
              h('div', { className: 'dxz-gw-tile-num', style: { color: gateway.running ? 'var(--dxz-green)' : 'var(--dxz-red)' } },
                gateway.running ? '● 运行中' : '○ 已停止')),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-head' }, '累计转发分发'),
              h('div', { className: 'dxz-gw-tile-num', style: { color: 'var(--dxz-orange)' } },
                `${gateway.metrics?.totalRequests || logs.length} `,
                h('span', { style: { fontSize: 10, color: 'var(--dxz-text-muted)' } }, '次'))),
            h('div', { className: 'dxz-gw-tile' },
              h('div', { className: 'dxz-gw-tile-head' }, '通道健康指数'),
              h('div', { className: 'dxz-gw-tile-num', style: { color: 'var(--dxz-green)' } },
                '100% ',
                h('span', { style: { fontSize: 10, color: 'var(--dxz-text-muted)' } }, '满血')))),

          // 主控启停开关卡片
          h('div', { className: 'dxz-gw-master-card' },
            h('div', null,
              h('div', { className: 'dxz-gw-master-title' }, '统一转发网关主控'),
              h('div', { className: 'dxz-gw-master-desc' }, '开启后自动接管 Cursor / Claude Code / Cherry Studio / Cline / Windsurf 流量')),
            h(CupertinoSwitch, {
              checked: gateway.running,
              title: gateway.running ? '点击停止网关' : '点击启动网关',
              onChange: (checked) => handleToggleGateway(checked),
            })),

          // 端点 1: Anthropic 原生直连端点
          h('div', { className: 'dxz-gw-endpoint' },
            h('div', { className: 'dxz-gw-ep-head' },
              h('span', { className: 'dxz-gw-ep-title' }, '⚡ Anthropic 原生协议端点 (Claude Code / Cursor / Cherry)'),
              h('span', { className: 'dxz-badge-tag dxz-badge-green' }, '极速免转译')),
            h('div', { className: 'dxz-gw-ep-codebox' },
              h('span', null, endpointAnthropic),
              h(CopyButton, { text: endpointAnthropic, label: '复制端点' }))),

          // 端点 2: OpenAI 兼容协议端点
          h('div', { className: 'dxz-gw-endpoint' },
            h('div', { className: 'dxz-gw-ep-head' },
              h('span', { className: 'dxz-gw-ep-title' }, '🌐 OpenAI 兼容协议端点 (Chat Completions 标准接口)'),
              h('span', { className: 'dxz-badge-tag dxz-badge-gold' }, '通用适配')),
            h('div', { className: 'dxz-gw-ep-codebox' },
              h('span', null, endpointOpenAI),
              h(CopyButton, { text: endpointOpenAI, label: '复制端点' }))),

          // 提示信息
          h('div', { className: 'dxz-gw-hint-box' },
            '提示：本地免密通道已开启，任意 IDE / CLI 工具均可免填 API-Key 零门槛直连；如需更换端口请在配置文件中设定后点击重启生效。'))
      }

      // ── 调用记录标签页 (单行模块化一体座舱升级) ──────────────────────
      function renderLogsTab() {
        const totalCalls = logs.length
        const failedCalls = logs.filter((l) => !l.ok).length
        const successRate = totalCalls > 0 ? `${(((totalCalls - failedCalls) / totalCalls) * 100).toFixed(1)}%` : '100%'
        const avgDuration = totalCalls > 0 ? Math.round(logs.reduce((s, l) => s + (Number(l.durationMs) || 0), 0) / totalCalls) : 0
        const totalTokens = logs.reduce((s, l) => s + (Number(l.tokens?.total) || Number(l.tokens?.input || 0) + Number(l.tokens?.output || 0)), 0)

        // 缓存指标统计 (总提示词 = 未命中输入 + 命中缓存；缓存命中率 = 命中缓存 / 总提示词)
        const totalCachedTokens = logs.reduce((s, l) => s + (Number(l.tokens?.cached) || 0), 0)
        const totalInputTokens = logs.reduce((s, l) => s + (Number(l.tokens?.input) || 0), 0)
        const totalPromptTokens = totalInputTokens + totalCachedTokens
        const overallCacheRate = totalPromptTokens > 0
          ? `${((totalCachedTokens / totalPromptTokens) * 100).toFixed(1)}%`
          : '0%'

        return h('div', { style: { display: 'flex', flexDirection: 'column' } },
          // 创新：单行一体化四分位指标条 (Modular 4-Column KPI Ribbon)
          h('div', { className: 'dxz-log-metrics' },
            h('div', { className: 'dxz-log-metric-card' },
              h('div', { className: 'dxz-log-metric-lbl' }, '总请求次数'),
              h('div', { className: 'dxz-log-metric-val', style: { color: '#fff' } },
                totalCalls,
                h('span', { style: { fontSize: 10, color: 'var(--dxz-text-muted)', marginLeft: 3 } }, '次'))),
            h('div', { className: 'dxz-log-metric-card' },
              h('div', { className: 'dxz-log-metric-lbl' }, 'Token 消耗量'),
              h('div', { className: 'dxz-log-metric-val', style: { color: 'var(--dxz-orange)' } }, fmtTokens(totalTokens))),
            h('div', { className: 'dxz-log-metric-card', style: { background: 'rgba(16, 185, 129, 0.06)' } },
              h('div', { className: 'dxz-log-metric-lbl', style: { color: '#6ee7b7' } }, '综合缓存命中'),
              h('div', { className: 'dxz-log-metric-val', style: { color: 'var(--dxz-green)' } },
                overallCacheRate,
                totalCachedTokens > 0
                  ? h('span', { style: { fontSize: 9.5, color: '#6ee7b7', marginLeft: 3 } }, `(省 ${fmtTokens(totalCachedTokens)})`)
                  : null)),
            h('div', { className: 'dxz-log-metric-card' },
              h('div', { className: 'dxz-log-metric-lbl' }, '平均响应 · 成功率'),
              h('div', { className: 'dxz-log-metric-val', style: { color: '#38bdf8' } },
                `${avgDuration}`,
                h('span', { style: { fontSize: 10, color: 'var(--dxz-text-muted)' } }, 'ms'),
                ` · ${successRate}`))),

          // 清理操作栏
          h('div', { className: 'dxz-log-toolbar' },
            h('span', { className: 'dxz-log-title' }, `实时审计流水 (最近 ${Math.min(logs.length, 50)} 条)`),
            h('div', { className: 'dxz-log-actions' },
              failedCalls > 0 ? h('button', {
                type: 'button',
                className: 'dxz-btn-log-action danger',
                onClick: () => { void act({ action: 'logs-clear-failed' }) },
              }, '清空异常') : null,
              h('button', {
                type: 'button',
                className: 'dxz-btn-log-action',
                onClick: () => { void act({ action: 'logs-clear' }) },
              }, '清空全部记录'))),

          // 8 列无水平滚动条紧凑网格表格 (Token + 缓存复合呈现)
          h('div', { className: 'dxz-log-table-wrap' },
            h('div', { className: 'dxz-log-grid head' },
              h('div', null, '时间'),
              h('div', null, '账号'),
              h('div', null, '渠道'),
              h('div', null, '模型'),
              h('div', null, '状态'),
              h('div', null, '耗时'),
              h('div', null, 'Tokens (省/存)'),
              h('div', { style: { textAlign: 'right' } }, '详情')),

            logs.length === 0
              ? h('div', { style: { padding: '24px 12px', textAlign: 'center', opacity: 0.5, fontSize: 11 } }, '暂无调用审计记录')
              : logs.slice(0, 50).map((log, idx) => {
                const ch = log.channel === 'direct' ? '直连' : 'CLI'
                const chColor = log.channel === 'direct' ? 'var(--dxz-green)' : 'var(--dxz-orange)'
                const tokTotal = Number(log.tokens?.total) || (Number(log.tokens?.input || 0) + Number(log.tokens?.output || 0))
                const inputNum = Number(log.tokens?.input) || 0
                const cachedNum = Number(log.tokens?.cached) || 0
                const promptTotal = inputNum + cachedNum
                let cacheRatePctStr = '0%'
                if (promptTotal > 0) {
                  cacheRatePctStr = `${((cachedNum / promptTotal) * 100).toFixed(1)}%`
                } else if (Number(log.tokens?.cacheRate) > 0) {
                  const cr = Number(log.tokens?.cacheRate)
                  cacheRatePctStr = `${(cr > 1 ? cr : cr * 100).toFixed(1)}%`
                }
                return h('div', { key: log.id || idx, className: 'dxz-log-grid item', title: log.ok ? undefined : (log.error || '调用失败') },
                  h('div', { className: 'dxz-log-col-mono', style: { color: 'var(--dxz-text-gray)' } }, fmtTime(Math.floor(log.at / 1000))),
                  h('div', { style: { color: '#fff', fontWeight: 650 } }, log.account || '—'),
                  h('div', null,
                    h('span', { className: 'dxz-badge-tag', style: { background: 'rgba(255,255,255,0.08)', color: chColor } }, ch)),
                  h('div', { className: 'dxz-log-col-mono', style: { color: 'var(--dxz-orange)', fontWeight: 600 } }, log.model || '—'),
                  h('div', null,
                    h('span', { className: 'dxz-badge-tag ' + (log.ok ? 'dxz-badge-green' : 'dxz-badge-gray'), style: { color: log.ok ? 'var(--dxz-green)' : 'var(--dxz-red)' } },
                      log.ok ? '200' : 'ERR')),
                  h('div', { className: 'dxz-log-col-mono', style: { color: 'var(--dxz-green)' } }, fmtDuration(log.durationMs)),
                  h('div', { className: 'dxz-log-col-mono' },
                    h('div', { style: { fontWeight: 700, color: '#fff', lineHeight: 1.1 } }, tokTotal > 0 ? fmtNumber(tokTotal) : '—'),
                    cachedNum > 0
                      ? h('div', { className: 'dxz-cache-pill' }, `省 ${fmtTokens(cachedNum)} (${cacheRatePctStr})`)
                      : (tokTotal > 0 ? h('div', { className: 'dxz-cache-none-pill' }, '无缓存 0%') : null)),
                  h('div', { style: { textAlign: 'right' } },
                    h('button', {
                      type: 'button',
                      className: 'dxz-btn-remove',
                      style: { color: '#38bdf8' },
                      onClick: () => setSelectedLog(log),
                    }, '详情')))
              })),

          // 审计详情弹窗 (含缓存分解)
          selectedLog ? h('div', {
            className: 'dxz-log-modal-overlay',
            onClick: () => setSelectedLog(null),
          },
            h('div', {
              className: 'dxz-log-modal',
              onClick: (e) => e.stopPropagation(),
            },
              h('div', { className: 'dxz-log-modal-head' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { style: { fontSize: 13, fontWeight: 700 } }, '调用审计详情'),
                  h('span', { className: 'dxz-badge-tag ' + (selectedLog.ok ? 'dxz-badge-green' : 'dxz-badge-gray') },
                    selectedLog.ok ? 'SUCCESS 200' : 'FAILED')),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h(CopyButton, { text: JSON.stringify(selectedLog, null, 2), label: '复制全部' }),
                  h('button', {
                    type: 'button',
                    className: 'dxz-ios-btn',
                    style: { padding: '2px 8px', fontSize: 11 },
                    onClick: () => setSelectedLog(null),
                  }, '关闭'))),
              h('div', { className: 'dxz-log-modal-body' },
                // 缓存与 Token 结构化拆解卡片
                (() => {
                  const selInput = Number(selectedLog.tokens?.input) || 0
                  const selCached = Number(selectedLog.tokens?.cached) || 0
                  const selPromptTotal = selInput + selCached
                  let selCachePct = '0%'
                  if (selPromptTotal > 0) {
                    selCachePct = `${((selCached / selPromptTotal) * 100).toFixed(1)}%`
                  } else if (Number(selectedLog.tokens?.cacheRate) > 0) {
                    const cr = Number(selectedLog.tokens?.cacheRate)
                    selCachePct = `${(cr > 1 ? cr : cr * 100).toFixed(1)}%`
                  }
                  return h('div', { style: { marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' } },
                    h('div', { style: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginBottom: 6 } }, 'Token 与缓存明细拆解'),
                    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, textAlign: 'center' } },
                      h('div', { style: { background: 'rgba(255,255,255,0.04)', padding: 6, borderRadius: 3 } },
                        h('div', { style: { color: 'var(--dxz-text-muted)', fontSize: 9.5 } }, '输入 Tokens'),
                        h('div', { style: { color: '#fff', fontWeight: 700, marginTop: 2, fontSize: 11 } }, fmtNumber(selInput))),
                      h('div', { style: { background: 'rgba(16,185,129,0.1)', padding: 6, borderRadius: 3, border: '0.5px solid rgba(16,185,129,0.3)' } },
                        h('div', { style: { color: 'var(--dxz-green)', fontSize: 9.5 } }, '命中缓存'),
                        h('div', { style: { color: 'var(--dxz-green)', fontWeight: 800, marginTop: 2, fontSize: 11 } },
                          `${fmtNumber(selCached)} (${selCachePct})`)),
                      h('div', { style: { background: 'rgba(255,255,255,0.04)', padding: 6, borderRadius: 3 } },
                        h('div', { style: { color: 'var(--dxz-text-muted)', fontSize: 9.5 } }, '输出 Tokens'),
                        h('div', { style: { color: '#fff', fontWeight: 700, marginTop: 2, fontSize: 11 } }, fmtNumber(selectedLog.tokens?.output || 0))),
                      h('div', { style: { background: 'rgba(245,158,11,0.1)', padding: 6, borderRadius: 3, border: '0.5px solid rgba(245,158,11,0.3)' } },
                        h('div', { style: { color: 'var(--dxz-orange)', fontSize: 9.5 } }, '净结算扣除'),
                        h('div', { style: { color: 'var(--dxz-orange)', fontWeight: 800, marginTop: 2, fontSize: 11 } },
                          fmtNumber(Number(selectedLog.tokens?.total) || (selInput + Number(selectedLog.tokens?.output || 0)))))))
                })(),
                h('pre', { style: { margin: 0, fontFamily: 'var(--dxz-mono)', fontSize: 10.5, color: 'var(--dxz-orange)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } },
                  JSON.stringify(selectedLog, null, 2))))) : null)
      }

      // ── 页面顶级装配 ──────────────────────────────────────────────────
      const pageElements = []

      // 全池福利时效汇总计算
      let poolEffAt = 0
      let poolEndsAt = 0
      for (const acc of accounts) {
        const plList = Array.isArray(acc.welfare?.plans) ? acc.welfare.plans : []
        for (const pl of plList) {
          const eff = Number(pl.effectiveAt ?? pl.effective_at ?? 0)
          const end = Number(pl.endsAt ?? pl.ends_at ?? pl.expiry ?? pl.expires_at ?? 0)
          if (eff > 0 && (!poolEffAt || eff < poolEffAt)) poolEffAt = eff
          if (end > nowSec && (!poolEndsAt || end > poolEndsAt)) poolEndsAt = end
        }
      }

      // 1. 顶部资产总览 (智谱官方几何矢量微标 + 3D磨砂微倒角)
      const poolRemSec = poolEndsAt > nowSec ? Math.max(0, poolEndsAt - nowSec) : 0
      const poolRemH = Math.floor(poolRemSec / 3600)
      const poolRemM = Math.floor((poolRemSec % 3600) / 60)

      const zhipuSvgVNode = h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none' },
        h('defs', null,
          h('linearGradient', { id: 'zGradBig', x1: '0', y1: '0', x2: '1', y2: '1' },
            h('stop', { offset: '0%', stopColor: '#ffffff' }),
            h('stop', { offset: '100%', stopColor: '#94a3b8' }))),
        h('path', {
          fill: 'url(#zGradBig)',
          d: 'M18.25 3A2.75 2.75 0 0 1 21 5.75v12.5A2.75 2.75 0 0 1 18.25 21H5.75A2.75 2.75 0 0 1 3 18.25V5.75A2.75 2.75 0 0 1 5.75 3zm-5.01 3.74L5.81 17.267h4.954l7.431-10.529zm-.08 8.977c-.24 0-.465.12-.598.312l-.873 1.239h6.193v-1.551zM6.121 8.284h4.729c.24 0 .466-.12.6-.312l.865-1.233c-.009 0-6.182.001-6.194-.006z',
        }))

      pageElements.push(h('div', { key: 'studio-hub', className: 'dxz-studio-hub' },

        
        // 顶行：品牌 + 按钮对
        h('div', { className: 'dxz-hub-top-row' },
          h('div', { className: 'dxz-hub-brand' },
            h('div', { className: 'dxz-brand-logo-zhipu' }, zhipuSvgVNode),
            h('div', { className: 'dxz-hub-title' }, 'DXZCode 算力储备池')),
          h('div', { className: 'dxz-btn-grp' },
            h('button', {
              type: 'button',
              className: 'dxz-btn-dark-glass',
              disabled: pending || isProbing || isClaimingAll,
              title: '全量探测各账号最新额度与福利礼包',
              onClick: () => { void handleProbeAll() },
            }, isProbing ? '⏳ 探测中…' : '⚡ 探测额度'),
            h('button', {
              type: 'button',
              className: 'dxz-btn-orange-3d',
              disabled: pending || isProbing || isClaimingAll,
              title: '一键自动探测并无痕领取所有待领礼包',
              onClick: () => { void handleClaimAll() },
            },
              isClaimingAll ? '⏳ 领取中…' : '✦ 智能全领',
              totalClaimableCount > 0 ? h('span', { className: 'dxz-claim-count-pill' }, totalClaimableCount) : null))),

        // 核心对撞：额度数字 vs 剩余时效
        h('div', { className: 'dxz-hub-hero-split' },
          h('div', { className: 'dxz-hub-big-num' },
            fmtTokens(poolAvailTotal),
            h('small', null, `/ ${fmtTokens(poolGrantTotal)}`),
            h('span', null, `(${poolAvailPctStr} 充足)`)),
          h('div', { className: 'dxz-hub-big-time' },
            '剩余 ',
            h('span', { className: 'time-val' }, poolRemSec > 0 ? `${poolRemH}小时${poolRemM}分` : '长期有效'),
            poolEndsAt > 0 ? h('small', null, `(至 ${fmtDateTime(poolEndsAt)})`) : null))),
        actionNotice ? h('div', { className: 'dxz-action-feedback' }, actionNotice) : null)

      // 2. 通知横幅 (若有异常)
      if (notice !== '') {
        pageElements.push(h('div', {
          key: 'top-banner',
          className: 'dxz-ios-banner' + (failed ? ' error' : ''),
          role: failed ? 'alert' : 'status',
        }, notice))
      }

      // 3. 3 标签页导航 (账号管理 / 网关服务 / 调用记录)
      pageElements.push(h('div', { key: 'tab-bar', className: 'dxz-ios-tabs-wrap' },
        h('div', { className: 'dxz-ios-segmented-bar' },
          [
            { id: 'accounts', label: t('tabAccounts'), icon: IconAccounts },
            { id: 'gateway', label: t('tabGateway'), icon: IconGateway, hasDot: gateway.running },
            { id: 'logs', label: t('tabLogs'), icon: IconLogs },
          ].map((item) =>
            h('button', {
              key: item.id,
              type: 'button',
              className: 'dxz-ios-tab-item' + (activeTab === item.id ? ' active' : ''),
              onClick: () => setActiveTab(item.id),
            },
              h(item.icon, { size: 15 }),
              h('span', null, item.label),
              item.hasDot ? h('span', { className: 'dxz-tab-badge' }) : null)))))

      // 4. 当前标签页主体内容
      let tabContent = null
      if (activeTab === 'accounts') tabContent = renderAccountsTab()
      else if (activeTab === 'gateway') tabContent = renderGatewayTab()
      else if (activeTab === 'logs') tabContent = renderLogsTab()

      pageElements.push(h('div', { key: 'tab-content' }, tabContent))

      // 5. 极简页脚
      pageElements.push(h('div', { key: 'page-footer', className: 'dxz-ios-footer' },
        h('span', null, `${t('version')}: ${state.version ?? '0.3.7'}`),
        h('span', null, `${t('cli')}: ${state.cli?.version ?? (state.cli?.error ? String(state.cli.error).slice(0, 100) : t('cliMissing'))}`)))

      return h('div', { className: 'dxz-ios-root' }, pageElements)
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
