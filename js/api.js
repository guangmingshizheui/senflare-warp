// 控制台品牌信息
console.log("%c Senflare Warp", "color:#fff;font-weight:700;background:linear-gradient(270deg,#986fee,#8695e6,#68b7dd,#18d7d3);padding:8px 15px;border-radius:15px");
console.log("%c Powered by 简睿 | TG @Senflare", "color:#FFD700;background:linear-gradient(135deg,#0a0a0a,#1a1a1a,#0a0a0a);padding:8px 15px;font-weight:700;border-radius:15px;text-shadow:0 0 10px rgba(255, 215, 0)");

/**
 * Senflare Warp — Admin API 层
 * 统一 fetch 封装：Bearer 令牌 / 401 自动跳登录 / 业务错误 Toast / HTML 转义
 * 默认同源调用（Worker 静态资源同域部署）；面板单独托管时在 localStorage
 * 写入 sf_warp_api_base 指向 Worker 域名即可跨域（后端已开 CORS）
 */
(function () {
  var TOKEN_KEY = 'sf_warp_token';
  var LOGIN_TIME_KEY = 'sf_warp_login_time';
  var SESSION_MS = 7 * 24 * 60 * 60 * 1000;   // 前端宽松上限（服务端默认 24h、安全设置可配 1-168h），过期判定以服务端 401 为准

  var API_BASE = '';
  try { API_BASE = (localStorage.getItem('sf_warp_api_base') || '').replace(/\/+$/, ''); } catch (e) {}

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) {
        localStorage.setItem(TOKEN_KEY, t);
        localStorage.setItem(LOGIN_TIME_KEY, String(Date.now()));
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(LOGIN_TIME_KEY);
      }
    } catch (e) {}
  }
  /** 登录态是否已过期（无令牌 / 超过 7 天） */
  function loginExpired() {
    var t = 0;
    try { t = parseInt(localStorage.getItem(LOGIN_TIME_KEY) || '0', 10); } catch (e) {}
    return !getToken() || !t || Date.now() - t > SESSION_MS;
  }

  function toast(msg, isError) {
    if (typeof window.showToast === 'function') window.showToast(msg, isError);
    else console.log('[LiteAPI]', msg);
  }

  /**
   * 基础调用：返回解析后的 JSON；401 清令牌跳登录页并返回 null；
   * 网络异常 Toast 并返回 null
   */
  async function apiCall(path, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + getToken() });
    if (options.body && !options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(API_BASE + path, options);
    } catch (e) {
      toast('网络请求失败：' + e.message, true);
      return null;
    }
    if (res.status === 401) {
      setToken('');
      // 登录接口的 401 = 账号或密码错误：读出错误体提示用户，而不是当作会话过期静默处理
      var body = null;
      try { body = await res.json(); } catch (e) {}
      if (path === '/api/login') {
        toast((body && body.error) || '登录失败', true);
        return null;
      }
      if (!/login\.html$/.test(location.pathname)) {
        location.replace('login.html');
      }
      return null;
    }
    if (!res.ok) {
      // 非 401 的失败（405/502/网关错误等，响应体可能不是 JSON）：统一提示，避免静默失败无任何反馈
      var errBody = null;
      try { errBody = await res.json(); } catch (e) {}
      toast((errBody && errBody.error) || ('请求失败（HTTP ' + res.status + '）'), true);
      return null;
    }
    try { return await res.json(); } catch (e) { return null; }
  }

  /** 业务封装：后端 {error} 统一弹 Toast 后返回 null，调用方判空兜底 */
  async function call(path, options) {
    var data = await apiCall(path, options);
    if (data && data.error) {
      toast(data.error, true);
      return null;
    }
    // 显式 status 非 ok（如 {status:'error'}）视为失败；无 status 字段的响应（登录 {token}、用量 {success}、状态对象）一律放行
    if (data && typeof data === 'object' && data.status != null && data.status !== 'ok') {
      toast((data.message || '数据拉取失败'), true);
      return null;
    }
    return data;
  }

  // ---------- 业务端点 ----------

  async function login(username, password) {
    return call('/api/login', { method: 'POST', body: JSON.stringify({ username: username, password: password }) });
  }

  // 访客登录：独立密码，令牌带 g 角色（面板仅开放 数据看板 / 节点订阅 / 关于我们）
  async function guestLogin(password) {
    return call('/api/login', { method: 'POST', body: JSON.stringify({ guest: true, password: password }) });
  }

  // 当前令牌是否访客角色（角色编码在令牌第 2 段：a=管理员 / g=访客，签名防篡改）
  function isGuest() {
    try { return (getToken() || '').split('.')[1] === 'g'; } catch (e) { return false; }
  }

  var getConfig = function () { return call('/api/config'); };
  var saveConfig = function (payload) {
    return call('/api/config', { method: 'POST', body: JSON.stringify(payload || {}) });
  };
  var getStatus = function () { return call('/api/status'); };

  // WARP 账号列表读写（账号列表页数据源；凭据类字段走 POST body 避免落 URL）
  var warpGet = function () { return call('/api/warpaccounts'); };
  var warpPost = function (payload) {
    return call('/api/warpaccounts', { method: 'POST', body: JSON.stringify(payload || {}) });
  };

  window.LiteAPI = {
    API_BASE: API_BASE,
    getToken: getToken,
    setToken: setToken,
    loginExpired: loginExpired,
    isGuest: isGuest,
    call: call,
    login: login,
    guestLogin: guestLogin,
    getConfig: getConfig,
    saveConfig: saveConfig,
    getStatus: getStatus,
    warpGet: warpGet,
    warpPost: warpPost
  };
})();
