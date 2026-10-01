(function () {

  // ============================================================
  // 业务逻辑层（LiteCore）：地址解析 / 测速探测 / 本地状态 / 文案映射
  // 与 js/admin-ui.js 的分工：本层只「算与取」，DOM 渲染与事件交互全在 admin-ui.js。
  // 约束：无顶层副作用（本文件同时被 login.html 引用，加载即执行的逻辑不放这里）。
  // ============================================================

  // ---------- 通用工具 ----------
  // 地址、备注可能来自用户输入或远端直链内容，入 HTML 前必须转义
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNum(n) {
    n = Number(n);
    if (Number.isNaN(n)) return '0';
    return n.toLocaleString();
  }
  // 分页页码窗口：视口自适应（≤768px 收窄到 3，≤1024px 收窄到 5，宽屏 7），两端补首尾页与省略号
  function pagerPages(p, total, max) {
    var m = Math.max(3, max || (window.innerWidth <= 768 ? 3 : window.innerWidth <= 1024 ? 5 : 7));
    var half = Math.floor(m / 2);
    var start = Math.max(1, Math.min(p - half, total - m + 1));
    var end = Math.min(total, start + m - 1);
    var win = [];
    for (var i = start; i <= end; i++) win.push(i);
    var out = [];
    if (win[0] > 1) out.push(1);
    if (win[0] > 2) out.push('...');
    for (var j = 0; j < win.length; j++) out.push(win[j]);
    if (win[win.length - 1] < total - 1) out.push('...');
    if (win[win.length - 1] < total) out.push(total);
    return out;
  }
  // 复制到剪贴板：无 clipboard API / 权限拒绝时走 execCommand 兜底，全部复制入口共用
  function copyText(text, okMsg) {
    var ok = function () { toast(okMsg || '已复制到剪贴板'); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = String(text == null ? '' : text);
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? ok() : toast('复制失败', true); }
      catch (e) { toast('复制失败', true); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }
  // 下载文本文件（Blob → a.click → revoke），全部下载入口共用
  function downloadText(filename, text, okMsg, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    if (okMsg) toast(okMsg);
  }

  // ---------- 浏览器本地状态（测速结果 / 测速设置 / 配置草稿） ----------
  // 测速结果持久化：刷新不丢（损坏/缺失回落空表，可随时重测再生）
  var ST_STORE_KEY = 'sf_warp_stdata_v1';
  function stStoreRead() {
    try {
      var d = JSON.parse(localStorage.getItem(ST_STORE_KEY));
      if (d && Array.isArray(d.speed) && Array.isArray(d.proxy)) return d;
    } catch (e) {}
    return { speed: [], proxy: [] };
  }
  function stStoreWrite(data) {
    try { localStorage.setItem(ST_STORE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  var ST_CFG_KEY = 'sf_warp_stcfg';
  var ST_CFG_DEFAULT = { port: '443', threads: 5, random: 3, max: 20, save: 10 };
  function stCfgRead() {
    try {
      var saved = JSON.parse(localStorage.getItem(ST_CFG_KEY) || '{}');
      return Object.assign({}, ST_CFG_DEFAULT, saved);
    } catch (e) { return Object.assign({}, ST_CFG_DEFAULT); }
  }
  function stCfgWrite(cfg) {
    try { localStorage.setItem(ST_CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  // 机房地区缓存（优选/节点列表共用）：host → {region, colo, ts}，TTL 24h
  var ST_REGION_KEY = 'sf_warp_region_cache_v1';
  var ST_REGION_TTL = 24 * 60 * 60 * 1000;
  function regionCacheRead() {
    try {
      var d = JSON.parse(localStorage.getItem(ST_REGION_KEY));
      return d && typeof d === 'object' ? d : {};
    } catch (e) { return {}; }
  }
  function regionCacheClear() {
    try { localStorage.removeItem(ST_REGION_KEY); } catch (e) {}
  }
  function regionCacheWrite(cache) {
    try { localStorage.setItem(ST_REGION_KEY, JSON.stringify(cache)); } catch (e) {}
  }
  // 查 host 机房/注册地：缓存命中直接返回，否则并发查 trace 与 ipinfo
  function stLookupRegion(host, port) {
    var h = String(host || '').replace(/^\[|\]$/g, '');
    if (!h) return Promise.resolve({});
    var cache = regionCacheRead();
    var hit = cache[h];
    if (hit && Date.now() - hit.ts < ST_REGION_TTL) return Promise.resolve(hit);
    var traceUrl = 'https://' + (h.indexOf(':') !== -1 ? '[' + h + ']' : h) + ':' + (port || 443) + '/cdn-cgi/trace';
    var ipUrl = 'https://api.ipinfo.io/lite/' + encodeURIComponent(h) + '?token=2cb674df499388';
    // 并发：trace 取机房，ipinfo 取注册地
    return Promise.all([
      fetch(traceUrl, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
        .then(function (res) {
          if (!res.ok) return {};
          return res.text().then(function (text) {
            var d = {};
            text.trim().split('\n').forEach(function (ln) {
              var kv = ln.split('=');
              if (kv[0] && kv[1]) d[kv[0].trim()] = kv[1].trim();
            });
            return { region: d.loc || '', colo: d.colo || '' };
          });
        })
        .catch(function () { return {}; }),
      fetch(ipUrl, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) return {};
          return r.json().then(function (d) {
            if (!d || !d.country_code) return {};
            return { region: d.country_code, colo: '' };
          });
        })
        .catch(function () { return {}; }),
    ]).then(function (parts) {
      var out = { region: parts[0].region || parts[1].region || '', colo: parts[0].colo || '', ts: Date.now() };
      if (out.region || out.colo) { cache[h] = out; regionCacheWrite(cache); }
      return out;
    });
  }
  // 节点配置草稿：未保存的修改（优先级高于服务端值），保存成功后清除；
  // 键带版本号隔离旧格式数据
  var CFG_DRAFT_KEY = 'sf_warp_cfg_draft_v2';
  function cfgDraftRead() {
    try { return JSON.parse(localStorage.getItem(CFG_DRAFT_KEY) || '{}'); } catch (e) { return {}; }
  }
  function cfgDraftWrite(obj) {
    try { localStorage.setItem(CFG_DRAFT_KEY, JSON.stringify(obj || {})); } catch (e) {}
  }
  function cfgDraftClear() {
    try { localStorage.removeItem(CFG_DRAFT_KEY); } catch (e) {}
  }

  // ---------- 地址解析（对齐主后端 parseNodeAddress / ipToHex） ----------
  function stParseAddr(raw) {
    var addr = String(raw == null ? '' : raw).trim();
    if (!addr || /^https?:\/\//i.test(addr)) return null;
    var m6 = addr.match(/^\[([0-9a-fA-F:]+)\](?::(\d+))?$/);
    if (m6) return { host: m6[1], port: m6[2] || '443', type: 'ipv6' };
    if ((addr.match(/:/g) || []).length > 1 && addr.indexOf('.') === -1) {
      return { host: addr, port: '443', type: 'ipv6' };
    }
    var lc = addr.lastIndexOf(':');
    if (lc > 0 && /^\d+$/.test(addr.slice(lc + 1))) {
      var h = addr.slice(0, lc);
      return { host: h, port: addr.slice(lc + 1), type: /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ? 'ipv4' : 'domain' };
    }
    return { host: addr, port: '443', type: /^\d{1,3}(\.\d{1,3}){3}$/.test(addr) ? 'ipv4' : 'domain' };
  }
  // 拆 IP:端口（详情弹窗专用）：[IPv6]:端口 优先按括号解析；裸 IPv6 含多个冒号，
  // 不能按「最后一个冒号」切（否则 2606:4700::1 会被切成 host=2606:4700:/port=1）
  function stSplitAddr(addr) {
    var s = String(addr || '').trim();
    var m6 = s.match(/^\[([0-9a-fA-F:]+)\](?::(\d+))?$/);
    if (m6) return { ip: m6[1], port: m6[2] || '—' };
    var sep = s.lastIndexOf(':');
    if (sep > 0 && s.indexOf(':') === sep && /^\d+$/.test(s.slice(sep + 1))) {
      return { ip: s.slice(0, sep), port: s.slice(sep + 1) };
    }
    return { ip: s.replace(/^\[|\]$/g, ''), port: '—' };
  }

  // ---------- Cloudflare 网段判定（官方列表无 CORS 头，只能本地内置比对） ----------
  var CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '1.1.1.0/24', '1.0.0.0/24'];
  var CF_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
    '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
  // 全程乘除不用位移：n << 24 在 >=128.0.0.0 处会翻成负数
  function ip4ToInt(s) {
    var p = String(s).split('.');
    if (p.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(p[i]) || Number(p[i]) > 255) return null;
      n = n * 256 + Number(p[i]);
    }
    return n;
  }
  function ip6ToGroups(s) {
    var str = String(s).trim().toLowerCase();
    var tail = str.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);   // ::ffff:1.2.3.4 的 v4 尾巴先折成两组
    if (tail) {
      var v4 = ip4ToInt(tail[1]);
      if (v4 === null) return null;
      str = str.slice(0, -tail[1].length) + Math.floor(v4 / 65536).toString(16) + ':' + (v4 % 65536).toString(16);
    }
    var half = str.split('::');
    if (half.length > 2) return null;
    var head = half[0] ? half[0].split(':') : [];
    var rear = half.length === 2 ? (half[1] ? half[1].split(':') : []) : null;
    var g = [], i;
    for (i = 0; i < head.length; i++) g.push(parseInt(head[i], 16));
    if (rear !== null) {
      var fill = 8 - head.length - rear.length;
      if (fill < 1) return null;   // :: 至少代表一组零
      for (i = 0; i < fill; i++) g.push(0);
      for (i = 0; i < rear.length; i++) g.push(parseInt(rear[i], 16));
    }
    if (g.length !== 8) return null;
    for (i = 0; i < 8; i++) if (!(g[i] >= 0 && g[i] <= 65535)) return null;
    return g;
  }

  // ---------- Cloudflare 网段判定（官方列表无 CORS 头，只能本地内置比对） ----------
  var CF_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '1.1.1.0/24', '1.0.0.0/24'];
  var CF_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
    '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

  function stIsCfIp(host) {
    var h = String(host || '').replace(/^\[|\]$/g, ''), i, j;
    if (h.indexOf(':') !== -1) {
      var g = ip6ToGroups(h);
      if (!g) return false;
      for (i = 0; i < CF_V6.length; i++) {
        var pv = CF_V6[i].split('/'), pg = ip6ToGroups(pv[0]), len = Number(pv[1]), hit = true;
        if (!pg) continue;
        for (j = 0; j < len && hit; j += 16) {
          var bits = Math.min(16, len - j);
          var mask = 65536 - Math.pow(2, 16 - bits);   // 取高 bits 位：13 → 0xFFF8
          if ((g[j / 16] & mask) !== (pg[j / 16] & mask)) hit = false;
        }
        if (hit) return true;
      }
      return false;
    }
    var n = ip4ToInt(h);
    if (n === null) return false;
    for (i = 0; i < CF_V4.length; i++) {
      var q = CF_V4[i].split('/'), base = ip4ToInt(q[0]), div = Math.pow(2, 32 - Number(q[1]));
      if (base !== null && Math.floor(n / div) === Math.floor(base / div)) return true;
    }
    return false;
  }
  // 命中的前缀名（简写：补 .0.0 段），用于卡片/详情展示；非 CF 返回 ''
  function stCfCidr(host) {
    var h = String(host || '').replace(/^\[|\]$/g, '');
    if (h.indexOf(':') !== -1) {
      var g6 = ip6ToGroups(h);
      if (!g6) return '';
      for (var i = 0; i < CF_V6.length; i++) {
        var pv = CF_V6[i].split('/'), pg = ip6ToGroups(pv[0]), len = Number(pv[1]), hit = true;
        if (!pg) continue;
        for (var j = 0; j < len && hit; j += 16) {
          var bits = Math.min(16, len - j), mask = 65536 - Math.pow(2, 16 - bits);
          if ((g6[j / 16] & mask) !== (pg[j / 16] & mask)) hit = false;
        }
        if (hit) return CF_V6[i];
      }
      return '';
    }
    var n = ip4ToInt(h);
    if (n === null) return '';
    for (i = 0; i < CF_V4.length; i++) {
      var q = CF_V4[i].split('/'), base = ip4ToInt(q[0]), div = Math.pow(2, 32 - Number(q[1]));
      if (base !== null && Math.floor(n / div) === Math.floor(base / div)) {
        var o = String(q[0]).split('.');
        return [o[0], o[1], '0', '0'].join('.') + '/' + q[1];
      }
    }
    return '';
  }

  // ---------- 并发池（worker 定额；进度回调逐个上报） ----------
  function stRunPool(items, threads, taskFn, onProgress) {
    var total = items.length;
    threads = Math.max(1, Math.min(parseInt(threads, 10) || 1, total));
    var done = 0, next = 0;
    function worker() {
      if (next >= total) return Promise.resolve();
      var item = items[next++];
      return Promise.resolve().then(function () { return taskFn(item); }).then(function () {
        done++;
        if (onProgress) try { onProgress(done, total); } catch (e) {}
        return worker();
      });
    }
    var ws = [];
    for (var i = 0; i < threads; i++) ws.push(worker());
    return Promise.all(ws);
  }

  // ---------- 优选节点测速 ----------
  var ST_IP_TIMEOUT = 3000;
  var ST_IP_FLOOR = 20;
  // 探测恒 443；端口只展示用
  function stEffPort(cfgPort) {
    var n = parseInt(String(cfgPort || '443'), 10);
    return isNaN(n) ? 443 : n;
  }
  // 裸 IP 探测：no-cors 3s 超时判失败，<20ms 视为端口被封
  async function stProbeBareIp(host, port, isV6) {
    var url = 'https://' + (isV6 ? '[' + host + ']' : host) + ':' + port + '/cdn-cgi/trace';
    var got = [];
    for (var i = 0; i < 3; i++) {
      var t0 = performance.now(), timedOut = false;
      try {
        await fetch(url + '?_=' + Math.random(), {
          mode: 'no-cors', cache: 'no-store', referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(ST_IP_TIMEOUT),
        });
      } catch (e) { timedOut = !!(e && e.name === 'TimeoutError'); }
      var ms = performance.now() - t0;
      if (timedOut) return { ok: false, ms: 0 };
      if (ms < ST_IP_FLOOR) return { ok: false, ms: 0 };
      if (i > 0) got.push(ms);
    }
    return { ok: true, ms: Math.round((got[0] + got[1]) / 2) };
  }
  async function stTestNode(o, cfgPort) {
    var p = stParseAddr(o.addr);
    if (!p) { o.ok = false; return; }
    o.ipv6 = p.type === 'ipv6';
    o.testPort = stEffPort(cfgPort);
    if (p.type !== 'domain') {
      o.cf = stIsCfIp(p.host);
      var pr = await stProbeBareIp(p.host, 443, p.type === 'ipv6');
      if (!pr.ok) { o.ok = false; return; }
      o.ok = true;
      o.ms = pr.ms;
      if (o.cf) o.cfCidr = stCfCidr(p.host);
      var rg = await stLookupRegion(p.host, 443).catch(function () { return {}; });
      if (rg.region) o.region = rg.region;
      if (rg.colo) o.colo = rg.colo;
      return;
    }
    var base = 'https://' + p.host + ':443/cdn-cgi/trace';
    try {
      var times = [];
      for (var i = 0; i < 3; i++) {
        var url = base + '?_t=' + Date.now() + '&_r=' + i;
        var t0 = performance.now();
        var res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var text = await res.text();
        var elapsed = performance.now() - t0;
        if (i === 0) {
          var d = {};
          text.trim().split('\n').forEach(function (ln) {
            var kv = ln.split('=');
            if (kv[0] && kv[1]) d[kv[0].trim()] = kv[1].trim();
          });
          o.region = d.loc || '';
          o.colo = d.colo || '';
        }
        if (i > 0) {
          var net = elapsed;
          try {
            var ent = performance.getEntriesByName(url, 'resource');
            if (ent.length) {
              var tm = ent[ent.length - 1];
              if (tm.requestStart > 0 && tm.responseStart > 0) net = tm.responseStart - tm.requestStart;
            }
          } catch (e) {}
          times.push(net);
        }
      }
      try { performance.clearResourceTimings(); } catch (e) {}   // 防资源缓冲打满（默认 250 条）后拿不到 timing
      o.ms = Math.round(times.reduce(function (a, b) { return a + b; }, 0) / Math.max(times.length, 1));
      o.ok = true;
    } catch (e) {
      o.ok = false;
    }
  }

  // ---------- 数据来源解析：逐行 addr#备注 / 直链 URL(CORS) / 网段表达式 ----------
  function stIsIpv4Str(s) {
    var parts = s.split('.');
    return parts.length === 4 && parts.every(function (x) {
      var n = parseInt(x, 10);
      return !isNaN(n) && n >= 0 && n <= 255;
    });
  }
  function stExtract(text) {
    var clean = String(text == null ? '' : text).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
    var out = [];
    var seen = {};
    var push = function (addr, name) {
      addr = addr.trim(); name = (name || '').trim();
      var low = addr.toLowerCase();
      if (!addr || seen[addr]) return;
      if (low.indexOf('example.') !== -1 || low.indexOf('localhost') !== -1) return;
      seen[addr] = 1;
      out.push({ addr: addr, name: name });
    };
    // 第一优先：IP/域名 # 备注 形式（优选榜单常见格式）
    (clean.match(/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?#[^\s]+/g) || []).forEach(function (item) {
      var seg = item.split('#');
      var ipPart = seg[0].split(':')[0];
      if (stIsIpv4Str(ipPart)) push(seg[0], seg.slice(1).join('#'));
    });
    (clean.match(/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+)?#[^\s]+/g) || []).forEach(function (item) {
      var seg = item.split('#');
      if (seg[0].toLowerCase().lastIndexOf('www.', 0) !== 0) push(seg[0], seg.slice(1).join('#'));
    });
    if (!out.length) {
      (clean.match(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g) || []).forEach(function (ip) {
        if (stIsIpv4Str(ip.split(':')[0])) push(ip, '');
      });
    }
    if (!out.length) {
      (clean.match(/\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+)?\b/g) || []).forEach(function (dm) {
        if (dm.toLowerCase().lastIndexOf('www.', 0) !== 0) push(dm, '');
      });
    }
    return out;
  }

  // 网段表达式：a.b.*.0/24 # 第三段范围(单个/范围/逗号组合) # 运营商 → 每段随机 randomCount 个 IP
  // 仅支持 IPv4 网段（Cloudflare 优选段 162.159.*/104.16.*/172.64.* 等）；IPv6 端点请走「自定义」直接填地址测速
  function stParseSubnet(line, randomCount) {
    var out = [];
    var parts = line.split('#').map(function (s) { return s.trim(); });
    var m = (parts[0] || '').match(/^(\d{1,3})\.(\d{1,3})\.\*\.\d+\/24$/);
    if (!m) return out;
    var thirds = [];
    var hasRange = !!(parts[1] || '').trim();
    (parts[1] || '').split(',').forEach(function (r) {
      r = r.trim();
      if (!r) return;
      if (r.indexOf('-') !== -1) {
        var ab = r.split('-'), a = parseInt(ab[0], 10), b = parseInt(ab[1], 10);
        if (!isNaN(a) && !isNaN(b) && b >= a && b <= 255) for (var x = a; x <= b; x++) thirds.push(x);
      } else {
        var n = parseInt(r, 10);
        if (!isNaN(n) && n >= 0 && n <= 255) thirds.push(n);
      }
    });
    if (!thirds.length) {
      // 范围字段写了但全部无效：放弃该行（对齐主后端语义），不回退全量 1..255 盲扫
      if (hasRange) return out;
      for (var t = 1; t <= 255; t++) thirds.push(t);
    }
    thirds.forEach(function (third) {
      var used = {};
      for (var j = 0; j < randomCount && Object.keys(used).length < 254; j++) {
        var last;
        do { last = Math.floor(Math.random() * 254) + 1; } while (used[last]);
        used[last] = 1;
        out.push({ addr: m[1] + '.' + m[2] + '.' + third + '.' + last, isp: parts[2] || '' });
      }
    });
    return out;
  }

  // 汇总待测列表：网段展开 / 直链抓取 / 逐行解析，超出上限截断
  async function stBuildList(mode, content, randomCount, maxTest) {
    var lines = content.split(/[\r\n]+/).map(function (l) { return l.trim(); })
      .filter(function (l) { return l && l.charAt(0) !== '#' && l.slice(0, 2) !== '//'; });
    var list = [], seen = {};
    var add = function (raw, name, isp) {
      var addr = String(raw == null ? '' : raw).trim();
      if (!addr || seen[addr]) return;
      seen[addr] = 1;
      list.push({ addr: addr, name: name || '', isp: isp || '' });
    };
    if (mode === 'SUBNET' && !lines.some(function (l) { return /^https?:\/\//i.test(l); })) {
      // 网段优选：网段表达式走 stParseSubnet 展开；普通行（IP/域名）照常解析，两类可混用
      lines.forEach(function (ln) {
        if (/^\d{1,3}\.\d{1,3}\.\*\.\d+\/24/.test(ln)) {
          stParseSubnet(ln, randomCount).forEach(function (it) { add(it.addr, '', it.isp); });
        } else {
          var seg = ln.split('#');
          add(seg[0], seg.slice(1).join('#').trim());
        }
      });
    } else {
      for (var li = 0; li < lines.length; li++) {
        var ln = lines[li];
        if (/^https?:\/\//i.test(ln)) {
          try {
            toast('正在获取直链内容...');
            var res = await fetch(ln, { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var extracted = stExtract(await res.text());
            if (!extracted.length) throw new Error('未解析到有效地址');
            extracted.forEach(function (it) { add(it.addr, it.name); });
          } catch (e) {
            toast('直链获取失败: ' + e.message + '（需支持 CORS，如 GitHub raw）', true);
          }
        } else {
          var seg = ln.split('#');
          add(seg[0], seg.slice(1).join('#').trim());
        }
      }
    }
    if (list.length > maxTest) {
      toast('地址数量已截断：' + list.length + ' → ' + maxTest);
      list = list.slice(0, maxTest);
    }
    return list;
  }

  // ---------- 文案映射（纯函数，卡片 / 详情 / 状态栏共用） ----------
  var ISP_CN = { Telecom: '电信', Mobile: '移动', Unicom: '联通', Three: '三网' };
  function stTimeHM(d) {
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function stKindLabel(o, tab) {
    if (o.isp) return '网段优选 · ' + (ISP_CN[o.isp] || o.isp);
    var p = stParseAddr(o.addr) || {};
    return (tab === 'speed' ? '优选' : '反代') + (p.type === 'ipv6' ? 'IPv6' : p.type === 'domain' ? '域名' : 'IP');
  }
  // 卡片 title：时间 HH:MM · 机房 · 类型 · 点击查看详情
  function stTipOf(o, tab) {
    if (o.ok === false) return '时间 ' + o.time + ' · 测速超时 · 点击查看详情';
    var parts = ['时间 ' + o.time];
    if (o.colo) parts.push('机房 ' + o.colo);
    parts.push(stKindLabel(o, tab));
    return parts.join(' · ') + ' · 点击查看详情';
  }
  // 卡片展示地址：未自带端口的地址补显示实际测试端口（测速设置指定 > 地址自带 > 默认 443）
  function stDisplayAddr(o) {
    var raw = String(o.addr || '');
    var p = stParseAddr(raw);
    if (!p) return raw;
    var hasPort = p.type === 'ipv6' ? /\]:\d+$/.test(raw) : /:\d+$/.test(raw);   // 原始串是否自带端口（不能问 parser：它会把缺省当 443）
    var eff = String(o.testPort || (hasPort ? p.port : stEffPort(stCfgRead().port)));
    if (hasPort && eff === String(p.port)) return raw;   // 自带端口且未被测速设置覆盖：原样展示
    return (p.type === 'ipv6' ? '[' + p.host + ']' : p.host) + ':' + eff;
  }
  function fmtLogTime(ts) {
    var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var t8 = ts ? new Date(Number(ts) + 8 * 3600 * 1000) : null;
    if (!t8 || isNaN(t8.getTime())) return '-';
    return t8.getUTCFullYear() + '/' + (t8.getUTCMonth() + 1) + '/' + t8.getUTCDate() +
      ' ' + pad2(t8.getUTCHours()) + ':' + pad2(t8.getUTCMinutes()) + ':' + pad2(t8.getUTCSeconds());
  }

  // ---------- 网络检测：站点延迟采样 + 出口 IP 情报 ----------
  var LATENCY_TIMEOUT = 5000;
  /** 单次延迟采样：no-cors 取整程耗时，超时/失败返回 -1 */
  async function testLatency(site) {
    var start = Date.now();
    try {
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, LATENCY_TIMEOUT);
      await fetch(site.url + '?t=' + Date.now(), { method: 'GET', cache: 'no-store', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeoutId);
      return Date.now() - start;
    } catch (e) { return -1; }
  }
  function latencyColor(l) {
    if (l === -1) return '#9ca3af';
    if (l <= 49) return '#22c55e';
    if (l <= 99) return '#84cc16';
    if (l <= 149) return '#eab308';
    if (l <= 199) return '#f97316';
    return '#ef4444';
  }
  function calcAbuseScore(company, asn, flags) {
    flags = flags || {};
    var c = parseFloat(company) || 0, a = parseFloat(asn) || 0;
    var base = ((c + a) / 2) * 5;
    var risks = [flags.is_crawler, flags.is_proxy, flags.is_vpn, flags.is_tor, flags.is_abuser, flags.is_bogon];
    base += risks.filter(Boolean).length * 0.15;
    var hit = risks.filter(Boolean).length;
    return (c === 0 && a === 0 && hit === 0) ? null : base;
  }
  /** 滥用评分归一化：上游可能给数字、字符串或 {fraction,...} 对象，统一为可解析字符串或 null */
  function fmtAbuserScore(v) {
    if (v == null || v === '' || v === '未知') return null;
    if (typeof v === 'number' && isFinite(v)) return String(v);
    if (typeof v === 'object' && v.fraction != null && isFinite(v.fraction)) return String(v.fraction);
    if (typeof v === 'string') return v;
    return null;
  }
  function abuseScoreBadge(score) {
    if (score === null) return { cls: 'badge-info', text: '未知' };
    var pct = score * 100;
    var level = '极度纯净', cls = 'badge-verylow';
    if (pct >= 100) { level = '极度危险'; cls = 'badge-critical'; }
    else if (pct >= 20) { level = '高风险'; cls = 'badge-high'; }
    else if (pct >= 5) { level = '轻微风险'; cls = 'badge-elevated'; }
    else if (pct >= 0.25) { level = '纯净'; cls = 'badge-low'; }
    return { cls: cls, text: pct.toFixed(2) + '% ' + level };
  }

  /** 取本机出口 IP：三家接口按序回落，命中带 * 掩码的继续下一家 */
  async function fetchOutboundIp() {
    var apis = [
      { url: 'https://api.ipapi.is', parser: function (d) { return d.ip; } },
      { url: 'https://api-v3.speedtest.cn/ip', parser: function (d) { return d.data && d.data.ip; } },
      { url: 'https://myip.ipip.net/json', parser: function (d) { return d.data && d.data.ip; } }
    ];
    var ip = null;
    for (var i = 0; i < apis.length; i++) {
      try {
        var res = await fetch(apis[i].url + '?t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          ip = apis[i].parser(await res.json());
          if (ip && ip.indexOf('*') === -1) break;
        }
      } catch (e) {}
    }
    return ip;
  }
  /** IP 情报接口清单：逐家回落，各自把响应归一化为统一结构（无效返回 null） */
  function ipDetailApis(ip) {
    return [
      { name: 'ipapi.is', url: 'https://api.ipapi.is/?ip=' + ip, parser: function (d) {
          // 防限流空壳：必须同时有 ip 与（位置或 ASN）才算有效，否则回落下一家
          if (!d || !d.ip || (!d.location && !d.asn)) return null;
          return {
            ip: d.ip,
            rir: d.rir || '',
            is_crawler: !!d.is_crawler, is_proxy: !!d.is_proxy, is_vpn: !!d.is_vpn,
            is_tor: !!d.is_tor, is_abuser: !!d.is_abuser, is_bogon: !!d.is_bogon,
            company: { name: (d.company && d.company.name) || '', domain: (d.company && d.company.domain) || '', type: (d.company && d.company.type) || '', network: (d.company && d.company.network) || '', abuser_score: d.company ? d.company.abuser_score : null },
            asn: { asn: (d.asn && d.asn.asn) || '', org: (d.asn && d.asn.org) || '', route: (d.asn && d.asn.route) || '', type: (d.asn && d.asn.type) || '', country: (d.asn && d.asn.country) || '', abuser_score: d.asn ? d.asn.abuser_score : null },
            location: d.location ? { country: d.location.country, country_code: d.location.country_code, city: d.location.city, state: d.location.state, zip: d.location.zipcode, latitude: d.location.latitude, longitude: d.location.longitude, timezone: d.location.timezone, local_time: d.location.localtime } : null
          };
      } },
      { name: 'ipwho.is', url: 'https://ipwho.is/' + ip, parser: function (d) {
          if (!d || d.success === false || !d.ip) return null;
          return {
            ip: d.ip,
            rir: '',
            company: { name: (d.connection && d.connection.isp) || '', domain: (d.connection && d.connection.domain) || '', type: 'isp', abuser_score: null },
            asn: { asn: (d.connection && d.connection.asn) || '', org: (d.connection && d.connection.org) || '', country: d.country_code || '', abuser_score: null },
            location: { country: d.country, country_code: d.country_code, city: d.city, state: d.region, zip: d.postal, latitude: d.latitude, longitude: d.longitude, timezone: d.timezone && d.timezone.id }
          };
      } },
      { name: 'ipapi.co', url: 'https://ipapi.co/' + ip + '/json/', parser: function (d) {
        return {
          ip: d.ip,
          rir: (d.org || '').indexOf('APNIC') !== -1 ? 'APNIC' : ((d.org || '').indexOf('RIPE') !== -1 ? 'RIPE' : 'ARIN'),
          company: { name: d.org || '-', type: d.asn ? 'isp' : 'unknown', abuser_score: '未知' },
          location: { country: d.country_name || '-', country_code: d.country_code || '-', city: d.city || '-', state: d.region || '-', timezone: d.timezone || '-' },
          asn: { asn: (d.asn || '').replace('AS', '') || '-', org: d.org || '-', type: 'isp', abuser_score: '未知' }
        };
      } },
      { name: 'zxinc', url: 'https://ip.zxinc.org/api.php?type=json&ip=' + ip, parser: function (d) {
        return d.code === 0 ? {
          ip: ip,
          rir: 'APNIC',
          company: { name: (d.data && d.data.isp) || '-', type: 'isp', abuser_score: '未知' },
          location: { country: (d.data && d.data.country) || '中国', country_code: 'CN', city: (d.data && d.data.local) || '-', state: '-', timezone: 'Asia/Shanghai' },
          asn: { asn: '-', org: (d.data && d.data.isp) || '-', type: 'isp', abuser_score: '未知' }
        } : null;
      } }
    ];
  }

  /**
   * 查询本机出口 IP 的完整情报：出口 IP → 情报接口逐家回落 → RDAP 补齐 RIR/国家。
   * 失败抛错（调用方负责提示），成功返回归一化后的 detail 对象。
   */
  async function queryIpDetail() {
    var ip = await fetchOutboundIp();
    if (!ip) throw new Error('无法获取 IP');
    var apis = ipDetailApis(ip);
    var detail = null;
    for (var j = 0; j < apis.length; j++) {
      try {
        var r2 = await fetch(apis[j].url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!r2.ok) continue;
        var cand = apis[j].parser(await r2.json());
        // 完整性校验：至少要有位置或 ASN，防「只有 IP 的空壳」顶掉后续可用接口
        if (cand && cand.ip && (cand.location || cand.asn)) { detail = cand; break; }
      } catch (e) {}
    }
    if (!detail) throw new Error('查询失败');
    // 数据补齐：轻量接口（如 ipwho.is）不带 RIR/国家时，走 RDAP 注册目录兜底
    // （rdap.org 免费免钥、自动重定向到对应 RIR；按自引用链接识别归属注册机构）
    if (!detail.rir || !detail.location || !detail.location.country) {
      try {
        var rdap = await fetch('https://rdap.org/ip/' + ip, { signal: AbortSignal.timeout(6000) })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
        if (rdap) {
          if (!detail.rir) {
            var hrefs = JSON.stringify(rdap.links || []).toLowerCase() + ' ' + String(rdap.handle || '').toLowerCase();
            var rirs = ['afrinic', 'apnic', 'lacnic', 'ripencc', 'arin'];   // 顺序敏感：arin 必须在 afrinic 之后判
            for (var k = 0; k < rirs.length; k++) {
              if (hrefs.indexOf(rirs[k]) !== -1) { detail.rir = rirs[k].toUpperCase(); break; }
            }
          }
          if (rdap.country) {
            detail.location = detail.location || {};
            if (!detail.location.country) detail.location.country = rdap.country;
            if (!detail.location.country_code) detail.location.country_code = rdap.country;
          }
        }
      } catch (e) {}
    }
    return detail;
  }

  window.LiteCore = {
    // 通用工具
    escHtml: escHtml,
    fmtNum: fmtNum,
    pagerPages: pagerPages,
    copyText: copyText,
    downloadText: downloadText,
    // 本地状态
    stStoreRead: stStoreRead,
    stStoreWrite: stStoreWrite,
    stCfgRead: stCfgRead,
    stCfgWrite: stCfgWrite,
    regionCacheClear: regionCacheClear,
    stLookupRegion: stLookupRegion,
    cfgDraftRead: cfgDraftRead,
    cfgDraftWrite: cfgDraftWrite,
    cfgDraftClear: cfgDraftClear,
    // 地址解析
    stParseAddr: stParseAddr,
    stSplitAddr: stSplitAddr,
    stBuildList: stBuildList,
    stExtract: stExtract,
    stParseSubnet: stParseSubnet,
    // 测速探测
    stRunPool: stRunPool,
    stTestNode: stTestNode,
    stCfCidr: stCfCidr,
    stIsCfIp: stIsCfIp,
    // 文案映射
    stTimeHM: stTimeHM,
    stKindLabel: stKindLabel,
    stTipOf: stTipOf,
    stDisplayAddr: stDisplayAddr,
    fmtLogTime: fmtLogTime,
    // 网络检测 / IP 情报
    testLatency: testLatency,
    latencyColor: latencyColor,
    queryIpDetail: queryIpDetail,
    calcAbuseScore: calcAbuseScore,
    fmtAbuserScore: fmtAbuserScore,
    abuseScoreBadge: abuseScoreBadge
  };
})();
