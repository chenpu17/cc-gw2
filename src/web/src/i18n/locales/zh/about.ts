export default {
  title: '关于',
  description: '查看 cc-gw 的版本信息、构建元数据与运行状态。',
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
      host: '监听地址',
      port: '监听端口',
      providers: '已配置 Provider',
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
    description: '通过 Web UI 管理 Provider、模型路由与日志，高级配置可直接编辑 ~/.cc-gw/config.json。',
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
      description: '可通过 npm install -g {{packageName}} 更新。'
    },
    updateError: {
      title: '检查更新失败'
    }
  }
}
