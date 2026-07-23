export default {
  title: 'Sign in to cc-gw',
  description: 'Authentication is required before accessing the console.',
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
  hint: 'Forgot your credentials? You can reset the Web UI login settings from the server CLI or by editing the configuration file.',
  status: 'Signed in as {{username}}'
}
