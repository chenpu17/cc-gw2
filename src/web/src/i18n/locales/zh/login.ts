export default {
  title: '登录 cc-gw 控制台',
  description: '启用 Web UI 访问控制后，请输入账号与密码继续。',
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
  hint: '如果忘记密码，可在服务器上通过 CLI 或编辑配置重置 Web 登录设置。',
  status: '已登录：{{username}}'
}
