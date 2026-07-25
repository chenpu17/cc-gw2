export default {
  title: 'Security Events',
  description: 'Review validation defenses and system alerts to spot suspicious traffic.',
  filters: {
    title: 'Filters',
    allLevels: 'All levels',
    allTypes: 'All types',
    typePlaceholder: 'Filter by type (optional)'
  },
  live: 'Live',
  reconnecting: 'Disconnected, reconnecting…',
  failed: 'Connection failed — switch tabs or reload to retry',
  actions: {
    newest: 'Newest',
    older: 'Older'
  },
  levels: {
    info: 'Info',
    warn: 'Warning',
    error: 'Error'
  },
  empty: {
    title: 'No events recorded',
    subtitle: 'No alerts or suspicious events have been recorded yet, which usually means things are healthy.',
    filteredTitle: 'No events match the current filters',
    filteredSubtitle: 'Reset the filters or inspect request logs for a broader view of traffic.',
    actions: {
      logs: 'Open request logs'
    }
  },
  details: 'View details',
  defaultTitle: 'Untitled event',
  defaultMessage: 'No additional description provided.',
  toast: {
    loadFailure: 'Failed to load events: {{message}}'
  }
}
