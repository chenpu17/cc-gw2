export default {
  title: 'Model Providers',
  description: 'Manage integrated services and default models.',
  emptyState: 'No providers yet. Click "Add provider" to get started.',
  emptyStateSub: 'Click the button above to add your first provider.',
  emptyFiltered: 'No providers match the current filters.',
  count: '{{count}} providers configured',
  groupCount: '{{count}} providers',
  filters: {
    searchPlaceholder: 'Search by name, ID, or Base URL',
    typeAll: 'All types'
  },
  list: {
    sortLabel: 'Sort providers',
    sortUsage: 'By usage',
    sortName: 'By name',
    requests7d: '{{count}} requests in the last 7 days',
    testOk: 'Last connection test succeeded',
    testFailed: 'Last connection test failed',
    untested: 'Not tested yet'
  },
  table: {
    status: 'Status',
    name: 'Name',
    type: 'Type',
    baseUrl: 'Base URL',
    models: 'Models',
    defaultModel: 'Default model',
    requests7d: 'Requests (7d)',
    viewDetail: 'View details'
  },
  status: {
    ready: 'Ready',
    needsDefault: 'Needs default model'
  },
  toast: {
    createSuccess: 'Provider added: {{name}}',
    updateSuccess: 'Provider updated: {{name}}',
    testSuccess: 'Connection test succeeded.',
    testSuccessDesc: 'HTTP {{status}} · {{duration}} elapsed',
    testFailure: 'Connection test failed: {{message}}',
    loadFailure: 'Failed to load config: {{message}}',
    deleteSuccess: 'Provider removed: {{name}}',
    deleteFailure: 'Failed to remove provider: {{message}}'
  },
  actions: {
    add: 'Add provider',
    refresh: 'Refresh',
    refreshing: 'Refreshing...',
    edit: 'Edit',
    delete: 'Delete',
    test: 'Test connection'
  },
  quickAddHuawei: {
    button: 'Quick add Huawei models',
    title: 'Quick add Huawei models',
    description: 'Provide the API key to automatically configure Huawei Cloud DeepSeek V3.1, KIMI-K2, and Qwen3-235B-A22B.',
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'Enter your Huawei Cloud API Key',
    note: 'You can further adjust settings from the provider list after creation.',
    submit: 'Add provider',
    providerLabel: 'Huawei Cloud',
    validation: {
      apiKey: 'API Key is required'
    },
    toast: {
      success: 'Huawei provider added',
      added: '{{name}} added successfully',
      failure: 'Failed to add provider. Please try again later.'
    }
  },
  testDialog: {
    title: 'Connection Test Options',
    subtitle: 'Test request for {{name}}',
    description: 'Some Claude-compatible providers expect additional headers before accepting diagnostic calls. Select the headers to include; leave unchecked to send none.',
    headerValue: 'Header value: {{value}}',
    presetLabel: 'Simulate Claude Code request (recommended)',
    presetDescription: 'Adds the headers Claude CLI normally sends (anthropic-beta, x-app, user-agent, etc.) for maximum compatibility.',
    presetPreviewSummary: 'Show headers that will be attached',
    preservedInfo: 'Headers below are always included from the saved configuration:',
    cancel: 'Cancel',
    primary: 'Run Test',
    options: {
      beta: {
        label: '`anthropic-beta` header',
        description: 'Enables Claude Code experimental capabilities like fine-grained tool streaming. Services such as fox code_cc typically require it.'
      },
      browser: {
        label: '`anthropic-dangerous-direct-browser-access` header',
        description: 'Marks the request as coming from a trusted client. Claude Code includes this header by default.'
      },
      xApp: {
        label: '`x-app` header',
        description: 'Identifies the client as Claude CLI (cli).'
      },
      userAgent: {
        label: '`user-agent` header',
        description: 'Imitates the Claude CLI user agent string.'
      },
      accept: {
        label: '`accept` header',
        description: 'Declares JSON as the expected response format.'
      },
      acceptLanguage: {
        label: '`accept-language` header',
        description: 'Provides language information for providers that require it.'
      },
      secFetchMode: {
        label: '`sec-fetch-mode` header',
        description: 'Matches browser/CLI fetch metadata.'
      },
      acceptEncoding: {
        label: '`accept-encoding` header',
        description: 'Allows gzip/deflate compressed responses.'
      },
      stainlessHelper: {
        label: '`x-stainless-helper-method` header',
        description: 'Indicates the Claude CLI stream helper.'
      },
      stainlessRetry: {
        label: '`x-stainless-retry-count` header',
        description: 'Carries Claude CLI retry metadata.'
      },
      stainlessTimeout: {
        label: '`x-stainless-timeout` header',
        description: 'Specifies the CLI timeout window in seconds.'
      },
      stainlessLang: {
        label: '`x-stainless-lang` header',
        description: 'Reports the implementation language (js).'
      },
      stainlessPackage: {
        label: '`x-stainless-package-version` header',
        description: 'Provides the Claude CLI package version.'
      },
      stainlessOs: {
        label: '`x-stainless-os` header',
        description: 'Reports the operating system of the caller.'
      },
      stainlessArch: {
        label: '`x-stainless-arch` header',
        description: 'Reports the CPU architecture of the caller.'
      },
      stainlessRuntime: {
        label: '`x-stainless-runtime` header',
        description: 'Specifies the runtime environment (e.g. node).'
      },
      stainlessRuntimeVersion: {
        label: '`x-stainless-runtime-version` header',
        description: 'Specifies the runtime version number.'
      }
    }
  },
  noModelDialog: {
    title: 'No Model Configured',
    subtitle: 'Provider “{{name}}” has no model available for testing',
    description: 'The connection test needs a target model before it can call the upstream API. Add at least one model or set a default model first.',
    hint: 'Pass-through mode is still supported for real requests or route mappings, but the diagnostic test cannot guess the upstream model ID.',
    primary: 'Configure models'
  },
  card: {
    baseUrl: 'Base URL',
    defaultModelLabel: 'Default model',
    defaultModel: 'Default model: {{model}}',
    noDefault: 'No default model',
    modelsTitle: 'Supported models',
    noModels: 'No models configured yet.',
    authMode: 'Auth mode',
    providerDefault: 'Provider default',
    modelCount: '{{count}} models',
    passthrough: 'Pass-through',
    statModels: 'Models',
    statRequests24h: '24h requests',
    statAvgLatency: 'Avg latency',
    routeCount_one: 'Referenced by {{count}} route rule',
    routeCount_other: 'Referenced by {{count}} route rules',
    health: { ok: 'Healthy', fail: 'Error', untested: 'Untested' }
  },
  drawer: {
    createTitle: 'Add Provider',
    editTitle: 'Edit Provider',
    quickStart: 'Quick setup',
    description: 'Configure base settings and model list.',
    formSummary: 'Current draft',
    modelsDescription: 'Maintain supported models.',
    defaultHint: 'Current default model: {{model}}',
    summary: {
      type: 'Provider type',
      auth: 'Authentication',
      models: 'Models',
      untitled: 'Untitled provider'
    },
    sections: {
      type: 'Choose provider type',
      basic: 'Basic information',
      auth: 'Authentication',
      checklist: 'Pre-flight checks'
    },
    steps: {
      basics: 'Basics & Auth',
      modelsVerify: 'Models & Verify'
    },
    hints: {
      type: 'Start from a provider template to prefill the recommended Base URL.',
      basic: 'The ID is used by routing rules; the display name is used in the UI.',
      auth: 'Pick the header strategy expected by the upstream API.',
      customProvider: 'Custom compatible service',
      checkUrl: 'Make sure the Base URL points to the upstream API root.',
      checkAuth: 'Make sure the key matches the selected auth header mode.',
      checkModels: 'Add models if you want route suggestions and a default model.',
      advancedTitle: 'About advanced mode',
      advancedBody: 'Advanced mode lets you manage display names and model aliases separately. Keep the default sync if you only need a fast integration.'
    },
    fields: {
      id: 'Provider ID',
      idPlaceholder: 'e.g. openai',
      label: 'Display name',
      labelPlaceholder: 'e.g. OpenAI Official',
      baseUrl: 'Base URL',
      baseUrlPlaceholder: 'https://api.example.com/v1',
      type: 'Provider type',
      apiKey: 'API Key (optional)',
      apiKeyPlaceholder: 'Leave blank to read from environment',
      authMode: 'Authentication mode',
      authModeHint: 'Select the API authentication method and fill in the corresponding key.',
      authModeApiKey: 'X-API-Key',
      authModeProviderDefault: 'Provider default',
      authModeAuthToken: 'Authorization: Bearer',
      authModeXAuthToken: 'X-Auth-Token',
      nonStreamViaStream: 'Send non-stream requests upstream as streams',
      nonStreamViaStreamHint: 'Only applies when the client request is non-streaming. The gateway sends a streaming upstream request, reads the full SSE response, then returns JSON once.',
      useAbsoluteUrl: 'Use absolute URL',
      useAbsoluteUrlHint: 'When on, the Base URL is used verbatim as the upstream URL; the gateway will not append any suffix (e.g. /v1/messages, /v1/chat/completions). Use this for providers that expose a fully-qualified endpoint. The protocol (request body format) is still determined by the provider type and is unaffected.',
      streamUsage: 'Request usage stats on streams (default off)',
      streamUsageHint: '⚠️ Compatibility risk: when on, the gateway sends the stream_options.include_usage parameter upstream. Some OpenAI-compatible model services do not recognize it and may return errors or empty streams. Off by default; if requests start failing after enabling, turn this off. Most upstreams already return usage on their own and do not need this.',
      models: 'Model configuration',
      showAdvanced: 'Show advanced options',
      hideAdvanced: 'Hide advanced options',
      advancedOptions: 'Advanced options',
      addModel: 'Add model',
      modelId: 'Model ID',
      modelIdPlaceholder: 'e.g. claude-sonnet-4-5-20250929',
      modelLabel: 'Display name (optional)',
      modelLabelPlaceholder: 'e.g. GPT-4 Flagship',
      modelNonStreamViaStream: 'Non-stream via stream',
      modelNonStreamViaStreamInherit: 'Use provider default',
      modelNonStreamViaStreamEnabled: 'Enabled',
      modelNonStreamViaStreamDisabled: 'Disabled',
      setDefault: 'Set as default',
      removeModel: 'Remove model',
      rpmLimitSection: 'RPM rate limit (queue & hold)',
      rpmLimitHint: 'Once the per-minute request cap is reached, new requests are held in a gateway queue until a slot frees up, avoiding upstream 429s and client retry storms; requests held past the max wait are rejected with 429 + Retry-After. Leave both empty to disable limiting.',
      rpmLimit: 'Requests per minute (RPM)',
      rpmLimitPlaceholder: 'e.g. 60',
      rpmMaxWaitSeconds: 'Max wait (seconds)',
      rpmMaxWaitPlaceholder: 'Default 30',
      extraHeaders: 'Custom request headers',
      extraHeadersHint: 'Appended to upstream requests for this provider and override any same-named headers sent by the client. Authentication headers (Authorization, x-api-key, etc.) are set by the gateway from the API key and cannot be overridden here.',
      addHeader: 'Add header',
      headerName: 'Name',
      headerValue: 'Value',
      headerNamePlaceholder: 'e.g. X-App-Id',
      headerValuePlaceholder: 'e.g. my-app',
      removeHeader: 'Remove header'
    },
    probe: {
      button: 'Probe models',
      needsBaseUrl: 'Fill in the Base URL first',
      title: 'Probe available models',
      subtitle: 'Fetch the model list from "{{name}}" upstream and import your selection.',
      loading: 'Probing the upstream for models…',
      failedTitle: 'Probe failed',
      failedHint: 'This provider may not expose a model-list endpoint — add models manually instead.',
      failedFallback: 'The upstream did not return a usable model list',
      searchPlaceholder: 'Search model ID or name',
      totalCount_one: '{{count}} model',
      totalCount_other: '{{count}} models',
      selectAll: 'Select all',
      clearSelection: 'Clear',
      selectedCount_one: '{{count}} selected',
      selectedCount_other: '{{count}} selected',
      emptyResult: 'No matching models',
      imported: 'Imported',
      importAction_one: 'Import {{count}} model',
      importAction_other: 'Import {{count}} models',
      importSuccess_one: 'Imported {{count}} model',
      importSuccess_other: 'Imported {{count}} models'
    },
    errors: {
      idRequired: 'Provider ID is required',
      idDuplicate: 'Provider ID already exists',
      baseUrlInvalid: 'Invalid Base URL',
      modelsRequired: 'Configure at least one model',
      modelInvalid: 'Model IDs must be unique and non-empty',
      defaultInvalid: 'Default model must exist in the list',
      headerNameInvalid: 'Header names may only contain letters, digits, and - _ . * + characters (no spaces or colons)',
      headerNameDuplicate: 'Each header name must be unique',
      rpmLimitInvalid: 'RPM limit must be an integer between 1 and 1000000',
      rpmMaxWaitInvalid: 'Max wait must be an integer between 1 and 3600 seconds'
    },
    toast: {
      saveFailure: 'Save failed: {{message}}'
    },
    noModelsTitle: 'Pass-through Mode Enabled',
    noModelsHint: 'No models are defined. This provider will run in pass-through mode—map routes in model routing or specify models directly in requests.',
    routeExample: 'Route Mapping Example:'
  },
  confirm: {
    delete: 'Remove provider “{{name}}”?',
    deleteImpact: 'This will also clean up {{count}} routing rule(s) that reference this provider.'
  }
}
