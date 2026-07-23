export default {
  title: 'Guided setup',
  description: 'Finish cold-start configuration in four steps: connect a provider, configure routing, create an API key, then verify connectivity.',
  steps: {
    provider: {
      navLabel: 'Add provider',
      title: 'Add a model provider',
      description: 'Connect an upstream model service. Routing and client requests will point to it.',
      existingTitle: '{{count}} provider(s) already configured',
      existingHint: 'Pick an existing provider and continue, or add another one.',
      chooseLabel: 'Provider used by this wizard',
      addAnother: 'Add another provider',
      backToList: 'Back to existing providers',
      saveAndContinue: 'Save and continue'
    },
    routing: {
      navLabel: 'Configure routing',
      title: 'Configure a default route',
      description: 'Add a route on the Anthropic endpoint that maps a common client model name to the new provider model.',
      existingTitle: 'Current Anthropic endpoint routes',
      existingHint: 'Routes already exist — review them and continue to the next step.',
      emptyHint: 'No routes yet. Save the default route below to continue.',
      sourceLabel: 'Source model (client request name)',
      sourceHint: 'When a client switches to a new model name later, add a matching rule under Providers & Routing → Routing.',
      targetLabel: 'Target (provider:model)',
      save: 'Save route',
      saving: 'Saving...'
    },
    apiKey: {
      navLabel: 'Create API key',
      title: 'Create an API key',
      description: 'Clients use this key to access the gateway. Scoped to the Anthropic endpoint by default.',
      create: 'Create key',
      creating: 'Creating...',
      createFailed: 'Failed to create API key: {{message}}'
    },
    verify: {
      navLabel: 'Verify & finish',
      title: 'Verify and finish',
      description: 'Test provider connectivity, then send your first request from a client with the baseUrl and key.',
      noProvider: 'No provider available — go back to step 1.',
      testingProvider: 'Testing provider "{{name}}"',
      envTitle: 'Send your first request from a client',
      envHint: 'Set the following variables in your client environment (Claude Code example), then send a request:'
    }
  },
  actions: {
    finish: 'Finish'
  }
}
