export default {
  routingTitle: 'Routing',
  routingDescription: 'Configure per-endpoint route rules, default forwarding and the hit simulator.',
  templates: 'Templates',
  endpointSwitcher: {
    label: 'Endpoint',
    ruleCount: '{{count}}'
  },
  endpointRail: {
    title: 'Endpoints',
    subtitle: 'Each endpoint has its own rule set',
    ruleCount: '{{count}}'
  },
  flow: {
    title: 'Request flow',
    clientStep: 'Client model',
    endpointStep: 'Endpoint',
    matchStep: 'Route rule match',
    targetStep: 'Forward target',
    fallbackNote: 'Unmatched requests use the default'
  },
  endpointConfig: {
    title: 'Endpoint config'
  },
  hitSim: {
    title: 'Routing Hit Simulator',
    subtitle: 'Enter a client model name to preview which rule it hits, in real time',
    endpointLabel: 'Endpoint',
    protocolLabel: 'Protocol',
    modelPlaceholder: 'e.g. claude-sonnet-4-5-20250929',
    thinking: 'Thinking',
    anyModel: '(any model)',
    empty: 'Enter a model name to see which route it hits',
    errorPrefix: 'Could not resolve route',
    reasonModelRoute: 'Hit a model route rule',
    reasonModelRouteAlias: 'Hit a model route rule (via alias)',
    reasonDirectMatch: 'Direct provider match',
    reasonThinkingDefault: 'Hit thinking default',
    reasonCompletionDefault: 'Hit completion default',
    reasonLongContext: 'Hit long-context default',
    longContextDetail: 'Estimated ~{{estimate}} tokens, over threshold {{threshold}}',
    reasonFallback: 'No rule matched · global fallback',
    fallbackHint: 'No rule matched this model; it will use the global fallback.',
    unsavedNotice: 'Results use the saved config; your unsaved route edits are not simulated yet.'
  },
  defaults: {
    title: 'Default forwarding',
    cardSubtitle: 'Requests that match no rule go here',
    completionLabel: 'Forward to (provider:model)',
    moreLabel: 'More default settings',
    reasoningLabel: 'Reasoning model',
    backgroundLabel: 'Long-context model',
    thresholdLabel: 'Long-context threshold (tokens)',
    targetPlaceholder: 'e.g. openai:gpt-4o',
    save: 'Save defaults',
    saveSuccess: 'Default forwarding saved.',
    saveFailure: 'Failed to save default forwarding: {{message}}'
  },
  routing: {
    rulesTitle: 'Route rules',
    rulesSubtitle: 'Matched top-to-bottom, * wildcards supported; drag the left handle to set priority',
    rulesSubtitleUnified: 'Unified endpoints can branch by protocol: the same model ID may target different Anthropic and OpenAI destinations. Protocol rules win; "All protocols" is the fallback',
    scopeLabel: 'Protocol',
    scopeAll: 'All protocols',
    scopeAnthropic: 'Anthropic',
    scopeOpenai: 'OpenAI',
    dragHandle: 'Drag to reorder',
    sourceLabel: 'Client-requested model',
    targetLabel: 'Forward to (provider:model)',
    emptyTitle: 'No route rules yet',
    emptyDescription: 'Clients send requests by model name — configure here which provider\'s model each should be forwarded to. For example, map claude-sonnet-4 to the provider you just added; model names not listed here use "Default forwarding" above.',
    addFirst: 'Add your first rule'
  },
  list: {
    emptyHint: 'Add an upstream model service first (Anthropic, OpenAI, or a compatible endpoint), then map client models to it on the Routing page.'
  },
  endpoints: {
    create: 'New endpoint'
  },
  testResult: {
    title: 'Latest test',
    success: 'Connected',
    failure: 'Test failed',
    status: 'Status {{status}}',
    duration: '{{duration}}',
    never: 'Not tested yet'
  },
  drawer: {
    verifyTitle: 'Connection check',
    verifyHint: 'Runs a real request against the current config — including unsaved drafts — to confirm auth and connectivity.',
    verifySaveFirst: 'Save the provider before running a connection test.',
    verifyRun: 'Test connection'
  }
}
