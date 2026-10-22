export default {
  title: '登录 cc-gw 控制台',
  description: '启用 Web UI 访问控制后，请输入账号与密码继续。',
  badge: '安全网关控制台',
  sessionProtected: '会话已保护',
  fields: {
    username: '用户名',
    usernamePlaceholder: '请输入用户名',
    password: '密码',
    passwordPlaceholder: '请输入密码'
  },
  actions: {
    submit: '登录'
  },
  validation: {
    required: '请填写用户名和密码',
    failed: '登录失败，请检查账号或密码后重试'
  },
  hint: '如果忘记密码：编辑 ~/.cc-gw/config.json，将 webAuth.enabled 改为 false（或删除该字段），执行 cc-gw restart 后即可重新进入控制台并在「设置 → 访问安全」中重设密码。',
  status: '已登录：{{username}}'
}
