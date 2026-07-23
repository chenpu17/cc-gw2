export default {
  title: 'Custom Endpoints',
  description: 'Manage custom API endpoints with multiple protocol support.',
  createButton: 'Add Endpoint',
  createTitle: 'Create Endpoint',
  editTitle: 'Edit Endpoint',
  emptyTitle: 'No custom endpoints',
  emptyDescription: 'Click "Add Endpoint" to create your first custom endpoint.',
  loadError: 'Failed to load endpoints',
  id: 'ID',
  path: 'Path',
  disabled: 'Disabled',
  hasRouting: 'Routing configured',
  protocols: {
    anthropic: 'Anthropic Protocol',
    'openai-chat': 'OpenAI Chat',
    'openai-responses': 'OpenAI Responses'
  },
  protocolHints: {
    anthropic: 'Anthropic Messages API protocol (/v1/messages)',
    'openai-chat': 'OpenAI Chat Completions API protocol (/v1/chat/completions)',
    'openai-responses': 'OpenAI Responses API protocol (/v1/responses)'
  },
  form: {
    id: 'Endpoint ID',
    idPlaceholder: 'e.g. custom-api',
    idHint: 'ID cannot be changed after creation, used for internal identification.',
    label: 'Display Name',
    labelPlaceholder: 'e.g. My Custom API',
    path: 'Access Path',
    pathPlaceholder: 'e.g. /custom/api',
    pathHint: 'Path must start with /. Changes take effect immediately.',
    protocol: 'Protocol Type',
    enabled: 'Enable this endpoint'
  },
  routing: {
    title: 'Routing Configuration (Optional)',
    modelRoutes: 'Model Routing Rules',
    addRoute: 'Add Rule',
    noRoutes: 'No routing rules',
    sourceModelPlaceholder: 'Source model (e.g. claude-3-5-sonnet-20241022)',
    targetPlaceholder: 'Target (e.g. anthropic:claude-3-5-sonnet-20241022)',
    modelRoutesHint: 'Format: source model → provider:model, wildcards supported (e.g. gpt-* → openai:*)',
    defaults: 'Default Model Configuration',
    defaultCompletion: 'Default for completion tasks',
    defaultReasoning: 'Default for reasoning tasks',
    defaultBackground: 'Default for background tasks',
    longContextThreshold: 'Long context threshold (tokens)',
    defaultPlaceholder: 'e.g. anthropic:claude-3-5-sonnet-20241022'
  },
  createSuccess: 'Endpoint created successfully',
  createError: 'Failed to create: {{error}}',
  updateSuccess: 'Endpoint updated successfully',
  updateError: 'Failed to update: {{error}}',
  deleteSuccess: 'Endpoint deleted successfully',
  deleteError: 'Failed to delete: {{error}}',
  deleteConfirm: 'Are you sure you want to delete endpoint "{{label}}"? This action cannot be undone.',
  validationError: 'Please fill in all required fields'
}
