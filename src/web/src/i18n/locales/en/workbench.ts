export default {
  title: 'Providers & Routing Workbench',
  description: 'Manage model providers, endpoint routing rules and custom endpoints in one place.',
  viewSwitch: {
    label: 'Workbench view',
    providers: 'Providers',
    providersDesc: 'Manage upstream model services',
    routing: 'Routing',
    routingDesc: 'Decide where requests are forwarded'
  },
  routingGuide: {
    flow: "Client-requested model (e.g. claude-sonnet-4) → matched route rule → forwarded to a provider's model",
    hint: 'Clients request by model name: rules below are matched first, and anything unmatched falls through to the default.'
  },
  flow: {
    title: 'Request flow',
    clientStep: 'Client model',
    endpointStep: 'Endpoint',
    matchStep: 'Route rule match',
    targetStep: 'Forward target',
    fallbackNote: 'Unmatched requests use the default'
  },
  endpointRail: {
    title: 'Endpoints',
    subtitle: 'Each endpoint has its own rule set',
    add: 'New endpoint',
    ruleCount: '{{count}}'
  },
  endpointConfig: {
    title: 'Endpoint config'
  },
  hitSim: {
    title: 'Routing Hit Simulator',
    subtitle: 'Enter a client model name to preview which rule it hits, in real time',
    endpointLabel: 'Endpoint',
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
    fallbackHint: 'No rule matched this model; it will use the global fallback.'
  },
  defaults: {
    title: 'Default forwarding',
    description: 'Requests that match no rule below are forwarded here. With a single provider, setting this alone is usually all you need.',
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
  specific: {
    title: 'Route specific models (optional)',
    description: 'Only requests for these model names hit the rules below — they take priority over default forwarding.'
  },
  advanced: {
    title: 'Advanced',
    wildcardHint: 'Rules support * wildcards; the most specific match wins.'
  },
  routing: {
    rulesTitle: 'Route rules',
    rulesSubtitle: 'Matched top-to-bottom, * wildcards supported; drag the left handle to set priority',
    dragHandle: 'Drag to reorder',
    sourceLabel: 'Client-requested model',
    targetLabel: 'Forward to (provider:model)',
    emptyTitle: 'No route rules yet',
    emptyDescription: 'Clients send requests by model name — configure here which provider\'s model each should be forwarded to. For example, map claude-sonnet-4 to the provider you just added; model names not listed here use "Default forwarding" above.',
    addFirst: 'Add your first rule'
  },
  detail: {
    routesTitle: 'Routing rules using this provider',
    routesEmptyHint: "No route rules reference it yet — client requests can't reach this provider.",
    addRuleCta: 'Add a rule in Routing view',
    viewRoute: 'Open this rule in the routing view'
  },
  list: {
    emptyHint: 'Add an upstream model service first (Anthropic, OpenAI, or a compatible endpoint), then map client models to it in the Routing view.'
  },
  endpoints: {
    create: 'New endpoint',
    editRoute: 'Routes',
    defaultUnset: 'Not set',
    table: {
      name: 'Name',
      protocol: 'Protocol',
      paths: 'Paths',
      rules: 'Rules',
      defaultTarget: 'Default',
      status: 'Status',
      actions: 'Actions'
    }
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
