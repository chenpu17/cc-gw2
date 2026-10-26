export default {
  title: '关于',
  description: '查看 cc-gw 的版本信息、构建元数据与运行状态。',
  gateway: {
    address: '网关地址'
  },
  app: {
    title: '应用信息',
    subtitle: '版本与构建元数据一目了然。',
    labels: {
      name: '名称',
      version: '版本',
      buildTime: '构建时间',
      runtime: '后端运行时',
      backendVersion: '后端版本'
    },
    hint: {
      buildTime: '构建时间以 UTC 表示，便于排查部署版本。'
    }
  },
  status: {
    title: '运行状态',
    subtitle: '来自当前网关实例的实时指标。',
    loading: '正在获取运行状态...',
    empty: '未能获取状态信息。',
    labels: {
      providers: '已配置提供商',
      active: '活动请求',
      platform: '运行平台',
      pid: '进程 PID'
    },
    hint: {
      active: '活动请求数每分钟刷新一次，可快速判断当前负载。'
    }
  },
  support: {
    title: '使用提示',
    subtitle: '运行维护说明',
    description: '通过 Web UI 管理提供商、模型路由与日志，高级配置可直接编辑 ~/.cc-gw/config.json。',
    tip: '高级配置建议结合 CLI 使用，可将 ~/.cc-gw/config.json 纳入版本管理或自动化脚本。',
    actions: {
      checkUpdates: '检查更新',
      checkingUpdates: '检查中...'
    }
  },
  update: {
    available: '发现新版本 v{{version}}',
    current: '当前已是最新版本 v{{version}}',
    channel: '更新通道：{{channel}}'
  },
  upgrade: {
    action: '立即升级',
    viewProgress: '查看升级进度',
    autoHint: '一键升级会从 npm 安装新版本并自动重启网关服务。',
    manualHint: '当前安装方式无法从 Web 界面自动升级，请在终端执行：',
    copyCommand: '复制命令',
    copied: '已复制',
    copyFailed: '复制失败',
    reason: {
      unknown: '当前运行方式不支持自动升级。',
      foreground: '服务以前台模式运行，无法自行重启。',
      'not-launched-by-cli': '当前服务不是由 cc-gw CLI 启动，无法自动升级。',
      npx: '通过 npx 临时运行，无法自我升级。',
      'local-build': '本地源码构建无法通过 npm 升级。',
      'not-writable': 'npm 全局目录没有写入权限，请在终端手动执行。',
      'package-manager': 'Windows 下仅支持通过 npm 全局安装的自动升级，请在终端手动执行。'
    },
    confirm: {
      title: '确认升级到 v{{version}}',
      description: '将从 npm 安装新版本并重启网关服务。',
      warning: '升级期间网关会短暂中断服务（通常 10–30 秒；Windows 上因先停服再安装，可能更久）。进行中的请求可能失败，新请求会短暂收到 503，请避免在此时发起重要调用。',
      activeRequests: '当前进行中的请求：{{count}}',
      activeHint: '升级会等待这些请求结束（最多约 15 秒），超时后将强制重启。',
      ack: '我已了解升级会导致短暂的服务中断',
      cancel: '取消',
      confirm: '确认升级',
      starting: '正在启动...'
    },
    progress: {
      title: '正在升级 cc-gw',
      description: '请保持此页面打开；服务重启期间会短暂失去连接。',
      fromTo: 'v{{from}} → v{{to}}',
      phases: {
        preparing: '正在准备升级…',
        installing: '正在从 npm 安装 v{{version}}…',
        draining: '正在等待进行中的请求结束…',
        starting: '正在启动新版本…',
        verifying: '正在校验新版本…'
      },
      drainingHint: '剩余进行中的请求：{{count}}。超时后将强制重启。',
      reconnecting: '正在等待服务重启并重新连接…',
      reconnectingHint: '网关正在重启，页面会在服务恢复后自动更新。',
      success: '已升级到 v{{version}}，服务已恢复。',
      successHint: '若启用了 Web 访问密码，刷新页面后需要重新登录。',
      reload: '刷新页面',
      close: '关闭',
      background: '关闭窗口（升级继续）',
      failedPhase: '升级失败',
      failedHint: '升级未完成，服务可能仍在运行旧版本。',
      rolledBack: '已自动回滚并恢复旧版本 v{{version}}。',
      logPath: '升级日志：{{path}}',
      manualHint: '也可以在终端手动执行：',
      stale: '升级状态已超过 10 分钟未更新（升级进程可能已退出）。请检查服务状态或手动升级。',
      authRequired: '服务已重启，当前登录会话已失效。请刷新页面并重新登录。',
      retry: '重试升级'
    },
    toast: {
      startFailed: '启动升级失败'
    }
  },
  toast: {
    statusError: {
      title: '状态加载失败'
    },
    upToDate: {
      title: '当前已是最新版本 v{{version}}',
      description: 'npm registry 中没有发现更高版本。'
    },
    updateAvailable: {
      title: '发现新版本 v{{version}}',
      description: '可在本页直接升级，或通过 npm install -g {{packageName}} 更新。',
      descriptionAuto: '可在本页点击「立即升级」，服务会短暂中断后自动重启。'
    },
    updateError: {
      title: '检查更新失败'
    }
  }
}
