export default {
  description: 'Unified-currency billing: model prices, rates and overrides. Costs are query-time estimates — changing prices re-prices history.',
  displayCurrency: 'Display currency',
  displayCurrencyHint: 'All cost fields (dashboard / logs / stats) are converted to this currency for display.',
  rateLabel: '1 USD = ___ CNY',
  rateHint: 'Price entries keep their native currency (USD/CNY) and convert at this rate on display (1 CNY ≈ {{value}} USD).',
  overrides: {
    title: 'Model price overrides',
    description: 'Overrides take precedence over the builtin table. Key is a global model-id, or providerId:modelId to scope to one provider.',
    add: 'Add override',
    remove: 'Remove row',
    key: 'Model key',
    keyHint: 'Exact match only, no fuzzy; e.g. claude-sonnet-4-5 or acme:internal-model',
    currency: 'Currency',
    priceInput: 'Input price',
    priceOutput: 'Output price',
    priceCacheRead: 'Cache-read price',
    priceCacheCreation: 'Cache-write price'
  },
  builtin: {
    title: 'Builtin price table',
    description: 'Builtin snapshot is a fallback reference; entries can be replaced by overrides above. Per 1M tokens, native currency.',
    filterPlaceholder: 'Filter by model name…',
    empty: 'No matching entries.',
    loadError: 'Failed to load prices: {{message}}',
    footnote: 'Snapshot of official list prices at authoring time (discount tiers excluded); estimation only, not for invoicing.',
    columns: {
      key: 'Model',
      source: 'Source',
      input: 'Input',
      output: 'Output',
      cacheRead: 'Cache read',
      cacheCreation: 'Cache write'
    }
  },
  validation: {
    rate: 'Rate must be a number in (0, 10000]',
    keyRequired: 'Model key is required',
    keyFormat: 'Key format: model-id or providerId:modelId (split on the first colon; model ids may contain colons)',
    prices: 'Prices must be numbers ≥ 0 (per 1M tokens)'
  },
  estimateNote: 'Unpriced requests render as — (never as 0); add an override for private/internal models to complete cost coverage.'
}
