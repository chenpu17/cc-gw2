export default {
  title: '安全事件',
  description: '查看校验防护与系统检测记录，及时发现异常访问。',
  filters: {
    title: '筛选条件',
    allLevels: '全部级别',
    allTypes: '全部类型',
    typePlaceholder: '按事件类型过滤（可留空）'
  },
  live: '实时更新中',
  reconnecting: '连接中断，重连中…',
  failed: '连接失败 — 切换标签页或刷新以重试',
  actions: {
    newest: '最新',
    older: '更早'
  },
  levels: {
    info: '提示',
    warn: '警告',
    error: '错误'
  },
  empty: {
    title: '暂无事件记录',
    subtitle: '当前没有异常或告警事件，这通常意味着系统运行平稳。',
    filteredTitle: '当前筛选条件下没有匹配事件',
    filteredSubtitle: '可以重置筛选条件，或去请求日志中查看更完整的调用链。',
    actions: {
      logs: '查看请求日志'
    }
  },
  details: '查看详情',
  defaultTitle: '未命名事件',
  defaultMessage: '未提供详细描述。',
  toast: {
    loadFailure: '加载事件失败：{{message}}'
  }
}
