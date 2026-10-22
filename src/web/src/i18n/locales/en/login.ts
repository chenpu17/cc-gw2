export default {
  title: 'Sign in to cc-gw',
  description: 'Authentication is required before accessing the console.',
  badge: 'Secure Gateway Control',
  sessionProtected: 'Session protected',
  fields: {
    username: 'Username',
    usernamePlaceholder: 'Enter your username',
    password: 'Password',
    passwordPlaceholder: 'Enter your password'
  },
  actions: {
    submit: 'Sign in'
  },
  validation: {
    required: 'Please enter both username and password',
    failed: 'Sign in failed. Check your credentials and try again.'
  },
  hint: 'Forgot your password? Edit ~/.cc-gw/config.json, set webAuth.enabled to false (or remove the field), run cc-gw restart, then set a new password under Settings → Access security.',
  status: 'Signed in as {{username}}'
}
