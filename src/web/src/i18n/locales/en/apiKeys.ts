export default {
  title: 'API Keys Management',
  description: 'Create and manage API keys for gateway access',
  helper: 'Use separate keys for each client, environment, or automation task so you can audit, restrict, and revoke access cleanly.',
  createNew: 'Create New Key',
  createAction: 'Create',
  createDescription: 'Create a new API key for authentication and optionally add a description.',
  descriptionLabel: 'Key description (optional)',
  keyDescriptionPlaceholder: 'e.g. Internal staging access only',
  keyNamePlaceholder: 'Enter key name',
  keyCreated: 'API Key Created',
  saveKeyWarning: 'Keep this key secure. You can also reveal the full key anytime from the key list.',
  wildcard: 'Any Key',
  wildcardHint: 'When enabled, any custom key — including an empty key — is accepted. Disable this key to enforce strict authentication.',
  status: {
    enabled: 'Enabled',
    disabled: 'Disabled'
  },
  actions: {
    enable: 'Enable',
    disable: 'Disable',
    delete: 'Delete',
    reveal: 'Reveal key',
    hide: 'Hide key'
  },
  created: 'Created',
  lastUsed: 'Last Used',
  requestCount: 'Requests',
  totalTokens: 'Total Tokens',
  deleteDialogTitle: 'Delete API key',
  confirmDelete: 'Are you sure you want to delete this API key? This action cannot be undone.',
  errors: {
    nameRequired: 'Key name is required'
  },
  analytics: {
    title: 'Key Usage Analytics',
    description: 'Highlights for the past {{days}} days of API key activity',
    range: {
      today: 'Today',
      week: 'Last 7 days',
      month: 'Last 30 days'
    },
    cards: {
      total: 'Total keys',
      enabled: 'Enabled keys',
      active: 'Active keys ({{days}} days)'
    },
    charts: {
      requests: 'Top 10 keys by request count',
      tokens: 'Top 10 keys by token usage'
    },
    tokens: {
      input: 'Input tokens',
      output: 'Output tokens'
    },
    requestsSeries: 'Requests',
    empty: 'No activity for the selected range.',
    emptyHint: 'Create and use at least one key, then charts will fill in as real traffic arrives.',
    actions: {
      logs: 'Open request logs'
    },
    unknownKey: 'Unknown key'
  },
  quickStart: {
    title: 'Recommended workflow',
    description: 'Start with separate keys per client, then tighten endpoint access as needed.',
    create: {
      title: 'Split keys by client',
      description: 'Create different keys for Claude Code, Codex, CI, or staging so logs stay easy to trace.'
    },
    restrict: {
      title: 'Restrict endpoint access',
      description: 'Limit keys to Anthropic, OpenAI, or custom endpoints when you want tighter isolation.'
    },
    wildcard: {
      title: 'Use wildcard sparingly',
      description: 'Wildcard access is convenient for migration, but named keys are safer for production.'
    }
  },
  list: {
    title: 'Key Inventory',
    emptyTitle: 'Create your first API key',
    empty: 'No API keys found. Use the button above to create one.',
    emptyFilteredTitle: 'No keys match the current filters',
    emptyFiltered: 'No API keys match the current filters.'
  },
  filters: {
    searchPlaceholder: 'Search by name, description, or endpoint',
    all: 'All',
    enabled: 'Enabled',
    disabled: 'Disabled'
  },
  summary: {
    totalCount: '{{count}} keys',
    wildcard: 'Wildcard keys: {{count}}',
    restricted: 'Restricted keys: {{count}}',
    unrestricted: 'Unrestricted keys: {{count}}'
  },
  views: {
    cards: 'Cards',
    compact: 'Compact list'
  },
  tabs: {
    inventory: 'Keys',
    analytics: 'Usage'
  },
  table: {
    name: 'Key',
    access: 'Access',
    actions: 'Actions',
    accessWildcard: 'Wildcard access',
    accessOpen: 'All endpoints'
  },
  toast: {
    keyCreated: 'API key created successfully',
    keyUpdated: 'API key updated successfully',
    keyDeleted: 'API key deleted successfully',
    keyCopied: 'Key copied to clipboard',
    createFailure: 'Failed to create: {{message}}',
    updateFailure: 'Failed to update: {{message}}',
    deleteFailure: 'Failed to delete: {{message}}',
    revealFailure: 'Failed to reveal key',
    copyFailure: 'Failed to copy'
  },
  allowedEndpoints: 'Allowed Endpoints',
  allEndpoints: 'All endpoints (unrestricted)',
  editEndpoints: 'Edit Endpoint Access',
  endpointRestricted: 'Restricted',
  selectEndpoints: 'Select which endpoints this key can access. Leave empty to allow all.',
  maxConcurrency: 'Max Concurrency',
  maxConcurrencyPlaceholder: 'Leave empty for unlimited',
  maxConcurrencyHelper: 'Set the maximum number of simultaneous requests for this key. Leave empty or set to 0 for unlimited.'
}
