/**
 * Senflare Warp - 主后端  v2.0.0
 * WARP MASQUE 账号注册 + 订阅生成 + 管理面板 API
 */

// ==================== 1. 常量 ====================

const adminVersion = 'v2.1.0';

const apiUrl = "https://api.cloudflareclient.com";
const apiVersion = "v0a4471";
const warpRegHeaders = {
  "User-Agent": "WARP for Android",
  "CF-Client-Version": "a-6.35-4471",
  "Content-Type": "application/json; charset=UTF-8",
  "Connection": "Keep-Alive",
};

// ==================== 2. 全局配置 ====================

const NodeDefaults = {

  // —— 后台登录 ——
  USERNAME: 'Senflare',          // 管理员账号
  PASSWORD: 'Senflare',          // 管理员密码

  // —— 访客登录 ——
  GuestEnabled: true,           // 登录页开放「访客登录」入口
  GuestPassword: 'Senflare',       // 访客密码（访客仅可查看 数据看板 / 节点订阅 / 关于我们）

  // ============ 优选端点卡片 ============
  MasqueIPMode: 'ACCOUNT',      // CUSTOM(自定义 MasqueIP) / LOCAL(在线优选 LocalIP) / ACCOUNT(账号端点)
  MasqueIP: '',                 // 自定义端点候选（每行 IP:PORT#备注，或直链 URL）
  LocalIP: '',                  // 在线优选写入的端点候选
  MasqueEndpointMode: 'all',    // 端点模式: all(IPv4+IPv6 全出) / v4(仅 IPv4) / v6(仅 IPv6)
  MasquePortMode: 'fixed',      // 端口模式: fixed(固定 443) / random(随机端口池) / custom(自定义端口)
  MasquePortCustom: '',         // 自定义端口（PortMode=custom 时取用，逗号分隔）

  // ============ MASQUE 配置卡片 ============
  MasqueTransport: 'h2',        // 传输协议: h2(HTTP/2 over TCP，可优选) / h3(HTTP/3 over QUIC，白名单) / both(H2+H3 双形态)
  MasqueCc: 'bbr',              // 加速策略: bbr / cubic / reno
  MasqueUdp: true,              // UDP 转发
  MasqueDns: '1.1.1.1, 8.8.8.8, 2606:4700:4700::1111, 2001:4860:4860::8888',  // DNS 解析列表
  MasqueSni: 'www.apple.com',   // SNI 伪装域名

  // ============ 订阅配置卡片 ============
  SubName: 'Senflare Warp',     // 订阅名称
  SubPath: '/links',            // 订阅路径
  SubKey: 'SenflareWarp',       // 唯一订阅凭证
  SubConfig: 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Online_Mini_NoAuto.ini', // 订阅规则

  // ============ 其他（非卡片配置） ============
  FakePage: false,              // 首页伪装开关
  FakeUrl: 'https://yanhua.w3h5.com/',  // 伪装目标 URL

  Cache: true,                  // 配置缓存总开关
  ConfigTtl: 5 * 60 * 1000,     // 配置缓存时长（5 分钟）

  // —— 主题 / 壁纸 ——
  ThemeColor: '#ff0000',
  BgSource: 'builtin',
  BgCustomUrl: '',
};

const ConfigKeys = [
  'MasqueIPMode', 'MasqueIP', 'LocalIP',
  'MasqueTransport', 'MasqueSni', 'MasqueEndpointMode', 'MasquePortMode', 'MasquePortCustom',
  'MasqueUdp', 'MasqueCc', 'MasqueDns',
  'SubName', 'SubPath', 'SubKey', 'SubConfig',
  'FakePage', 'FakeUrl', 'Cache',
  'GuestEnabled', 'GuestPassword',
  'ThemeColor', 'BgSource', 'BgCustomUrl',
];

/** 配置归一化：白名单字段校验，表外回落默认 */
const normalizeConf = (conf) => {
  const t = String(conf.MasqueTransport ?? '').toLowerCase();
  conf.MasqueTransport = ['h2', 'h3', 'both'].includes(t) ? t : 'h2';
  const m = String(conf.MasqueIPMode ?? '').toUpperCase();
  conf.MasqueIPMode = ['CUSTOM', 'LOCAL', 'ACCOUNT'].includes(m) ? m : 'ACCOUNT';
  const p = String(conf.MasquePortMode ?? '').toLowerCase();
  conf.MasquePortMode = ['fixed', 'random', 'custom'].includes(p) ? p : 'fixed';
  return conf;
};

// ==================== 3. 运行时状态与数据库 ====================

let runtimeEnv = null;
let dbInitPromise = null;

const WarpAccountsCols = ['id', 'name', 'token', 'license', 'endpointPubKey', 'privateKey', 'endpointV4', 'endpointV6', 'endpointPort', 'backupPorts', 'createdAt', 'status'];
const warpAccountsDDL = 'CREATE TABLE warpAccounts (id TEXT PRIMARY KEY, name TEXT, token TEXT, license TEXT, endpointPubKey TEXT, privateKey TEXT, endpointV4 TEXT, endpointV6 TEXT, endpointPort TEXT, backupPorts TEXT, createdAt TEXT, status TEXT)';

/** warpAccounts 旧表迁移：历史版本建的表与当前列集不符时重建
 *  （CREATE TABLE IF NOT EXISTS 不会更新已存在的旧表，旧结构会让注册入库的 INSERT 抛错 → 1101）
 *  有旧数据且含 id 列时按公共列搬迁保号，否则直接重建 */
const migrateWarpAccounts = async (db) => {
  const { results: cols } = await db.prepare("SELECT name FROM pragma_table_info('warpAccounts')").all();
  if (!cols?.length || WarpAccountsCols.every((c) => cols.some((r) => r.name === c))) return;
  const common = WarpAccountsCols.filter((c) => cols.some((r) => r.name === c));
  const steps = common.length > 1 && common.includes('id')
    ? [
        db.prepare('DROP TABLE IF EXISTS warpAccountsLegacy'),
        db.prepare('ALTER TABLE warpAccounts RENAME TO warpAccountsLegacy'),
        db.prepare(warpAccountsDDL),
        db.prepare(`INSERT OR IGNORE INTO warpAccounts (${common.join(',')}) SELECT ${common.join(',')} FROM warpAccountsLegacy`),
        db.prepare('DROP TABLE warpAccountsLegacy'),
      ]
    : [db.prepare('DROP TABLE IF EXISTS warpAccounts'), db.prepare(warpAccountsDDL)];
  await db.batch(steps);
};

/** 建表去重（ 同一实例只执行一次，batch 原子提交；D1 建表用 IF NOT EXISTS 幂等，重复部署安全 ） */
const initDatabase = () => {
  const db = runtimeEnv?.Senflare;
  if (!db || dbInitPromise) return;
  dbInitPromise = db
    .batch([
      // 全局配置：key/value 键值存储，承载 NodeDefaults 全量配置（D1 必选）
      db.prepare('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL)'),
      // 操作日志：登录 / 配置变更 / 订阅下发 / 注册账号 等操作轨迹（面板「系统日志」数据源）
      db.prepare('CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, ip TEXT NOT NULL, cc TEXT, asn TEXT, org TEXT, type TEXT NOT NULL, detail TEXT)'),
      // 日志时间索引：加速按时间倒序分页查询
      db.prepare('CREATE INDEX IF NOT EXISTS idxLogsTime ON logs(time DESC)'),
      // WARP MASQUE 账号池：注册生成的账号（私钥/端点公钥/IPv4/IPv6/常用端口）
      // 订阅生成（effWarpAccounts）以本表为数据源；token 保留（注册凭证，备扩展用）
      db.prepare('CREATE TABLE IF NOT EXISTS warpAccounts (id TEXT PRIMARY KEY, name TEXT, token TEXT, license TEXT, endpointPubKey TEXT, privateKey TEXT, endpointV4 TEXT, endpointV6 TEXT, endpointPort TEXT, backupPorts TEXT, createdAt TEXT, status TEXT)'),
    ])
    // 访客登录字段自动入库：部署后 config 表即出现两行（INSERT OR IGNORE 不覆盖管理员已改的值）
    .then(() => db.batch([
      db.prepare("INSERT OR IGNORE INTO config (key, value, updatedAt) VALUES ('GuestEnabled', ?, ?)").bind(JSON.stringify(NodeDefaults.GuestEnabled !== false), Date.now()),
      db.prepare("INSERT OR IGNORE INTO config (key, value, updatedAt) VALUES ('GuestPassword', ?, ?)").bind(String(NodeDefaults.GuestPassword ?? 'guest'), Date.now()),
    ]))
    .then(() => migrateWarpAccounts(db))
    .catch(() => { dbInitPromise = null; });
};

// ==================== 4. 配置加载 ====================

let nodeConf = null, nodeConfTime = 0, nodeConfInflight = null, nodeConfFailUntil = 0;

const loadNodeConfig = async () => {
  const now = Date.now();
  const cacheOn = (nodeConf?.Cache ?? NodeDefaults.Cache) !== false;
  if (cacheOn && nodeConf && now - nodeConfTime < NodeDefaults.ConfigTtl) return normalizeConf(nodeConf);
  if (cacheOn && now < nodeConfFailUntil) return normalizeConf(nodeConf ?? { ...NodeDefaults });
  if (nodeConfInflight) return nodeConfInflight;
  nodeConfInflight = (async () => {
    const conf = { ...NodeDefaults };
    let loaded = false;
    const db = runtimeEnv?.Senflare;
    if (db) {
      try {
        initDatabase();
        await dbInitPromise;
        const placeholders = ConfigKeys.map(() => '?').join(',');
        const { results } = await db.prepare(`SELECT key, value FROM config WHERE key IN (${placeholders})`).bind(...ConfigKeys).all();
        for (const row of results) {
          try { conf[row.key] = JSON.parse(row.value); } catch { conf[row.key] = row.value; }
        }
        loaded = true;
      } catch { }
    } else {
      loaded = true;
    }
    const normalizedSubPath = String(conf.SubPath ?? '/links').trim().replace(/^\/+|\/+$/g, '');
    conf.SubPath = normalizedSubPath ? `/${normalizedSubPath}` : '/links';
    if (loaded) { nodeConf = conf; nodeConfTime = now; return normalizeConf(conf); }
    nodeConfFailUntil = now + 30 * 1000;
    return normalizeConf(nodeConf ?? conf);
  })();
  try { return await nodeConfInflight; } finally { nodeConfInflight = null; }
};

// 配置保存后清缓存
const invalidateConfigCache = () => {
  nodeConf = null; nodeConfTime = 0; nodeConfFailUntil = 0;
  adminCreds = null; adminCredsTime = 0;
  ipListCache.clear();
  warpAccountsCache = null; warpAccountsTime = 0;
  invalidateSecConf();
};

// ==================== 5. 通用工具 ====================

const parseHostPort = (entry) => {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  const hashIdx = raw.indexOf('#');
  const endpoint = hashIdx === -1 ? raw : raw.slice(0, hashIdx).trim();
  const customName = hashIdx === -1 ? '' : raw.slice(hashIdx + 1).trim();
  let host = endpoint, port = '443', explicit = false;
  if (endpoint.charCodeAt(0) === 91) {
    const idx = endpoint.indexOf(']:');
    if (idx !== -1) { host = endpoint.substring(0, idx + 1); port = endpoint.substring(idx + 2) || '443'; explicit = /^\d+$/.test(endpoint.substring(idx + 2)); }
  } else if (endpoint.includes(',')) {
    const idx = endpoint.indexOf(',');
    host = endpoint.substring(0, idx); port = endpoint.substring(idx + 1) || '443'; explicit = /^\d+$/.test(endpoint.substring(idx + 1));
  } else {
    const idx = endpoint.lastIndexOf(':');
    // 裸 IPv6（host 段仍含冒号）不算带端口，避免把地址尾段误判为端口
    if (idx !== -1) { host = endpoint.substring(0, idx); port = endpoint.substring(idx + 1) || '443'; explicit = host.indexOf(':') === -1 && /^\d+$/.test(endpoint.substring(idx + 1)); }
  }
  port = String(parseInt(port) || 443);
  return host ? { host, port, name: customName || host, explicit } : null;
};

const fetchWithTimeout = async (url, timeout = 8000, init = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
};

const safeEqual = (a, b) => {
  const x = String(a ?? ''), y = String(b ?? '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};

const textEncoder = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64utf8 = (s) => btoa(unescape(encodeURIComponent(s)));
const escYaml = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// ==================== 6. 鉴权与令牌 ====================

const AdminSessionTtl = 7 * 24 * 60 * 60 * 1000;

const hmacSign = async (secret, msg) => {
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, textEncoder.encode(msg)));
};

const adminSecret = async () => {
  const c = await loadAdminCreds();
  return `${c.USERNAME}:${c.PASSWORD}`;
};

/** 令牌携带角色：a=管理员 / g=访客（角色段参与签名，防篡改） */
const createAdminToken = async (role) => {
  const sec = await loadSecurityConfig();
  const hours = Number(sec.sessionTimeout);
  const ttl = hours >= 1 && hours <= 168 ? hours * 3600 * 1000 : AdminSessionTtl;
  const exp = String(Date.now() + ttl);
  const r = role === 'g' ? 'g' : 'a';
  return `${exp}.${r}.${await hmacSign(await adminSecret(), `${exp}.${r}`)}`;
};

/** 校验令牌并返回角色（'a' | 'g'），无效 / 过期返回 null */
const verifyAdminToken = async (token) => {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return null;
  if (parts[1] !== 'a' && parts[1] !== 'g') return null;
  if (Date.now() > Number(parts[0])) return null;
  const sig = await hmacSign(await adminSecret(), `${parts[0]}.${parts[1]}`);
  return safeEqual(sig, parts[2]) ? parts[1] : null;
};

let adminCreds = null, adminCredsTime = 0;

const loadAdminCreds = async () => {
  const now = Date.now();
  if (adminCreds && now - adminCredsTime < NodeDefaults.ConfigTtl) return adminCreds;
  const creds = { USERNAME: NodeDefaults.USERNAME, PASSWORD: NodeDefaults.PASSWORD };
  const db = runtimeEnv?.Senflare;
  let loaded = !db;
  if (db) {
    try {
      const { results } = await db.prepare("SELECT key, value FROM config WHERE key IN ('USERNAME','PASSWORD')").all();
      for (const row of results) {
        if (row.key !== 'USERNAME' && row.key !== 'PASSWORD') continue;
        creds[row.key] = String(row.value);
      }
      loaded = true;
    } catch { }
  }
  if (loaded) { adminCreds = creds; adminCredsTime = now; }
  else { adminCreds = null; adminCredsTime = 0; }
  return creds;
};

// ==================== 7. 响应与日志 ====================

const apiHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const jsonResp = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: apiHeaders });

const MaxLogs = 500;
const logToDb = (ctx, req, type, detail) => {
  const db = runtimeEnv?.Senflare;
  if (!db || !req || !req.headers) return;
  const p = db
    .prepare('INSERT INTO logs (time, ip, cc, asn, org, type, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      Date.now(),
      req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || '-',
      req.cf?.country || '-', req.cf?.asn || '-', req.cf?.asOrganization || '',
      String(type || ''), String(detail == null ? '' : detail)
    )
    .run()
    .then(() => db.prepare('DELETE FROM logs WHERE id <= (SELECT id FROM logs ORDER BY id DESC LIMIT 1 OFFSET ?)').bind(MaxLogs).run())
    .catch(() => { });
  if (ctx?.waitUntil) ctx.waitUntil(p);
};

const SecurityDefaults = { loginLockEnabled: true, sessionTimeout: 24 };
let secConf = null, secConfTime = 0;
const loadSecurityConfig = async () => {
  const now = Date.now();
  if (secConf && now - secConfTime < 60 * 1000) return secConf;
  const conf = { ...SecurityDefaults };
  const db = runtimeEnv?.Senflare;
  if (db) {
    try {
      const keys = Object.keys(SecurityDefaults);
      const placeholders = keys.map(() => '?').join(',');
      const { results } = await db.prepare(`SELECT key, value FROM config WHERE key IN (${placeholders})`).bind(...keys).all();
      for (const row of results) {
        try { conf[row.key] = JSON.parse(row.value); } catch { conf[row.key] = row.value; }
      }
    } catch { }
  }
  secConf = conf; secConfTime = now;
  return conf;
};
const invalidateSecConf = () => { secConf = null; secConfTime = 0; };

// ==================== 8. WARP 账号注册 ====================

const warpApi = async (url, init) => {
  const res = await fetchWithTimeout(url, 12000, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};

// PKCS#8 -> 标准 ECPrivateKey DER（SEC1，Go x509.MarshalECPrivateKey 同款 121 字节）
// WebCrypto 的 pkcs8 内层被截断（缺公钥段），经 JWK（d/x/y）重建完整 SEC1
const warpB64urlToBytes = (s, len) => {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  if (b.length === len) return b;
  const out = new Uint8Array(len); out.set(b, len - b.length); return out;
};
const ecPrivToDerBase64 = async (pkcs8Der) => {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8Der, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  const d = warpB64urlToBytes(jwk.d, 32), x = warpB64urlToBytes(jwk.x, 32), y = warpB64urlToBytes(jwk.y, 32);
  const body = new Uint8Array([
    0x02, 0x01, 0x01,
    0x04, 0x20, ...d,
    0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0xa1, 0x44, 0x03, 0x42, 0x00, 0x04, ...x, ...y,
  ]);
  return btoa(String.fromCharCode(...new Uint8Array([0x30, 0x77, ...body])));
};
const warpToB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const warpRandomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');

const registerWarpAccount = async () => {
  // 1. 伪装 Android 注册
  const regData = await warpApi(`${apiUrl}/${apiVersion}/reg`, {
    method: 'POST',
    headers: warpRegHeaders,
    body: JSON.stringify({
      key: warpToB64(crypto.getRandomValues(new Uint8Array(32))),
      install_id: '', fcm_token: '',
      tos: new Date().toISOString().replace('Z', '+00:00'),
      model: 'PC', serial_number: warpRandomHex(8), os_version: '',
      key_type: 'curve25519', tunnel_type: 'wireguard', locale: 'en_US',
    }),
  });
  const { id, token } = regData;

  // 2. ECDSA P-256 密钥对
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privAsn1 = await ecPrivToDerBase64(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const pubKey = warpToB64(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey)));

  // 3. 绑定 MASQUE
  const patchData = await warpApi(`${apiUrl}/${apiVersion}/reg/${id}`, {
    method: 'PATCH',
    headers: { ...warpRegHeaders, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key: pubKey, key_type: 'secp256r1', tunnel_type: 'masque', name: 'PC' }),
  });

  const peer = patchData.config?.peers?.[0];
  if (!peer || !patchData.config?.interface?.addresses) throw new Error('unexpected enroll response');

  const stripPort = (addr) => (addr || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const ports = [...peer.endpoint.ports].sort((a, b) => a - b);

  return {
    ID: patchData.id,
    Token: token,                        // PATCH/检测凭证（CF 注册返回的 token）
    PrivateKey: privAsn1,
    EndpointV4: stripPort(peer.endpoint.v4),
    EndpointV6: stripPort(peer.endpoint.v6),
    EndpointPort: ports[0],
    BackupPorts: ports.slice(1),
    EndpointPubKey: peer.public_key,
    License: patchData.account.license,
  };
};

// ==================== 9. 账号缓存与端点解析 ====================

let warpAccountsCache = null, warpAccountsTime = 0;
const effWarpAccounts = async () => {
  const now = Date.now();
  const cacheOn = (nodeConf?.Cache ?? NodeDefaults.Cache) !== false;
  if (cacheOn && warpAccountsCache && now - warpAccountsTime < NodeDefaults.ConfigTtl) return warpAccountsCache;
  const db = runtimeEnv?.Senflare;
  if (!db) return [];
  try {
    const rows = (await db.prepare('SELECT * FROM warpAccounts ORDER BY createdAt ASC').all().catch(() => ({ results: [] }))).results || [];
    if (cacheOn && rows.length) { warpAccountsCache = rows; warpAccountsTime = now; }
    return rows;
  } catch { }
  return [];
};

// ==================== 10. IP 列表与订阅生成 ====================

const ListTtl = 5 * 60 * 1000;
const ipListCache = new Map();

// MASQUE 端口池（固定端口之外的备用端口，H3 白名单同池）
const MASQUE_PORTS = ['500', '1701', '4500', '4443', '8443', '8095'];

const resolveIpList = async (source) => {
  const raw = String(source || '').trim();
  if (!raw) return [];
  const now = Date.now();
  const cacheEnabled = ((await loadNodeConfig()).Cache ?? true) !== false;
  const cached = ipListCache.get(raw);
  if (cacheEnabled && cached && now - cached.time < ListTtl) return cached.list;

  let remoteAllOk = true;
  const rawLines = raw.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const segments = [];
  for (const line of rawLines) {
    if (/^https?:\/\//i.test(line)) segments.push(line);
    else segments.push(...line.split(/[,\;，、]+/).map((s) => s.trim()).filter(Boolean));
  }
  const blocks = await Promise.all(
    segments.map(async (seg) => {
      if (/^https?:\/\//i.test(seg)) {
        try {
          const res = await fetchWithTimeout(seg);
          if (!res?.ok) { remoteAllOk = false; return ''; }
          return await res.text();
        } catch { remoteAllOk = false; return ''; }
      }
      return seg;
    }),
  );
  const list = blocks
    .flatMap((block) => block.split(/[\r\n，、]+/))
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
    .map(parseHostPort)
    .filter(Boolean);
  if (cacheEnabled && remoteAllOk && list.length) ipListCache.set(raw, { list, time: now });
  return list;
};

/** 解析备用端口数组（DB 存 JSON 字符串，兼容旧数组/纯数字/逗号文本） */
const backupPortsOf = (a) => {
  const raw = a && a.backupPorts;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw == null || raw === '') return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.map(String) : [String(p)];
  } catch {
    return String(raw).split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  }
};

/** 随机端口池（固定常用端口 443 + 账号备用端口，去重）；无备用端口时回落标准 MASQUE 端口池 */
const randomPortsOf = (a) => {
  const seen = new Set();
  const out = [];
  for (const p of [String(a && a.endpointPort || 443), ...backupPortsOf(a)]) {
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out.length > 1 ? out : ['443', ...MASQUE_PORTS].filter((p) => !seen.has(p) || p === '443');
};

/** 端口池：fixed → 常用端口；random → 常用+备用；custom → 自定义端口列表 */
const portsFor = (a, conf) => {
  const pm = String(conf.MasquePortMode ?? 'fixed').toLowerCase();
  if (pm === 'random') return randomPortsOf(a);
  if (pm === 'custom') {
    const custom = String(conf.MasquePortCustom ?? '').trim();
    return custom ? custom.split(/[,，\s]+/).filter(Boolean) : [String(a && a.endpointPort || 443)];
  }
  return [String(a && a.endpointPort || 443)];
};

/** 端点列表：MasqueIPMode = CUSTOM(MasqueIP) / LOCAL(LocalIP) / ACCOUNT(账号端点)
 *  CUSTOM / LOCAL：轮询 IP 端点列表，一 IP 一端点一只取一个端口
 *    （行内端口优先；无行内端口时 fixed→443，random→随机一个，custom→按序号轮询），
 *    节点数 = IP 数（再 × 传输形态数）；
 *  ACCOUNT：按账号数生成，每账号出 v4/v6 端点 × 端口模式展开，节点数 = 账号数 × 端点 × 端口（再 × 传输形态数）。
 *  端点项 {host, port, name}：name 为用户 # 备注，无备注时生成器回落 host（IP） */
const masqueEndpointHosts = async (accounts, conf) => {
  const mode = String(conf.MasqueIPMode ?? '').toUpperCase();
  const em = String(conf.MasqueEndpointMode ?? 'all').toLowerCase();   // all / v4 / v6
  const pick = (h) => {
    const host = String(h ?? '').trim();
    if (!host) return false;
    const isV6 = host.indexOf(':') !== -1;
    return em === 'v4' ? !isV6 : em === 'v6' ? isV6 : true;
  };
  // 轮询 IP 列表：一行一端点一只取一个端口 —— 行内端口优先，无行内端口时
  // fixed→443，random→端口池随机一个，custom→按序号轮询自定义列表
  const expandList = (list) => {
    const pm = String(conf.MasquePortMode ?? 'fixed').toLowerCase();
    const pool = pm === 'random' ? randomPortsOf(null) : [];
    const customs = pm === 'custom' ? String(conf.MasquePortCustom ?? '').split(/[,，\s]+/).filter(Boolean) : [];
    return list.filter((p) => pick(p.host)).map((p, i) => {
      let port = '443';
      if (p.explicit) port = p.port;
      else if (pm === 'random' && pool.length) port = pool[Math.floor(Math.random() * pool.length)];
      else if (pm === 'custom' && customs.length) port = customs[i % customs.length];
      return { host: p.host, port, name: p.name };
    });
  };
  if (mode === 'CUSTOM' && String(conf.MasqueIP ?? '').trim()) {
    const list = await resolveIpList(conf.MasqueIP);
    if (list.length) return expandList(list);
  }
  if (mode === 'LOCAL' && String(conf.LocalIP ?? '').trim()) {
    const list = await resolveIpList(conf.LocalIP);
    if (list.length) return expandList(list);
  }
  // ACCOUNT / 回落：账号自带端点（按 MasqueEndpointMode 过滤 v4/v6，按端口模式展开端口）
  const hosts = [];
  const seen = new Set();
  for (const a of accounts) {
    for (const h of [a.endpointV4, a.endpointV6]) {
      const host = String(h ?? '').trim();
      if (!host || !pick(host)) continue;
      for (const port of portsFor(a, conf)) {
        const key = host + ':' + port;
        if (!seen.has(key)) { seen.add(key); hosts.push({ host, port, name: '' }); }
      }
    }
  }
  return hosts;
};

const primaryCreds = (accounts) => accounts[0] || {};

/** 端点公钥取单行 base64 主体（剥掉 PEM 头尾与换行；注册 API 存的是完整 PEM，客户端需裸 base64） */
const pubKeyBody = (v) => String(v || '')
  .replace(/-----BEGIN PUBLIC KEY-----/g, '')
  .replace(/-----END PUBLIC KEY-----/g, '')
  .replace(/\s+/g, '');

/** 节点生成统一配置解析 */
const masqueNodeOpts = (conf) => {
  const t = String(conf.MasqueTransport ?? '').toLowerCase();
  // transports：h2 → ['h2']，h3 → ['h3']，both → ['h2','h3']（每端点各出一对）
  const transports = t === 'h3' ? ['h3'] : t === 'both' ? ['h2', 'h3'] : ['h2'];
  const sni = escYaml(conf.MasqueSni);
  const udp = conf.MasqueUdp === false ? 'false' : 'true';
  const cc = conf.MasqueCc;
  const dns = conf.MasqueDns;
  return { transports, sni, udp, cc, dns };
};

/** 节点名：有备注用「备注 + 全局序号」；无备注用「IP | 端口 | 传输形态 + 全局序号」（02 两位补零） */
const nodeName = (endpoint, tr, seq) => {
  const nm = endpoint.name && endpoint.name !== endpoint.host
    ? endpoint.name
    : `${endpoint.host} | ${endpoint.port} | ${tr.toUpperCase()}`;
  return `${nm} | ${String(seq).padStart(2, '0')}`;
};

/** 生成 masque:// 链接（Shadowrocket / b64 订阅） */
const buildMasqueLinks = (accounts, endpoints, conf) => {
  const creds = primaryCreds(accounts);
  const o = masqueNodeOpts(conf);
  const links = [];
  let seq = 1;
  for (const endpoint of endpoints) {
    for (const tr of o.transports) {
      const params = new URLSearchParams({
        publicKey: pubKeyBody(creds.endpointPubKey),
        privateKey: creds.privateKey,
        ip: creds.ipv4 || '172.16.0.2',
      });
      links.push(`masque://${endpoint.host}:${endpoint.port}?${params.toString()}#${encodeURIComponent(nodeName(endpoint, tr, seq++))}`);
    }
  }
  return links;
};

/** 远端 SubConfig 文本缓存（ini 体积小、变更少，缓存 10 分钟，失败不缓存） */
let subCfgCache = { url: '', text: '', time: 0 };
const SubCfgTtl = 10 * 60 * 1000;
const fetchSubConfigCached = async (subConfig) => {
  const now = Date.now();
  if (subCfgCache.url === subConfig && now - subCfgCache.time < SubCfgTtl) return subCfgCache.text;
  const r = await fetchWithTimeout(subConfig, 8000);
  const text = r.ok ? await r.text() : '';
  if (text) subCfgCache = { url: subConfig, text, time: now };
  return text;
};

/**
 * 解析 subconverter 风格 ini（ACL4SSR Online_*.ini）→ Clash YAML 规则块。
 *   custom_proxy_group=分组`类型`选项…   // 选项 `[]DIRECT`/`[]REJECT` 为特殊策略，
 *                                        // `[]分组名` 为分组引用，无 `[]` 前缀按正则匹配我们的节点
 *   ruleset=分组,URL                     // 转 rule-providers + RULE-SET 规则（列表由客户端拉取）
 *   ruleset=分组,[]GEOIP,CN / []FINAL    // 转 GEOIP / MATCH 内联规则
 * 解析出 0 个分组且 0 条规则时返回 ''，由调用方用内置兜底。
 */
const buildClashRuleBlock = (iniText, names) => {
  const groupDefs = [];   // { name, type, opts }
  const rulesets = [];    // { group, payload }
  for (const raw of String(iniText || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === ';' || line[0] === '#') continue;
    if (line[0] === '[') continue;
    if (line.startsWith('custom_proxy_group=')) {
      const parts = line.slice('custom_proxy_group='.length).split('`').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) groupDefs.push({ name: parts[0], type: parts[1].toLowerCase(), opts: parts.slice(2) });
    } else if (line.startsWith('ruleset=')) {
      const rest = line.slice('ruleset='.length);
      const i = rest.indexOf(',');
      if (i > 0) rulesets.push({ group: rest.slice(0, i).trim(), payload: rest.slice(i + 1).trim() });
    }
  }
  if (!groupDefs.length && !rulesets.length) return '';

  const groupNames = new Set(groupDefs.map((g) => g.name));
  const q = (s) => `"${escYaml(s)}"`;
  // 选项 → YAML proxies 条目：特殊策略/分组引用原样保留，正则匹配我们的节点名
  const proxiesFor = (opts) => {
    const out = [];
    for (const o of opts) {
      const ref = o.startsWith('[]') ? o.slice(2) : o;
      const isRef = o.startsWith('[]');
      if (/^(DIRECT|REJECT|REJECT-DROP|PASS)$/i.test(ref)) { out.push(ref.toUpperCase()); continue; }
      if (isRef && groupNames.has(ref)) { out.push(q(ref)); continue; }
      let re = null;
      try { re = new RegExp(ref); } catch { re = null; }
      if (re) for (const n of names) if (re.test(n)) out.push(q(n));
    }
    if (!out.length) out.push('DIRECT');   // 空 proxies 会导致客户端报错，保底 DIRECT
    return [...new Set(out)];
  };

  const groupYaml = groupDefs.map((g) => {
    const head = `  - name: ${q(g.name)}\n    type: ${g.type}\n    proxies:\n${proxiesFor(g.opts).map((p) => `      - ${p}`).join('\n')}`;
    // url-test / fallback / load-balance 需要测速地址与间隔（subconverter 默认值）
    return ['url-test', 'fallback', 'load-balance'].includes(g.type)
      ? `${head}\n    url: http://www.gstatic.com/generate_204\n    interval: 300`
      : head;
  }).join('\n');

  // ruleset → rule-providers（同 URL 去重）+ rules
  const providerByUrl = new Map();
  const providers = [];
  const ruleLines = [];
  for (const r of rulesets) {
    if (!r.group) continue;
    // rules 行是客户端按逗号切分的纯文本（非 YAML 结构），策略名不能加引号，
    // 否则部分客户端会把引号当成名字的一部分 → proxy ["xxx"] not found
    const g = r.group;
    if (/^https?:\/\//i.test(r.payload)) {
      let pname = providerByUrl.get(r.payload);
      if (!pname) {
        pname = `ruleset${providers.length}`;
        providerByUrl.set(r.payload, pname);
        providers.push({ name: pname, url: r.payload });
      }
      ruleLines.push(`  - RULE-SET,${pname},${g}`);
    } else if (r.payload.startsWith('[]')) {
      const body = r.payload.slice(2).trim();
      ruleLines.push(/^FINAL$/i.test(body) ? `  - MATCH,${g}` : `  - ${body},${g}`);
    }
  }

  const providerYaml = providers.map((p) => `  ${p.name}:
    type: http
    behavior: classical
    url: ${p.url}
    path: ./ACL4SSR/${p.name}.list
    interval: 86400`).join('\n');

  let block = '';
  if (groupYaml) block += `proxy-groups:\n${groupYaml}\n`;
  if (providerYaml) block += `\nrule-providers:\n${providerYaml}\n`;
  if (ruleLines.length) block += `\nrules:\n${ruleLines.join('\n')}\n`;
  return block.trim() ? block : '';
};

/** 生成 mihomo YAML（纯 proxies 段，warpscout 同款；基础段由客户端默认/叠加） */
const buildMasqueClash = async (accounts, endpoints, conf) => {
  const creds = primaryCreds(accounts);
  const o = masqueNodeOpts(conf);
  const names = [];
  const line = [];
  let seq = 1;
  for (const endpoint of endpoints) {
    for (const tr of o.transports) {
      const n = nodeName(endpoint, tr, seq++);
      names.push(n);
      line.push(`  - name: "${escYaml(n)}"
    type: masque
    server: ${endpoint.host}
    port: ${endpoint.port}
    network: ${tr}
    sni: ${o.sni}
    private-key: ${creds.privateKey}
    public-key: ${pubKeyBody(creds.endpointPubKey)}
    ip: ${creds.ipv4 || '172.16.0.2'}
    mtu: 1280
    udp: ${o.udp}
    remote-dns-resolve: true
    congestion-controller: ${o.cc}
    dns: [ ${o.dns} ]`);
    }
  }
  // 订阅规则（SubConfig）：远端 ini（ACL4SSR subconverter 风格：custom_proxy_group/ruleset）
  // 或远端 YAML（含 proxy-groups/rules 段）；都解析失败则用内置兜底（WARP 单选 + MATCH）
  const subConfig = String(conf.SubConfig ?? '').trim();
  const clashFallback = `proxy-groups:
  - name: WARP
    type: select
    proxies:
${names.map((n) => `      - "${escYaml(n)}"`).join('\n')}

rules:
  - MATCH,WARP
`;
  let ruleBlock = '';
  if (subConfig && !/^https?:\/\//i.test(subConfig)) {
    ruleBlock = clashFallback;
  } else if (subConfig) {
    try {
      const ini = await fetchSubConfigCached(subConfig);
      if (/^proxy-groups:/m.test(ini)) {
        // 远端 YAML：剥离其 proxies 段后叠加为我们的 rules/proxy-groups
        const groups = (ini.match(/^proxy-groups:[\s\S]*?(?=^rules:|$)/m) || [''])[0].trim();
        const rules = (ini.match(/^rules:[\s\S]*?(?=^[a-z-]+:|$)/m) || [''])[0].trim();
        ruleBlock = groups && rules ? `${groups}\n\n${rules}` : clashFallback;
      } else {
        // 远端 ini：custom_proxy_group/ruleset 转 YAML
        ruleBlock = buildClashRuleBlock(ini, names) || clashFallback;
      }
    } catch {
      ruleBlock = clashFallback;
    }
  }
  // 完整订阅：头（标准 Clash 端口/模式）+ proxies + 规则块（远端 ini 的 proxy-groups/rules 或内置兜底）
  return `# Senflare Warp - MASQUE 订阅
port: 7890
socks-port: 7891
allow-lan: true
mode: rule
log-level: info
ipv6: true
external-controller: 127.0.0.1:9090

dns:
  enable: true
  ipv6: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 114.114.114.114
    - 8.8.8.8
    - tls://dns.google
  fallback:
    - tls://1.1.1.1
    - https://1.1.1.1/dns-query

proxies:
${line.join('\n')}

${ruleBlock}
`;
};

/** 生成 sing-box JSON */
const buildMasqueSingbox = (accounts, endpoints, conf) => {
  const creds = primaryCreds(accounts);
  const o = masqueNodeOpts(conf);
  const outbounds = [];
  let seq = 1;
  for (const endpoint of endpoints) {
    for (const tr of o.transports) {
      outbounds.push({
        type: 'masque',
        tag: nodeName(endpoint, tr, seq++),
        server: endpoint.host,
        server_port: Number(endpoint.port),
        network: tr,
        private_key: creds.privateKey,
        public_key: pubKeyBody(creds.endpointPubKey),
      });
    }
  }
  return JSON.stringify({ outbounds }, null, 2);
};

// ==================== 11. 订阅分发 ====================

const SenflareA = 'c' + 'l' + 'a' + 's' + 'h';
const SenflareB = 's' + 'i' + 'n' + 'g' + 'b' + 'o' + 'x';
const SenflareD = 'm' + 'i' + 'x' + 'e' + 'd';
const SenflareE = 'm' + 'i' + 'h' + 'o' + 'm' + 'o';
const SenflareF = 'm' + 'e' + 't' + 'a';
const SenflareG = 's' + 'i' + 'n' + 'g' + '-' + 'b' + 'o' + 'x';
const SenflareH = 't' + 'a' + 'r' + 'g' + 'e' + 't';
const SubTargets = new Set([SenflareA, SenflareB, SenflareD]);

const detectSubFormat = (ua, url) => {
  const uaLower = ua.toLowerCase();
  const params = url.searchParams;
  if (params.has('b64') || params.has('base64')) return SenflareD;
  if (params.has(SenflareH)) return params.get(SenflareH);
  if (params.has(SenflareA)) return SenflareA;
  if (params.has(SenflareB) || params.has('sb')) return SenflareB;
  if (uaLower.includes(SenflareA) || uaLower.includes(SenflareE) || uaLower.includes(SenflareF)) return SenflareA;
  if (uaLower.includes(SenflareB) || uaLower.includes(SenflareG)) return SenflareB;
  return SenflareD;
};

const handleSubscription = async (request, outerConf, ctx) => {
  const url = new URL(request.url);
  const ua = request.headers.get('User-Agent') || '';
  const q = url.searchParams;
  const conf = outerConf || await loadNodeConfig();
  const subPath = conf.SubPath;

  // 凭证：路径 /{subPath}/<SubKey>，或 ?sub=
  let reqCred = '';
  if (url.pathname.startsWith(subPath + '/')) reqCred = url.pathname.slice(subPath.length + 1).split('/')[0];
  else reqCred = q.get('sub') || '';
  const subKey = String(conf.SubKey ?? '').trim();
  if (!subKey || !reqCred || !safeEqual(reqCred, subKey)) {
    logToDb(ctx, request, '订阅拒绝', reqCred ? `凭证无效: ${reqCred.slice(0, 8)}…` : '凭证缺失');
    return new Response('当前订阅无效，请检查订阅密钥 ！', {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const accounts = await effWarpAccounts();
  if (!accounts.length) {
    logToDb(ctx, request, '订阅拒绝', '无 WARP 账号');
    return new Response('未配置 WARP 账号！请先在面板「账号列表」页注册 WARP MASQUE 账号！', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const subName = String(conf.SubName ?? NodeDefaults.SubName);
  const profileTitle = /^[\x20-\x7e]*$/.test(subName) ? subName : 'base64:' + b64utf8(subName);
  const TiB = 1024 ** 4;
  const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
  const usedTiB = bjNow.getUTCHours() + bjNow.getUTCMinutes() / 60;

  const headers = {
    'Cache-Control': 'no-store',
    'Profile-Title': profileTitle,
    'Subscription-Userinfo': `upload=0; download=${Math.round(usedTiB * TiB)}; total=${24 * TiB}; expire=4102358400`,
  };
  if (!ua.toLowerCase().includes('mozilla')) {
    headers['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(subName)}`;
  }

  const fmt = String(detectSubFormat(ua, url)).toLowerCase();
  const safeFormat = SubTargets.has(fmt) ? fmt : SenflareD;
  const endpoints = await masqueEndpointHosts(accounts, conf);
  // 真实节点数 = 端点数 × 传输形态数（both 每端点各出 H2/H3 两个节点）
  const nodeCount = endpoints.length * masqueNodeOpts(conf).transports.length;

  if (safeFormat === SenflareD) {
    const links = buildMasqueLinks(accounts, endpoints, conf).join('\n');
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    logToDb(ctx, request, '订阅下发', `SubKey b64 ${nodeCount}节点`);
    return new Response(b64utf8(links), { headers });
  }
  if (safeFormat === SenflareA) {
    headers['Content-Type'] = 'application/x-yaml; charset=utf-8';
    logToDb(ctx, request, '订阅下发', `SubKey clash ${nodeCount}节点`);
    return new Response(await buildMasqueClash(accounts, endpoints, conf), { headers });
  }
  headers['Content-Type'] = 'application/json; charset=utf-8';
  logToDb(ctx, request, '订阅下发', `SubKey singbox ${nodeCount}节点`);
  return new Response(buildMasqueSingbox(accounts, endpoints, conf), { headers });
};

// ==================== 12. 首页伪装 ====================

const FakePassHeaders = ['user-agent', 'accept', 'accept-language', 'content-type'];

const handleFakePage = async (request) => {
  const url = new URL(request.url);
  try {
    const fakeURL = new URL((await loadNodeConfig()).FakeUrl || 'https://yanhua.w3h5.com/');
    const headers = new Headers();
    for (const h of FakePassHeaders) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('Host', fakeURL.host);
    headers.set('Referer', fakeURL.origin);
    headers.set('Origin', fakeURL.origin);
    headers.set('Accept-Encoding', 'identity');
    const response = await fetchWithTimeout(
      fakeURL.origin + url.pathname + url.search,
      8000,
      { method: request.method, headers, body: request.body, cf: request.cf },
    );
    const contentType = response.headers.get('content-type') || '';
    if (/text|javascript|json|xml/.test(contentType)) {
      const outHeaders = { ...Object.fromEntries(response.headers), 'Cache-Control': 'no-store' };
      delete outHeaders['content-encoding'];
      delete outHeaders['content-length'];
      const content = (await response.text()).replaceAll(fakeURL.host, url.host);
      return new Response(content, { status: response.status, headers: outHeaders });
    }
    return response;
  } catch {
    return new Response((await loadNodeConfig()).SubName || NodeDefaults.SubName, { status: 200 });
  }
};

// ==================== 13. 管理端 API ====================

const LoginMaxFails = 5;
const LoginFailWindow = 10 * 60 * 1000;
const loginFails = new Map();

const apiLogin = async (request, ctx) => {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const sec = await loadSecurityConfig();
  if (loginFails.size && Math.random() < 0.05) {
    const now2 = Date.now();
    for (const [k, v] of loginFails) if (now2 >= v.until) loginFails.delete(k);
  }
  const rec = loginFails.get(ip);
  const isLocked = () => sec.loginLockEnabled !== false && rec && Date.now() < rec.until && rec.count >= LoginMaxFails;
  const body = await request.json().catch(() => null);

  // 访客登录：独立密码（GuestEnabled / GuestPassword），令牌带 g 角色仅开放只读页面
  if (body?.guest) {
    if (isLocked()) {
      logToDb(ctx, request, '登录锁定', '访客: 触发限制的来源 IP 已拒绝');
      return jsonResp({ error: '失败次数过多，请 10 分钟后再试' }, 429);
    }
    const conf = await loadNodeConfig();
    const gpw = String(conf.GuestPassword ?? NodeDefaults.GuestPassword ?? '');
    if (conf.GuestEnabled === false || !gpw) {
      logToDb(ctx, request, '访客登录失败', '访客入口未开启');
      return jsonResp({ error: '访客登录未开启' }, 403);
    }
    if (!safeEqual(String(body?.password ?? ''), gpw)) {
      logToDb(ctx, request, '访客登录失败', '密码错误');
      if (sec.loginLockEnabled !== false) {
        const count = (rec && Date.now() < rec.until ? rec.count : 0) + 1;
        loginFails.set(ip, { count, until: Date.now() + LoginFailWindow });
      }
      return jsonResp({ error: '访客密码错误' }, 401);
    }
    loginFails.delete(ip);
    logToDb(ctx, request, '访客登录', '');
    return jsonResp({ token: await createAdminToken('g'), username: '访客', role: 'guest' });
  }

  if (isLocked()) {
    logToDb(ctx, request, '登录锁定', `账号: 触发限制的来源 IP 已拒绝`);
    return jsonResp({ error: '失败次数过多，请 10 分钟后再试' }, 429);
  }
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  const creds = await loadAdminCreds();
  if (!username || !safeEqual(username, creds.USERNAME) || !safeEqual(password, creds.PASSWORD)) {
    logToDb(ctx, request, '登录失败', username ? `账号: ${username}` : '账号缺失');
    if (sec.loginLockEnabled !== false) {
      const count = (rec && Date.now() < rec.until ? rec.count : 0) + 1;
      loginFails.set(ip, { count, until: Date.now() + LoginFailWindow });
    }
    return jsonResp({ error: '用户名或密码错误' }, 401);
  }
  loginFails.delete(ip);
  logToDb(ctx, request, '登录后台', `账号: ${username}`);
  return jsonResp({ token: await createAdminToken('a'), username, role: 'admin' });
};

/** 订阅地址片段（面板展示用） */
const buildSubParts = async (request) => {
  const conf = await loadNodeConfig();
  const u = new URL(request.url);
  const subKey = String(conf.SubKey ?? '').trim();
  return {
    subHost: u.host,
    subUrl: subKey ? `${u.protocol}//${u.host}${conf.SubPath || '/links'}/${subKey}` : '',
  };
};

const apiStatus = async (request) => {
  const conf = await loadNodeConfig();
  const parts = await buildSubParts(request);
  return jsonResp({
    version: adminVersion,
    d1Bound: !!runtimeEnv?.Senflare,
    ...parts,
    fakePage: conf.FakePage === true,
  });
};

/** 看板总览（访客可读）：账号总数 + 今日订阅活动聚合（不含 IP / 密钥等敏感字段） */
const apiOverview = async (request) => {
  const parts = await buildSubParts(request);
  const acc = await effWarpAccounts().catch(() => []);
  let subToday = 0, subReject = 0, recent = [];
  const db = runtimeEnv?.Senflare;
  if (db) {
    try {
      const bj = new Date(Date.now() + 8 * 3600 * 1000);   // 北京时区今日零点（对齐面板统计口径）
      bj.setUTCHours(0, 0, 0, 0);
      const todayTs = bj.getTime() - 8 * 3600 * 1000;
      const c1 = await db.prepare(`SELECT COUNT(*) AS n FROM logs WHERE time >= ? AND type = '订阅下发'`).bind(todayTs).first();
      const c2 = await db.prepare(`SELECT COUNT(*) AS n FROM logs WHERE time >= ? AND type = '订阅拒绝'`).bind(todayTs).first();
      subToday = Number(c1?.n || 0);
      subReject = Number(c2?.n || 0);
      const { results } = await db.prepare(`SELECT time, type, detail FROM logs WHERE type IN ('订阅下发','订阅拒绝','订阅转换失败') ORDER BY id DESC LIMIT 8`).all();
      recent = (results || []).map((l) => ({ time: l.time, type: l.type, detail: l.detail }));
    } catch { }
  }
  return jsonResp({
    version: adminVersion,
    d1Bound: !!db,
    ...parts,
    accountsTotal: acc.length,
    subToday, subReject, recent,
  });
};

const apiWarpAccounts = async (request, ctx) => {
  const db = runtimeEnv?.Senflare;
  if (!db) {
    if (request.method === 'POST') return jsonResp({ error: '未绑定 D1，账号数据只读' }, 400);
    return jsonResp({ accounts: [], noD1: true });
  }
  if (request.method === 'POST') {
    const data = await request.json().catch(() => null);
    if (data?.action === 'delete' && data.id) {
      await db.prepare('DELETE FROM warpAccounts WHERE id = ?').bind(String(data.id)).run();
      warpAccountsCache = null; warpAccountsTime = 0;
      logToDb(ctx, request, '删除账号', `id: ${data.id}`);
      return jsonResp({ success: true });
    }
    if (data?.action === 'register') {
      let acc;
      try { acc = await registerWarpAccount(); } catch (e) {
        return jsonResp({ error: `注册失败：${e?.message || e}` }, 502);
      }
      const obj = {
        id: acc.ID || 'warp-' + Date.now(),
        name: 'WARP-MASQUE',
        token: acc.Token || '',
        license: acc.License || '',
        endpointPubKey: acc.EndpointPubKey || '',
        privateKey: acc.PrivateKey || '',
        endpointV4: acc.EndpointV4 || '',
        endpointV6: acc.EndpointV6 || '',
        endpointPort: String(acc.EndpointPort),
        backupPorts: JSON.stringify(acc.BackupPorts || []),
        createdAt: new Date().toISOString().slice(0, 10),
        status: 'normal',
      };
      if (!obj.privateKey || !obj.endpointPubKey || !obj.endpointV4) {
        return jsonResp({ error: '注册返回缺少必要字段（PrivateKey/EndpointPubKey/EndpointV4）' }, 502);
      }
      try {
        await db.prepare('INSERT INTO warpAccounts (id,name,token,license,endpointPubKey,privateKey,endpointV4,endpointV6,endpointPort,backupPorts,createdAt,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(obj.id, obj.name, obj.token, obj.license, obj.endpointPubKey, obj.privateKey, obj.endpointV4, obj.endpointV6, obj.endpointPort, obj.backupPorts, obj.createdAt, obj.status)
          .run();
      } catch (e) {
        // 入库失败时账号已在 CF 侧创建，随响应带回避免丢失
        return jsonResp({ error: `注册成功但入库失败：${e?.message || e}`, account: obj }, 502);
      }
      warpAccountsCache = null; warpAccountsTime = 0;
      logToDb(ctx, request, '注册账号', `id: ${obj.id}`);
      return jsonResp({ success: true, account: obj });
    }
    if (Array.isArray(data?.accounts)) {
      const ins = 'INSERT INTO warpAccounts (id,name,token,license,endpointPubKey,privateKey,endpointV4,endpointV6,endpointPort,backupPorts,createdAt,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)';
      try {
        await db.batch([
          db.prepare('DELETE FROM warpAccounts'),
          ...data.accounts.map((a) =>
            db.prepare(ins).bind(
              String(a.id ?? ''), String(a.name ?? ''), String(a.token ?? ''), String(a.license ?? ''),
              String(a.endpointPubKey ?? ''), String(a.privateKey ?? ''),
              String(a.endpointV4 ?? ''), String(a.endpointV6 ?? ''),
              String(a.endpointPort ?? ''), String(a.backupPorts ?? ''),
              String(a.createdAt ?? ''), String(a.status ?? 'normal')
            )
          ),
        ]);
      } catch (e) {
        return jsonResp({ error: `导入失败：${e?.message || e}` }, 502);
      }
      warpAccountsCache = null; warpAccountsTime = 0;
      logToDb(ctx, request, '批量导入账号', `${data.accounts.length} 个`);
      return jsonResp({ success: true });
    }
    return jsonResp({ error: '参数错误' }, 400);
  }
  const { results } = await db.prepare('SELECT * FROM warpAccounts ORDER BY createdAt ASC').all().catch(() => ({ results: [] }));
  return jsonResp({ accounts: results || [] });
};

const apiConfigGet = async () => {
  const [conf, creds, sec] = await Promise.all([loadNodeConfig(), loadAdminCreds(), loadSecurityConfig()]);
  const { PASSWORD: _pw, ...safeConf } = conf;
  return jsonResp({ ...safeConf, ...sec, USERNAME: creds.USERNAME });
};

const apiThemeGet = async () => {
  const conf = await loadNodeConfig();
  const color = String(conf.ThemeColor || '');
  return jsonResp({
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '',
    bgSource: String(conf.BgSource || 'builtin'),
    bgCustomUrl: String(conf.BgCustomUrl || ''),
    guestEnabled: conf.GuestEnabled !== false,   // 登录页据此显隐「访客登录」入口
  });
};

const apiConfigPost = async (request, ctx) => {
  const db = runtimeEnv?.Senflare;
  if (!db) return jsonResp({ error: '未绑定 D1，配置只读' }, 400);
  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return jsonResp({ error: '参数错误' }, 400);

  if (data.RESET === true) {
    const placeholders = ConfigKeys.map(() => '?').join(',');
    await db.prepare(`DELETE FROM config WHERE key IN (${placeholders})`).bind(...ConfigKeys).run();
    logToDb(ctx, request, '重置配置', '恢复节点/订阅默认配置');
  } else {
    const BG_SOURCES = ['builtin', 'elaina', 'yeqing', 'uapis', 'custom'];
    const entries = Object.entries(data)
      .filter(([k]) => [...ConfigKeys, 'USERNAME', 'PASSWORD', 'loginLockEnabled', 'sessionTimeout'].includes(k))
      .filter(([k, v]) => k !== 'ThemeColor' || (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)))
      .filter(([k, v]) => k !== 'BgSource' || BG_SOURCES.includes(String(v).toLowerCase()));
    if (!entries.length) return jsonResp({ error: '无有效配置项' }, 400);
    const stmt = 'INSERT INTO config (key,value,updatedAt) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt';
    await db.batch(entries.map(([k, v]) =>
      db.prepare(stmt).bind(k, typeof v === 'string' ? v : JSON.stringify(v), Date.now())
    ));
    const isSecurity = entries.some(([k]) => k === 'loginLockEnabled' || k === 'sessionTimeout');
    const isCreds = entries.some(([k]) => k === 'USERNAME' || k === 'PASSWORD');
    const isTheme = entries.length === 1 && entries[0][0] === 'ThemeColor';
    logToDb(ctx, request,
      isTheme ? '更换主题色' : isCreds ? '修改密码' : isSecurity ? '更新安全配置' : '保存配置',
      entries.map(([k]) => k).join(','));
  }
  invalidateConfigCache();
  return jsonResp({ status: 'ok', message: '配置保存成功' });
};

const apiLogsGet = async (request) => {
  const db = runtimeEnv?.Senflare;
  if (!db) return jsonResp([]);
  const q = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Math.min(Math.max(Number.isFinite(q) && q > 0 ? Math.floor(q) : 500, 1), MaxLogs);
  const { results } = await db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').bind(limit).all().catch(() => ({ results: [] }));
  return jsonResp(results || []);
};

const handleApi = async (request, ctx) => {
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/api';
  if (request.method === 'POST' && path === '/api/login') return apiLogin(request, ctx);
  if (request.method === 'GET' && path === '/api/theme') return apiThemeGet();

  const authz = request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  const role = await verifyAdminToken(token);
  if (!role) {
    logToDb(ctx, request, '未授权访问', path);
    return jsonResp({ error: '未授权' }, 401);
  }
  // 访客角色仅开放只读页面数据；配置 / 账号 / 日志含密钥与 IP，不向访客开放
  const adminOnly = new Set([
    'GET /api/config', 'POST /api/config', 'GET /api/logs',
    'GET /api/warpaccounts', 'POST /api/warpaccounts',
  ]);
  if (role !== 'a' && adminOnly.has(`${request.method} ${path}`)) {
    return jsonResp({ error: '访客模式无权访问' }, 403);
  }

  switch (`${request.method} ${path}`) {
    case 'GET /api/session': {
      if (role === 'g') return jsonResp({ ok: true, username: '访客', role: 'guest' });
      const c = await loadAdminCreds();
      return jsonResp({ ok: true, username: c.USERNAME, role: 'admin' });
    }
    case 'POST /api/logout':
      return jsonResp({ ok: true });
    case 'GET /api/config':
      return apiConfigGet();
    case 'POST /api/config':
      return apiConfigPost(request, ctx);
    case 'GET /api/logs':
      return apiLogsGet(request);
    case 'GET /api/status':
      return apiStatus(request);
    case 'GET /api/overview':
      return apiOverview(request);
    case 'GET /api/warpaccounts':
    case 'POST /api/warpaccounts':
      return apiWarpAccounts(request, ctx);
    default:
      return jsonResp({ error: 'Not Found' }, 404);
  }
};

const unknownResp = () => new Response(
  'Senflare Warp\n客官，请走正门哦，不要再试探我啦~\n简睿 TG：https://t.me/Senflare',
  { status: 200, headers: { 'content-type': 'text/plain; charset=UTF-8', 'Access-Control-Allow-Origin': '*' } }
);

// ==================== 14. 主路由 ====================

export default {
  async fetch(request, env, ctx) {
    runtimeEnv = env;
    const url = new URL(request.url);
    const conf = await loadNodeConfig();

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, ctx || null);
    }

    const subPath = conf.SubPath;
    if (url.pathname === subPath || url.pathname.startsWith(subPath + '/')) {
      return await handleSubscription(request, conf, ctx || null);
    }

    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) return assetRes;
    }

    if (conf.FakePage === true) return handleFakePage(request);
    return unknownResp();
  },
};