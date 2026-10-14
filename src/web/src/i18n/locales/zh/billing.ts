export default {
  description: '统一货币计费：模型价格、汇率与覆盖。成本为查询期实时估算，改价后历史随之重算。',
  displayCurrency: '展示货币',
  displayCurrencyHint: '所有成本字段（仪表盘 / 日志 / 统计）统一折算到该货币展示。',
  rateLabel: '1 USD = ___ CNY',
  rateHint: '价格条目保留原币（USD/CNY），展示时按此汇率换算（1 CNY ≈ {{value}} USD）。',
  overrides: {
    title: '模型价格覆盖',
    description: '覆盖优先于内置价格表。键为全局 model-id，或 providerId:modelId 限定到单个 Provider。',
    add: '添加覆盖',
    remove: '删除该行',
    key: '模型键',
    keyHint: '精确匹配，不做模糊；如 claude-sonnet-4-5 或 acme:internal-model',
    currency: '币种',
    priceInput: '输入价',
    priceOutput: '输出价',
    priceCacheRead: '缓存读价',
    priceCacheCreation: '缓存写价'
  },
  builtin: {
    title: '内置价格表',
    description: '内置快照仅供参考与兜底，可被上方覆盖替代；单位为每 1M tokens、原币计。',
    filterPlaceholder: '按模型名过滤…',
    empty: '没有匹配的条目。',
    loadError: '价格表加载失败：{{message}}',
    footnote: '价格快照为编写时官方标价（不含折扣档），估算用途、非账单依据。',
    columns: {
      key: '模型',
      source: '来源',
      input: '输入价',
      output: '输出价',
      cacheRead: '缓存读',
      cacheCreation: '缓存写'
    }
  },
  validation: {
    rate: '汇率必须为 (0, 10000] 内的数字',
    keyRequired: '请填写模型键',
    keyFormat: '键格式：model-id 或 providerId:modelId（按首个冒号分隔，模型名可含冒号）',
    prices: '价格必须是不小于 0 的数字（每 1M tokens）'
  },
  estimateNote: '未计价的请求在界面上显示 —（不会以 0 冒充）；为私有/内部模型添加覆盖即可补全成本。'
}
