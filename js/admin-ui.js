/**
 * Senflare Warp — Admin UI（渲染与交互层）
 * 分层：接口与业务逻辑全在 js/admin.js（LiteAPI / LiteCore），本文件只做 DOM 与事件；
 * 主题（明暗切换 + 调色盘）整体在 js/theme.js
 */
(function () {
  var VIEWS = ['dashboard', 'nodes', 'security', 'logs', 'advanced', 'about'];

  // ============ 访客模式（令牌 g 角色）：仅开放 数据看板 / 节点订阅 / 关于我们 ============
  var GUEST_TABS = { dashboard: 1, 'nodes-subscription': 1, about: 1 };
  var IS_GUEST = (function () {
    try { return !!(window.LiteAPI && LiteAPI.isGuest && LiteAPI.isGuest()); } catch (e) { return false; }
  })();
  if (IS_GUEST) {
    document.querySelectorAll('.nav-item').forEach(function (a) {
      if (!GUEST_TABS[a.getAttribute('data-tab')]) a.style.display = 'none';
    });
    var ui = document.querySelector('.sidebar-footer .user-info');
    if (ui) ui.title = '访客';
  }

  // ============ 逻辑层引用（js/admin.js → window.LiteCore） ============
  var Core = window.LiteCore || {};
  var escHtml = Core.escHtml, cfFmt = Core.fmtNum, pagerPages = Core.pagerPages;
  var copyText = Core.copyText, downloadText = Core.downloadText;
  var stStoreRead = Core.stStoreRead, stStoreWrite = Core.stStoreWrite, stCfgRead = Core.stCfgRead;
  var cfgDraftRead = Core.cfgDraftRead, cfgDraftClear = Core.cfgDraftClear;
  var stParseAddr = Core.stParseAddr, stSplitAddr = Core.stSplitAddr;
  var stBuildList = Core.stBuildList, stRunPool = Core.stRunPool;
  var stTestNode = Core.stTestNode;
  var stTimeHM = Core.stTimeHM, stKindLabel = Core.stKindLabel, stTipOf = Core.stTipOf;
  var stDisplayAddr = Core.stDisplayAddr;
  var testLatency = Core.testLatency, getLatencyColor = Core.latencyColor;
  var calcAbuseScore = Core.calcAbuseScore, fmtAbuserScore = Core.fmtAbuserScore, getAbuseScoreBadge = Core.abuseScoreBadge;

  // ============ 侧边栏 / 卡片 / Toast / 导航 ============
  var FOLD_CHEVRON = {
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
  };
  function toggleSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.querySelector('.sidebar-overlay');
    if (!sidebar) return;
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('show');
      if (overlay) overlay.classList.toggle('show');
    } else {
      sidebar.classList.toggle('expanded');
    }
  }
  function toggleCard(btn) {
    var card = btn.closest('.card');
    if (!card) return;
    var body = card.querySelector('.card-body');
    if (!body) return;
    var hidden = body.style.display === 'none';
    body.style.display = hidden ? 'block' : 'none';
    btn.innerHTML = hidden ? FOLD_CHEVRON.up : FOLD_CHEVRON.down;   // 展开态向上箭头，折叠态向下（复用 dock 折叠图标）
  }
  function showToast(msg, isError) {
    var t = document.getElementById('toast');
    if (!t || !msg) return;
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.style.opacity = '';          // 清掉遗留内联 opacity，避免压住 .show 类
    t.style.visibility = '';
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 3000);
  }
  // 节点配置：未保存守卫（草稿非空即有修改）
  function cfgHasUnsaved() {
    var d = cfgDraftRead();
    for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) return true; }
    return false;
  }
  function cfgViewActive() {
    var s = document.querySelector('#view-nodes .nodes-subview[data-sub="config"]');
    return !!(s && s.style.display === 'block');
  }
  function doSwitchTab(tab, el) {
    if (IS_GUEST && !GUEST_TABS[tab]) {   // 访客角色越权 tab 一律回落数据看板（导航已隐藏，兜底 localStorage 残留）
      tab = 'dashboard';
      el = document.querySelector('.nav-item[data-tab="dashboard"]');
    }
    var mainTab = tab;
    if (tab.indexOf('nodes-') === 0) mainTab = 'nodes';
    document.querySelectorAll('.nav-item').forEach(function (a) { a.classList.remove('active'); });
    if (el) el.classList.add('active');
    else {
      var sel = document.querySelector('.nav-item[data-tab="' + tab + '"]') || document.querySelector('.nav-item[data-tab="' + mainTab + '"]');
      if (sel) sel.classList.add('active');
    }
    try { localStorage.setItem('sf_warp_tab', tab); } catch (e) {}   // 记住当前 tab，刷新后保持
    if (window.innerWidth <= 768) {
      var sidebar = document.getElementById('sidebar');
      var overlay = document.querySelector('.sidebar-overlay');
      if (sidebar && sidebar.classList.contains('show')) {
        sidebar.classList.remove('show');
        if (overlay) overlay.classList.remove('show');
      }
    }
    VIEWS.forEach(function (v) {
      var view = document.getElementById('view-' + v);
      if (view) view.style.display = (v === mainTab) ? 'block' : 'none';
    });
    if (mainTab === 'nodes') {
      var sub = tab.indexOf('nodes-') === 0 ? tab.replace('nodes-', '') : 'config';
      document.querySelectorAll('.nodes-subview').forEach(function (s) {
        s.style.display = (s.getAttribute('data-sub') === sub) ? 'block' : 'none';
      });
    }
    // 悬浮操作按钮（保存/恢复默认）仅在节点配置子视图显示
    var cfgFab = document.getElementById('cfgFab');
    if (cfgFab) {
      var fabSub = tab.indexOf('nodes-') === 0 ? tab.replace('nodes-', '') : 'config';
      cfgFab.classList.toggle('show', mainTab === 'nodes' && fabSub === 'config');
    }
    if (mainTab === 'nodes' && sub === 'speedtest') fillSpeedTest();   // 在线优选（进入子视图后再渲染，保证列宽度量准确）
    else if (mainTab === 'nodes' && sub === 'subscription') fillSubUrl();   // 切回订阅页时按最新配置刷新已生成的链接
    else if (mainTab === 'nodes' && sub === 'config') loadCfgForm(true);
    else if (mainTab === 'nodes' && sub === 'backend') ensureWarpLoaded(true);    // 账号列表：每次进入强制拉取 WARP 账号（跨页/跨标签改动即时可见）
    else if (mainTab === 'dashboard') { dashboardLoad(); ensureNetCheck(); }   // 数据看板：运行状态 + 用量环 + 网络检测（首次进入触发）
    else if (mainTab === 'advanced') fillSystemBar();                       // 高级设置：系统状态栏
    else if (mainTab === 'security') fillSecurity();                        // 安全设置：账号/登录安全/限流/黑名单回填
    else if (mainTab === 'logs') fillLogs();                                // 系统日志：拉取并渲染操作日志
    var content = document.querySelector('.content');
    if (content) content.scrollTo(0, 0);
  }
  // 未保存守卫：离开节点配置页时弹窗询问「保存并离开 / 直接离开」；保存失败则留在本页提示
  function requestLeaveNodesConfig(go) {
    var staying = go.tab === 'nodes' || go.tab === 'nodes-config';
    if (staying || !cfgViewActive() || !cfgHasUnsaved()) { doSwitchTab(go.tab, go.el); return; }
    window.__showConfirm('节点配置有未保存的修改，是否保存后再离开？',
      async function () {                                  // 「保存并离开」
        await window.__saveCfg();
        if (cfgHasUnsaved()) {                             // 草稿仍在 = 保存失败：留下，可改选直接离开
          showToast('保存失败：请检查后端连接，或选择「直接离开」放弃修改', true);
          return;
        }
        doSwitchTab(go.tab, go.el);
      },
      '未保存的修改',
      { okText: '保存并离开', cancelText: '直接离开',
        onDiscard: function () { cfgDraftClear(); doSwitchTab(go.tab, go.el); } });
  }
  function switchTab(tab, el) { requestLeaveNodesConfig({ tab: tab, el: el }); }

  // ============ 节点/反代配置：模式下拉 ↔ 编辑框显隐联动（UI-only） ============
  // 预设模式（OFFICIAL/AUTO/地区）全部隐藏编辑框；仅 CUSTOM/LOCAL 显示对应文本域
  // data-cfg 键名与 Lite _worker.js ConfigKeys 的 PascalCase 常量一一对应
  function cfgModeLink(mode, customSel, localTa) {
    var m = String(mode || '').toUpperCase();
    var main = document.querySelector('[data-cfg="' + customSel + '"]');
    var local = document.querySelector('[data-cfg="' + localTa + '"]');
    var isCustom = m === 'CUSTOM';
    var isLocal = m === 'LOCAL';
    if (main) main.style.display = isCustom ? '' : 'none';
    if (local) local.style.display = isLocal ? '' : 'none';
  }
  window.__cfgIPMode = function (mode) { cfgModeLink(mode, 'IP', 'LocalIP'); };

  // ============ MASQUE 配置：优选端点来源 联动显隐（UI-only） ============
  // MasqueIPMode：CUSTOM 显示「自定义候选 MasqueIP」，LOCAL 显示「在线优选 LocalIP」，ACCOUNT 都隐藏（回落账号端点）
  window.__masqueIPMode = function (mode) {
    var custom = document.querySelector('[data-cfg="MasqueIP"]');
    var local = document.querySelector('[data-cfg="LocalIP"]');
    var m = String(mode || '').toUpperCase();
    if (custom) custom.style.display = m === 'CUSTOM' ? '' : 'none';
    if (local) local.style.display = m === 'LOCAL' ? '' : 'none';
  };
  // MasqueTransport 变更无联动（SNI 已合并为单个下拉，h2/h3 共用同一值）
  window.__masqueTransport = function () {};

  // 「预设下拉 + 自定义输入」通用联动：选中 自定义… 时展开配套输入框
  document.addEventListener('change', function (e) {
    var s = e.target;
    if (!s || !s.matches || !s.matches('select[data-custom-target]')) return;
    var inp = document.getElementById(s.getAttribute('data-custom-target'));
    if (inp) inp.style.display = s.value === 'custom' ? '' : 'none';
  });

  // ============ 节点配置：服务端配置（/api/config）+ 本地未保存编辑 ============
  // 数据流：回填（草稿优先）→ 保存写 D1 清草稿
  function cfgDraftSave(el) {
    if (!el.dataset.cfg) return;
    var d = cfgDraftRead();
    d[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : el.value;
    Core.cfgDraftWrite(d);
  }
  // 编辑即暂存：未保存的修改记入本地草稿（优先级高于服务端值），保存成功后清除；
  // CFG_FILLING = 表单回填中——fillCfgControl 的合成 change 不计入用户编辑
  var CFG_FILLING = false;
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (CFG_FILLING) return;
    if (t && t.dataset && t.dataset.cfg && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) cfgDraftSave(t);
  });
  try { localStorage.removeItem('sf_warp_cfg_draft_v1'); } catch (e) {}   // 清理遗留旧版草稿键
  var CFG_SERVER = null;        // 最近一次 /api/config 结果（订阅页取 SubPath 等复用）
  var CFG_LOADING = false;
  var CFG_WAITERS = [];
  function ensureCfgLoaded(force) {
    if (!window.LiteAPI) return Promise.resolve(null);   // 纯静态预览：跳过
    if (CFG_SERVER && !force) return Promise.resolve(CFG_SERVER);
    if (CFG_LOADING) return new Promise(function (res) { CFG_WAITERS.push(res); });
    CFG_LOADING = true;
    return LiteAPI.getConfig().then(function (c) {
      CFG_LOADING = false;
      if (c) CFG_SERVER = c;
      CFG_WAITERS.splice(0).forEach(function (w) { w(CFG_SERVER); });
      return CFG_SERVER;
    });
  }
  // 单个控件按「草稿 > 服务端」填值；下拉值不在预设选项时落到配套自定义输入框
  function fillCfgControl(el, srv, draft) {
    var k = el.dataset.cfg;
    var hasDraft = Object.prototype.hasOwnProperty.call(draft, k);
    if (!hasDraft && !(k in srv)) return;
    var v = hasDraft ? draft[k] : srv[k];
    if (el.type === 'checkbox') { el.checked = v === true || v === 'true'; return; }
    var sv = String(v == null ? '' : v);
    if (el.tagName === 'SELECT') {
      // 大小写不敏感匹配：NodeDefaults 里 IPMode='Custom'，而下拉选项值是大写 CUSTOM——严格相等会误判为「自定义值」落进自定义输入框
      var up = sv.toUpperCase();
      var hitOpt = null;
      Array.prototype.forEach.call(el.options, function (o) {
        if (!hitOpt && o.value.toUpperCase() === up) hitOpt = o;
      });
      if (hitOpt) {
        el.value = hitOpt.value;
      } else if (sv) {
        var cust = document.getElementById(el.getAttribute('data-custom-target') || '');
        if (cust) { cust.value = sv; el.value = 'custom'; }
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));   // 触发 LOCAL 显隐 / 自定义输入显隐 / ms 文案联动
    } else {
      el.value = sv;
    }
  }
  async function loadCfgForm(force) {
    var srv = await ensureCfgLoaded(force);
    if (!srv) return;
    var draft = cfgDraftRead();
    CFG_FILLING = true;                       // 回填产生的合成 change 不计入用户编辑
    try {
      document.querySelectorAll('select[data-cfg]').forEach(function (el) { fillCfgControl(el, srv, draft); });
      document.querySelectorAll('input[data-cfg],textarea[data-cfg]').forEach(function (el) { fillCfgControl(el, srv, draft); });
    } finally { CFG_FILLING = false; }
  }
  // 收集全部 data-cfg 控件；选中「自定义」的下拉用配套输入框的实际值覆盖
  function collectCfgPayload() {
    var payload = {};
    document.querySelectorAll('[data-cfg]').forEach(function (el) {
      if (el.disabled) return;
      payload[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : String(el.value).trim();
    });
    document.querySelectorAll('select[data-cfg][data-custom-target]').forEach(function (sel) {
      if (sel.disabled || sel.value !== 'custom') return;
      var cust = document.getElementById(sel.getAttribute('data-custom-target'));
      if (cust && String(cust.value).trim()) payload[sel.dataset.cfg] = String(cust.value).trim();
    });
    return payload;
  }
  // 保存所有配置：整体写入 D1（服务端白名单过滤，Protocol/Transport 等前端占位键自动忽略）
  window.__saveCfg = async function () {
    if (!window.LiteAPI) { showToast('后端未接入', true); return; }
    var r = await LiteAPI.saveConfig(collectCfgPayload());
    if (!r) { showToast('保存失败：后端未返回结果（请检查登录态与后端连接）', true); return; }
    cfgDraftClear();
    CFG_SERVER = null;                       // 下次进入重新拉取，保证展示与库内一致
    DASH_STATUS = null;                      // 看板状态含订阅域名等配置快照，保存后同步失效
    if (r.message) showToast(r.message); else { showToast('配置已保存'); }
  };
  // ms 触发器文本与选中态跟随 select 值同步
  function syncMsTrigger(sel) {
    var box = sel.nextElementSibling;
    if (!box || !box.classList.contains('ms')) return;
    var o = sel.options[sel.selectedIndex];
    var v = box.querySelector('.ms-value');
    if (v && o) v.textContent = o.textContent;
    box.querySelectorAll('.ms-opt.single').forEach(function (opt) {
      opt.classList.toggle('active', opt.dataset.val === sel.value);
    });
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.dataset || !t.dataset.cfg || t.tagName !== 'SELECT') return;
    if (!CFG_FILLING) cfgDraftSave(t);   // 回填中的合成 change 只做 UI 同步，不计入用户编辑
    syncMsTrigger(t);
  });
  // 恢复默认配置：确认后清空 D1 白名单键（服务端复位为 NodeDefaults），本地草稿一并清除
  window.__resetCfgDraft = async function () {
    if (!window.LiteAPI) { cfgDraftClear(); location.reload(); return; }
    if (!confirm('确定恢复默认配置？将清除 D1 中保存的全部节点/反代配置。')) return;
    var r = await LiteAPI.saveConfig({ RESET: true });
    if (!r) return;
    cfgDraftClear();
    CFG_SERVER = null;
    showToast('已恢复默认配置');
    setTimeout(function () { location.reload(); }, 800);
  };

  // ============ 节点订阅 ============
  // 订阅格式参数（MASQUE 直连，仅 b64/clash/singbox；surge/quanx 已移除）
  var SUB_FMTS = {
    auto:    '',                // 自适应：Worker 按 UA 检测客户端
    b64:     '?b64',            // base64（masque:// 链接）
    clash:   '?clash',
    singbox: '?singbox'
  };
  var subFmt = '';
  // 订阅根地址：后端 /api/status 下发完整地址（含路径段凭证）；纯静态预览时回落为「域名+配置路径」
  function subUrlAsync() {
    if (window.LiteAPI) {
      return LiteAPI.getStatus().then(function (s) { return (s && s.subUrl) || ''; });
    }
    return ensureCfgLoaded().then(function (srv) {
      if (!location.origin || location.origin === 'null') return '';
      var d = cfgDraftRead() || {};
      var raw = Object.prototype.hasOwnProperty.call(d, 'SubPath')
        ? d.SubPath
        : (srv && srv.SubPath != null ? srv.SubPath : '');
      var p = '/' + String(raw == null ? '' : raw).trim().replace(/^\/+|\/+$/g, '');
      if (p === '/') p = '/links';
      return location.origin + p;
    });
  }
  function generateSub(type) {
    if (!SUB_FMTS.hasOwnProperty(type)) type = 'auto';
    subFmt = type;
    document.querySelectorAll('.sub-format-group [data-fmt]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-fmt') === type);
    });
    var grp = document.getElementById('sub-result-group');
    if (grp) grp.style.display = 'block';
    hideSubQR();
    fillSubUrl();
  }
  // 组装并刷新当前展示链接：点按钮生成与切回订阅页共用（ 每次都取最新配置 ）
  function fillSubUrl() {
    if (!subFmt) return;
    subUrlAsync().then(function (base) {
      var inp = document.getElementById('generated-sub-url');
      if (!inp) return;
      if (!base) { showToast('本地文件预览无法生成订阅链接，请部署后使用', true); return; }
      var next = base + SUB_FMTS[subFmt];
      if (inp.value && inp.value !== next) hideSubQR();   // 链接已变化：旧扫码作废，收起防止扫到失效链接
      inp.value = next;
    });
  }
  function copySubUrl() {
    var inp = document.getElementById('generated-sub-url');
    if (!inp || !inp.value) { showToast('请先生成订阅链接', true); return; }
    copyText(inp.value, '订阅链接已复制到剪贴板');
  }
  function toggleSubQR() {
    var box = document.getElementById('qrcode-container');
    if (!box) return;
    if (box.style.display === 'flex') { hideSubQR(); return; }         // 再点一次收起（ 对齐完整版 showUserQR ）
    var inp = document.getElementById('generated-sub-url');
    if (!inp || !inp.value) { showToast('请先生成订阅链接', true); return; }
    if (typeof QRCode === 'undefined') { showToast('扫码组件未加载', true); return; }
    box.innerHTML = '';
    box.style.display = 'flex';
    new QRCode(box, { text: inp.value, width: 180, height: 180, colorLight: 'transparent', correctLevel: QRCode.CorrectLevel.M });
  }
  function hideSubQR() {
    var box = document.getElementById('qrcode-container');
    if (box) { box.style.display = ''; box.innerHTML = ''; }           // 清空内联样式回落 CSS display:none
  }

  // ============ 原生 select 全局替换为 ms-panel 自建下拉（禁止浏览器默认样式接管） ============
  var MS_CARET = '<svg class="ms-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>';
  // 毛玻璃卡片各自成层叠上下文：展开下拉时给宿主卡片临时抬层，收起后撤掉
  function syncCardLift() {
    document.querySelectorAll('.card.ms-open-card').forEach(function (c) {
      if (!c.querySelector('.ms.open')) c.classList.remove('ms-open-card');
    });
  }
  function enhanceSelects(scope) {
    (scope || document).querySelectorAll('select:not([data-ms])').forEach(function (sel) {
      sel.setAttribute('data-ms', '1');
      sel.classList.add('hidden');
      var box = document.createElement('div');
      box.className = 'ms';
      var value = document.createElement('span');
      value.className = 'ms-value';
      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ms-trigger ui-field';
      if (sel.disabled) trigger.disabled = true;
      trigger.appendChild(value);
      trigger.insertAdjacentHTML('beforeend', MS_CARET);
      var list = document.createElement('div');
      list.className = 'ms-list';
      Array.prototype.forEach.call(sel.options, function (o) {
        var opt = document.createElement('div');
        opt.className = 'ms-opt single';
        opt.dataset.val = o.value;
        opt.textContent = o.textContent.trim();
        opt.style.display = o.style.display || '';   // 镜像原生 option 的显隐（Fixed 联动隐藏非 CUSTOM/LOCAL）
        opt.onclick = function () {
          sel.value = o.value;
          sync();
          closePanel();
          sel.dispatchEvent(new Event('change', { bubbles: true }));   // 需冒泡：文档级自定义输入联动依赖它
        };
        list.appendChild(opt);
      });
      var panel = document.createElement('div');
      panel.className = 'ms-panel';
      panel.appendChild(list);
      box.appendChild(trigger);
      box.appendChild(panel);
      function sync() {
        var o = sel.options[sel.selectedIndex];
        value.textContent = o ? o.textContent : '';
        list.querySelectorAll('.ms-opt.single').forEach(function (opt) {
          opt.classList.toggle('active', opt.dataset.val === sel.value);
        });
      }
      function openPanel() {
        document.querySelectorAll('.ms.open').forEach(function (m) { if (m !== box) m.classList.remove('open'); });
        // 下方空间不足且上方充足时向上展开（dropup）
        box.classList.remove('dropup');
        panel.style.display = 'block';
        var ph = panel.offsetHeight, below = innerHeight - trigger.getBoundingClientRect().bottom;
        panel.style.display = '';
        if (below < ph + 12 && trigger.getBoundingClientRect().top > ph + 12) box.classList.add('dropup');
        box.classList.add('open');
        var hostCard = box.closest('.card');
        if (hostCard) hostCard.classList.add('ms-open-card');   // 展开期间宿主卡片抬层
        syncCardLift();
      }
      function closePanel() { box.classList.remove('open'); syncCardLift(); }
      trigger.onclick = function () { box.classList.contains('open') ? closePanel() : openPanel(); };
      sel.after(box);
      sync();
    });
  }
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.ms.open').forEach(function (m) {
      if (!m.contains(e.target)) m.classList.remove('open');
    });
    syncCardLift();
  });
  enhanceSelects();

  // 会话信息：侧边栏用户名显示为当前登录账号（/api/session）
  if (window.LiteAPI && !LiteAPI.loginExpired()) {
    LiteAPI.call('/api/session').then(function (s) {
      if (!s || !s.username) return;
      var el = document.getElementById('sidebarUsername');
      if (el) el.textContent = s.username;
    });
  }

  // ============ 在线优选（真实测速：优选走 /cdn-cgi/trace 三连打点，反代走 check API 探测） ============
  // 探测/解析核心在 LiteCore（js/admin.js），本节只做卡片渲染、分页与交互
  var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s6-4.35 6-10a6 6 0 1 0-12 0c0 5.65 6 10 6 10z"/><circle cx="12" cy="11" r="2.5"/></svg>';
  var BOLT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
  // ns+idx 同时给出时，未测速卡片挂单卡测速回调（在线优选测速中走 stPatchCard 打点）
  function nodeCardHtml(o, ns, idx, showName) {
    var c = /^[A-Za-z]{2}$/.test(o.region || '') ? o.region.toLowerCase() : '';
    var pingAttr = (ns && idx != null && o.ok !== false && o.ms == null)
      ? ' onclick="' + ns + 'PingOne(' + idx + ')"' : '';
    return '<div class="node-card"' + (o.tip ? ' title="' + escHtml(o.tip) + '"' : '') + (o.dataAddr ? ' data-addr="' + escHtml(o.dataAddr) + '"' : '') + '>' +
      (c ? '<img class="node-flag-img" src="https://flagcdn.com/w40/' + (c === 'uk' ? 'gb' : c) + '.png" width="36" height="24" alt="' + escHtml(o.region) + '" loading="lazy">' : '') +
      '<div class="node-info">' +
        '<div class="node-ip">' + escHtml(o.addr) + '</div>' +
        '<div class="node-meta">' +
          (o.region ? '<span class="meta-chip">' + PIN_SVG + '<span>' + escHtml(o.region) + '</span></span>' : '') +
          '<span class="meta-stack ' + (o.ipv6 ? 'ipv6' : 'ipv4') + '">' + (o.ipv6 ? 'IPv6' : 'IPv4') + '</span>' +
        '</div>' +
      '</div>' +
      (o.ok === false
        ? '<button class="node-test fail"><span class="ms-text">超时</span></button>'
        : o.ms != null
          ? '<button class="node-test ' + (o.ms < 150 ? 'ok' : o.ms < 300 ? 'mid' : 'warn') + '"><span class="ms-text">' + o.ms + 'ms</span></button>'
          : '<button class="node-test" title="测速"' + pingAttr + '>' + BOLT_SVG + '</button>') +
      '</div>';
  }

  // ============ 在线优选（真实测速：优选走 /cdn-cgi/trace 三连打点，反代走 check API 探测） ============
  // 探测/解析核心在 LiteCore（js/admin.js），本节只做卡片渲染、分页与交互
  var ST_TITLES = { speed: '优选端点' };
  var ST_DATA = stStoreRead();   // 测速结果本地持久化：刷新不丢，可随时重测再生

  // 每页条数：按容器宽度实算每行列数 × 行数 = 每页卡片数（默认 2 行，可选 4/6 行，与节点列表同参）
  var ST_ROWS = [2, 4, 6];
  var ST_STATE = { tab: 'speed', page: { speed: 1 }, rows: 2 };
  function stCols() {
    // 度量当前可见网格；折叠时两网格均隐藏，回退到所在卡片的宽度
    var g = document.getElementById('st-' + ST_STATE.tab);
    var w = 0;
    if (g && g.clientWidth > 0) {
      w = g.clientWidth - 36;                        // 减去 .node-grid 左右 padding 18×2
    } else if (g) {
      var card = g.closest('.card');
      w = (card ? card.clientWidth : 600) - 36;
    }
    return Math.max(1, Math.floor((w + 14) / (300 + 14)));  // 与 minmax(300px)/gap:14 同参
  }
  function fillSpeedTest() {
    if (document.getElementById('st-speed') && document.getElementById('st-speed').childElementCount) return;
    stRender();
  }
  // 统一渲染：两个列表（优选/反代）走同一套切片+分页逻辑，分页栏跟随当前 tab
  function stRender() {
    var size = Math.max(1, stCols() * ST_STATE.rows);   // 每页 = 每行列数 × 行数
    ['speed'].forEach(function (t) {
      var grid = document.getElementById('st-' + t);
      if (!grid) return;
      var items = ST_DATA[t];
      var totalPages = Math.max(1, Math.ceil(items.length / size));
      var p = Math.min(ST_STATE.page[t], totalPages);
      ST_STATE.page[t] = p;
      grid.innerHTML = items.length
        ? items.slice((p - 1) * size, p * size).map(function (o) {
            // data-addr 始终用原始地址（测速打点/详情定位）；展示地址补端口、未测卡提示可点详情
            return nodeCardHtml(Object.assign({}, o, { dataAddr: o.addr, addr: stDisplayAddr(o), tip: o.tip || '点击查看详情' }));
          }).join('')
        : '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted,#94a3b8);padding:30px 0;font-size:.85rem">暂无数据 · 填入数据来源后点击「开始测速」</div>';
    });
    var c = document.getElementById('stCount');
    if (c) c.textContent = ST_DATA[ST_STATE.tab].length;
    var tt = document.getElementById('stTitleTxt');
    if (tt) tt.textContent = ST_TITLES[ST_STATE.tab];
    var row = document.getElementById('stPagerRow');
    if (!row) return;
    var tab = ST_STATE.tab;
    var totalPages = Math.max(1, Math.ceil(ST_DATA[tab].length / size));
    var p = ST_STATE.page[tab];
    // 数据不超过两行卡片时分页栏整体隐藏（单屏放得下，无需翻页/跳转/条数控件）
    if (!stHasMultiRowData()) {
      row.innerHTML = '';
      var footEl = document.getElementById('stPager');
      if (footEl) footEl.style.display = 'none';
      return;
    }
    var footShow = document.getElementById('stPager');
    if (footShow) footShow.style.display = '';
    var chevL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    var chevR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    var html = '<button type="button" title="上一页"' + (p <= 1 ? ' disabled' : ' onclick="window.__stGo(' + (p - 1) + ')"') + '>' + chevL + '</button>';
    pagerPages(p, totalPages).forEach(function (pg) {
      html += pg === '...'
        ? '<span class="page-ellipsis">…</span>'
        : '<button type="button"' + (pg === p ? ' class="active"' : ' onclick="window.__stGo(' + pg + ')"') + '>' + pg + '</button>';
    });
    html += '<button type="button" title="下一页"' + (p >= totalPages ? ' disabled' : ' onclick="window.__stGo(' + (p + 1) + ')"') + '>' + chevR + '</button>';
    html += '<span class="jump-box"><span class="jump-label">跳转</span><input id="stJump" type="number" min="1" max="' + totalPages + '" placeholder="页码" value="' + p + '"><span class="jump-label">页</span></span>';
    // 每页行数下拉（复用 ms-panel 样式；选项显示按当前宽度实算的每页条数 = 行数 × 每行列数）
    html += '<div class="ms" id="ms-stsize" style="min-width:96px">' +
      '<button type="button" class="ms-trigger ui-field" style="height:34px;" onclick="window.__stSizeToggle(event)">' +
      '<span class="ms-value">' + size + ' 条/页</span>' +
      '<svg class="ms-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="ms-panel"><div class="ms-list">' +
      ST_ROWS.map(function (r) {
        var n = Math.max(1, stCols() * r);
        return '<div class="ms-opt single' + (r === ST_STATE.rows ? ' active' : '') + '" onclick="window.__stRows(' + r + ')"><span>' + n + ' 条/页</span></div>';
      }).join('') +
      '</div></div></div>';
    row.innerHTML = html;
    var inp = document.getElementById('stJump');
    if (inp) inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var v = parseInt(inp.value, 10); if (v >= 1 && v <= totalPages && v !== p) window.__stGo(v); }
    });
  }
  window.__stGo = function (p) {
    ST_STATE.page[ST_STATE.tab] = p;
    stRender();
    var size = Math.max(1, stCols() * ST_STATE.rows);
    var items = ST_DATA[ST_STATE.tab];
    var slice = items.slice((p - 1) * size, p * size);
    var list = slice.filter(function (o) { return o.ok !== false && o.ms == null; });
    if (!list.length) return;
    var tab = ST_STATE.tab;
    var cfg = stCfgRead();
    stRunning = true;
    stRunPool(list, cfg.threads, async function (o) {
      await stTestNode(o, cfg.port);
      o.time = stTimeHM(new Date());
      o.tip = stTipOf(o, tab);
      stPatchCard(o, tab);
    }, function (done, total) {
      var cEl = document.getElementById('stCount');
      if (cEl) cEl.textContent = done + '/' + total;
    }).then(function () {
      stStoreWrite(ST_DATA);
      stRunning = false;
      stRender();
    });
  };
  window.__stSizeToggle = function (e) {
    e.stopPropagation();
    var ms = document.getElementById('ms-stsize');
    if (ms) ms.classList.toggle('open');
  };
  window.__stRows = function (r) {
    ST_STATE.rows = r;
    ST_STATE.page.speed = 1;
    stRender();
  };
  // 数据来源模式切换（自定义 / 网段优选）：各模式内容分缓存，误切模式不丢已填内容
  var ST_SRC_CACHE = {};
  var stSrcMode = null;
  window.__stMode = function (v) {
    var ta = document.getElementById('stSourceEditor');
    if (!ta) return;
    var curTab = ST_STATE.tab;
    if (stSrcMode !== null) ST_SRC_CACHE[curTab + ':' + stSrcMode] = ta.value;
    stSrcMode = v;
    var key = curTab + ':' + v;
    var cached = ST_SRC_CACHE[key];
    if (cached != null && cached !== '') ta.value = cached;
    else if (v === 'SUBNET') {
      ta.value = '162.159.*.0/24 # 192,197,198,199,239 # MASQUE-TCP';
    } else ta.value = '';
    if (v === 'SUBNET') {
      ta.placeholder = '每行一个网段表达式：a.b.*.0/24 # 第三段范围 # 备注（ 范围与备注可省略 ）';
    } else ta.placeholder = '每行一个 IP/域名，或填入直链 URL';
    __stSyncSubnetWrap();
  };
  // 折叠/展开数据来源编辑器
  window.__stEditorToggle = function () {
    var w = document.getElementById('stEditorWrap');
    if (w) w.style.display = w.style.display === 'none' ? '' : 'none';
  };
  // 测速设置弹窗：打开（读取本地设置回填）/ 关闭 / 保存（读写走 LiteCore.stCfg*）
  function __stSyncSubnetWrap() {
    var modeEl = document.getElementById('stSourceMode');
    var wrap = document.getElementById('stCfgSubnetWrap');
    if (wrap) wrap.style.display = (modeEl && modeEl.value === 'SUBNET') ? 'block' : 'none';
  }
  window.__stCfgOpen = function () {
    var m = document.getElementById('stCfgModal');
    if (!m) return;
    var c = stCfgRead();
    document.getElementById('stCfgPort').value = c.port;
    document.getElementById('stCfgThreads').value = c.threads;
    document.getElementById('stCfgRandom').value = c.random;
    document.getElementById('stCfgMax').value = c.max;
    document.getElementById('stCfgSave').value = c.save;
    __stSyncSubnetWrap();
    m.classList.add('show');
  };
  window.__stCfgClose = function () {
    var m = document.getElementById('stCfgModal');
    if (m) m.classList.remove('show');
  };
  window.__stCfgSave = function () {
    var cfg = {
      port: document.getElementById('stCfgPort').value,
      threads: Math.max(1, parseInt(document.getElementById('stCfgThreads').value, 10) || 5),
      random: Math.max(1, parseInt(document.getElementById('stCfgRandom').value, 10) || 3),
      max: Math.max(1, parseInt(document.getElementById('stCfgMax').value, 10) || 20),
      save: Math.max(1, parseInt(document.getElementById('stCfgSave').value, 10) || 10)
    };
    Core.stCfgWrite(cfg);
    showToast('测速设置已保存');
    __stCfgClose();
  };
  // 测速中逐卡实时打点（dataset 比对定位，不拼 CSS 选择器防注入）
  function stPatchCard(o, tab) {
    document.querySelectorAll('#st-' + tab + ' .node-card[data-addr]').forEach(function (card) {
      if (card.getAttribute('data-addr') !== o.addr) return;
      card.title = stTipOf(o, tab);
      var ipEl = card.querySelector('.node-ip');
      if (ipEl) ipEl.textContent = stDisplayAddr(o);   // 测出实际端口后同步展示地址
      var btn = card.querySelector('.node-test');
      if (!btn) return;
      if (o.ok === false) {
        btn.className = 'node-test fail';
        btn.innerHTML = '<span class="ms-text">超时</span>';
      } else {
        var cls = o.ms < 150 ? 'ok' : o.ms < 300 ? 'mid' : 'warn';
        btn.className = 'node-test ' + cls;
        btn.innerHTML = '<span class="ms-text">' + o.ms + 'ms</span>';
      }
    });
  }

  // ---------- 节点详情弹窗（数据取本地测速结果/节点列表项，不发额外探测；在线优选与节点列表共用） ----------
  var stDetailAddr = '';
  function stRowsHtml(rows) {
    return rows.map(function (r) {
      return '<div class="st-check-row"><span class="st-check-k">' + escHtml(r[0]) + '</span><span class="st-check-v">' + escHtml(r[1]) + '</span></div>';
    }).join('');
  }
  // 共享渲染：在线优选（ST_DATA）都喂这个函数
  function openNodeDetail(o, tab, addr) {
    stDetailAddr = addr;
    var sp = stSplitAddr(addr);
    // 不展示延迟/测速时间等测速过程字段——卡片上的胶囊已是权威结果，弹窗只看节点属性
    var rows = [
      ['IP 地址', sp.ip],
      ['端口', o.testPort || sp.port],
      ['网络栈', o.ipv6 ? 'IPv6' : 'IPv4'],
      ['类型', stKindLabel(o, tab)],
    ];
    if (o.colo) rows.push(['CF 机房', o.colo]);
    if (o.cfCidr) rows.push(['CF 网段', o.cfCidr]);
    if (o.region) rows.push(['注册地', String(o.region).toUpperCase()]);   // 第三方 IP 情报返回的是注册归属，非落地机房
    if (o.city) rows.push(['城市', o.city]);
    if (o.org) rows.push(['运营组织', o.org]);
    if (o.asn) rows.push(['ASN', o.asn]);
    if (o.vantage) rows.push(['探测机房', o.vantage]);
    if (o.remotePort) rows.push(['远端端口', o.remotePort]);
    if (o.name) rows.push(['备注', o.name]);
    document.getElementById('stCheckBody').innerHTML = stRowsHtml(rows);
    document.getElementById('stCheckModal').classList.add('show');
  }
  window.__stDetailOpen = function (addr) {
    var o = null;
    (ST_DATA[ST_STATE.tab] || []).forEach(function (it) { if (it.addr === addr) o = it; });
    if (o) openNodeDetail(o, ST_STATE.tab, addr);
  };
  window.__stDetailClose = function () {
    var m = document.getElementById('stCheckModal');
    if (m) m.classList.remove('show');
  };
  window.__stDetailCopy = function () {
    if (!stDetailAddr) { showToast('暂无可复制节点', true); return; }
    copyText(stDetailAddr, '已复制当前节点');
  };
  // 卡片点击 → 详情；测速按钮单独放行不触发（与 Senflare Proxy 的 bindDetailDelegate 同款委托）
  ['speed'].forEach(function (t) {
    var g = document.getElementById('st-' + t);
    if (!g || g.dataset.detailBound) return;
    g.dataset.detailBound = '1';
    g.addEventListener('click', function (e) {
      if (e.target.closest('.node-test')) return;
      var card = e.target.closest('.node-card[data-addr]');
      if (card) window.__stDetailOpen(card.getAttribute('data-addr'));
    });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') window.__stDetailClose(); });

  // ---------- 结果应用：前 N 个有效地址写进「节点配置」在线优选文本域并切到 LOCAL 模式 ----------
  // 统一经 parse 后重组 host:port —— 主后端直接 `${addr}:${port}` 会对自带端口的地址拼出双端口
  // 只写 IP 数据，不切模式：模式（LOCAL 等）由用户在「节点配置」自行选择
  function stApplyToConfig(tab, validList, saveN) {
    var ta = document.querySelector('[data-cfg="LocalIP"]');
    if (!ta) return;
    var lines = [];
    for (var i = 0; i < validList.length && lines.length < saveN; i++) {
      var p = stParseAddr(validList[i].addr);
      if (!p) continue;
      // 端口仅展示用，不写入配置：订阅生成用账号/端口模式决定端口，这里只落 IP 地址
      lines.push(p.type === 'ipv6' ? p.host : p.host);
    }
    if (!lines.length) return;
    ta.value = lines.join('\n');
    cfgDraftSave(ta);
    // 同步服务端：写端点候选 LocalIP（MASQUE 订阅生成取用）
    if (!window.LiteAPI) return;
    var payload = { LocalIP: lines.join('\n') };
    LiteAPI.saveConfig(payload).then(function (r) {
      if (r) {
        // 已落库的键从本地草稿中对账移除，否则未保存守卫会把这次应用误判为待保存修改
        var d = cfgDraftRead();
        delete d[ta.dataset.cfg];
        Core.cfgDraftWrite(d);
        CFG_SERVER = null;
        showToast('已同步到服务器配置（D1）');
      }
      else showToast('服务器同步失败', true);
    });
  }

  // ---------- 复制 / 下载当前页 ----------
  function stCurPageItems() {
    var size = Math.max(1, stCols() * ST_STATE.rows);
    var tab = ST_STATE.tab;
    var totalPages = Math.max(1, Math.ceil(ST_DATA[tab].length / size));
    var p = Math.min(ST_STATE.page[tab], totalPages);
    return ST_DATA[tab].slice((p - 1) * size, p * size);
  }
  window.__stCopyPage = function () {
    var items = stCurPageItems();
    if (!items.length) { showToast('当前页没有数据', true); return; }
    copyText(items.map(function (o) { return o.addr; }).join('\n'), '已复制当前页 ' + items.length + ' 个');
  };
  window.__stDownloadPage = function () {
    var items = stCurPageItems();
    if (!items.length) { showToast('当前页没有数据', true); return; }
    downloadText('senflare-warp-' + ST_STATE.tab + '-page' + ST_STATE.page[ST_STATE.tab] + '.txt',
      items.map(function (o) { return o.addr; }).join('\n'), '已下载当前页 ' + items.length + ' 个');
  };

  // ---------- 复制 / 下载当前页 ----------
  function stCurPageItems() {
    var size = Math.max(1, stCols() * ST_STATE.rows);
    var tab = ST_STATE.tab;
    var totalPages = Math.max(1, Math.ceil(ST_DATA[tab].length / size));
    var p = Math.min(ST_STATE.page[tab], totalPages);
    return ST_DATA[tab].slice((p - 1) * size, p * size);
  }
  window.__stCopyPage = function () {
    var items = stCurPageItems();
    if (!items.length) { showToast('当前页没有数据', true); return; }
    copyText(items.map(function (o) { return o.addr; }).join('\n'), '已复制当前页 ' + items.length + ' 个');
  };
  window.__stDownloadPage = function () {
    var items = stCurPageItems();
    if (!items.length) { showToast('当前页没有数据', true); return; }
    downloadText('senflare-warp-' + ST_STATE.tab + '-page' + ST_STATE.page[ST_STATE.tab] + '.txt',
      items.map(function (o) { return o.addr; }).join('\n'), '已下载当前页 ' + items.length + ' 个');
  };

  // ---------- 开始测速主流程：解析来源 → 并发探测 → 实时打点 → 排序持久化 → 应用到配置 ----------
  var stRunning = false;
  window.__stTest = async function () {
    if (stRunning) return;
    var btn = document.getElementById('stTestBtn');
    var ta = document.getElementById('stSourceEditor');
    var modeEl = document.getElementById('stSourceMode');
    if (!btn || !ta || !modeEl) return;
    var content = ta.value.trim();
    if (!content) { showToast('请先填入数据来源', true); return; }
    var cfg = stCfgRead();
    var tab = ST_STATE.tab;
    stRunning = true;
    btn.disabled = true;
    btn.textContent = '解析来源...';
    var list = await stBuildList(modeEl.value, content, cfg.random, cfg.max);
    if (!list.length) {
      showToast('未找到有效的 IP', true);
      btn.textContent = '开始测速';
      btn.disabled = false;
      stRunning = false;
      return;
    }
    ST_DATA[tab] = list;
    ST_STATE.page[tab] = 1;
    stRender();
    showToast('开始测速 ' + list.length + ' 个优选端点...');
    var timeStr = stTimeHM(new Date());
    await stRunPool(list, cfg.threads, async function (o) {
      await stTestNode(o, cfg.port);
      o.time = timeStr;
      o.tip = stTipOf(o, tab);
      stPatchCard(o, tab);
    }, function (done, total) {
      btn.textContent = '测速中 ' + done + '/' + total;
    });
    // 全部完成后并发补 CF 网段归属
    await Promise.all(list.filter(function (o) { return o.cf && o.cfCidr; }).map(function (o) { return nlAttachInfo(o); }));
    Core.regionCacheClear();   // 整体测速结束：清空机房地区缓存，防 localStorage 长期膨胀（同批内已靠缓存去重）
    // 排序：可用在前按延时升序，超时沉底（两者相等或同为超时保持原序）
    list.sort(function (a, b) {
      var av = a.ok ? a.ms : Infinity;
      var bv = b.ok ? b.ms : Infinity;
      if (av === bv) return 0;
      return av - bv;
    });
    ST_DATA[tab] = list;
    ST_STATE.page[tab] = 1;
    stStoreWrite(ST_DATA);
    stRender();
    btn.textContent = '开始测速';
    btn.disabled = false;
    stRunning = false;
    var valid = list.filter(function (o) { return o.ok; });
    if (!valid.length) { showToast('测速完成，未发现可用地址', true); return; }
    stApplyToConfig(valid, cfg.save);
    showToast('✅ 可用 ' + valid.length + '/' + list.length + '，最快 ' + valid[0].addr + ' (' + valid[0].ms + 'ms)，已写入「节点配置」端点候选');
  };
  // 数据来源下拉：宽度自适应当前选中项（.form-control 默认 width:100%，原生 auto 只按最宽选项）
  var __stFitSelect = function () {
    var sel = document.getElementById('stSourceMode');
    if (!sel) return;
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;';
    probe.style.font = getComputedStyle(sel).font;
    probe.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
    document.body.appendChild(probe);
    sel.style.width = (probe.offsetWidth + 34) + 'px';   // 余量：内边距 + 原生箭头
    probe.remove();
  };
  (function () {
    var s = document.getElementById('stSourceMode');
    if (!s) return;
    __stFitSelect();
    s.addEventListener('change', __stFitSelect);
  })();
  // 视口宽度变化 → 每行列数变化 → 重算每页条数并重渲染（仅在在线优选可见时）
  var stResizeT;
  window.addEventListener('resize', function () {
    clearTimeout(stResizeT);
    stResizeT = setTimeout(function () {
      var v = document.querySelector('.nodes-subview[data-sub="speedtest"]');
      if (v && v.style.display !== 'none') stRender();
    }, 150);
  });
  function switchSpeedTab(name) {
    // 单 tab（优选端点）：保留数据来源编辑器内容
    if (ST_STATE.tab !== name && stSrcMode !== null) {
      var ta0 = document.getElementById('stSourceEditor');
      if (ta0) ST_SRC_CACHE[ST_STATE.tab + ':' + stSrcMode] = ta0.value;
    }
    ST_STATE.tab = name;
    document.querySelectorAll('.src-btn[data-st]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-st') === name);
    });
    // 同步编辑框到当前模式的缓存/默认值
    if (stSrcMode !== null) {
      var ta1 = document.getElementById('stSourceEditor');
      if (ta1) {
        var k = name + ':' + stSrcMode;
        var cached = ST_SRC_CACHE[k];
        if (cached != null && cached !== '') ta1.value = cached;
        else if (stSrcMode === 'SUBNET') {
          ta1.value = '162.159.*.0/24 # 192,197,198,199,239 # MASQUE-TCP';
          ta1.placeholder = '每行一个网段表达式：a.b.*.0/24 # 第三段范围 # 备注（ 范围与备注可省略 ）';
        }
      }
    }
    stRender();       // 当前 tab 走同一套分页渲染
    stApplyView();    // 可见性统一由状态驱动（tab + 折叠）
  }
  // 可见性唯一入口：分页是否隐藏由数据量决定（超两行卡片才显示分页栏）
  function stHasMultiRowData() {
    return ST_DATA[ST_STATE.tab].length > stCols() * 2;
  }
  function stApplyView() {
    var foldedEl = document.getElementById('stFoldBtn');
    var folded = !!(foldedEl && foldedEl.dataset.folded === '1');
    var g = document.getElementById('st-' + ST_STATE.tab);
    if (g) g.style.display = folded ? 'none' : 'grid';
    var pager = document.getElementById('stPager');
    if (pager) pager.parentElement.style.display = (folded || !stHasMultiRowData()) ? 'none' : '';
  }
  // 折叠/展开结果列表（与节点列表折叠按钮同语义：目标态驱动，展开态显示向上箭头）
  function toggleStFold(btn) {
    if (!btn) return;
    var folded = btn.dataset.folded !== '1';      // 目标态：当前未折叠 → 即将折叠
    btn.dataset.folded = folded ? '1' : '';
    btn.innerHTML = folded ? FOLD_CHEVRON.down : FOLD_CHEVRON.up;
    stApplyView();
  }

  // ============ 账号列表（真实数据：/api/warpaccounts CRUD —— WARP MASQUE 注册账号） ============
  var WAR_ACCOUNTS = [], WAR_NO_D1 = false;
  var WAR_LOADED = false, WAR_LOADING = false;
  function warpById(id) { return WAR_ACCOUNTS.find(function (a) { return a.id === id; }) || null; }
  var WAR_ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
  var WAR_ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  var WAR_ICON_JSON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  async function ensureWarpLoaded(force) {
    if (!window.LiteAPI || WAR_LOADING) return;
    if (WAR_LOADED && !force) return;
    WAR_LOADING = true;
    var d = await LiteAPI.warpGet();
    WAR_LOADING = false;
    if (!d) {
      WAR_ACCOUNTS = [];
      WAR_NO_D1 = false;
      WAR_LOADED = true;
      warpRender();
      return;
    }
    WAR_ACCOUNTS = d.accounts || [];
    WAR_NO_D1 = !!d.noD1;   // 仅当后端真实响应且声明未绑定 D1 时才提示
    WAR_LOADED = true;
    warpRender();
  }
  async function warpPersistAll() {
    if (!window.LiteAPI) return false;
    var r = await LiteAPI.warpPost({ accounts: WAR_ACCOUNTS });
    if (r && r.success) { showToast('已保存到 D1'); warpRender(); return true; }
    return false;
  }
// 添加账号：弹出「导入账号 / 一键注册」选择，合并两个入口
  window.__warpAddOpen = function () {
    if (WAR_NO_D1) { showToast('未绑定 D1 数据库，无法保存账号', true); return; }
    if (typeof window.__showConfirm === 'function') {
      window.__showConfirm('请选择账号添加方式', async function () {
        // 「一键注册」
        await window.__warpRegister();
      }, '添加账号', {
        okText: '一键注册',
        cancelText: '导入账号',
        onDiscard: function () { window.__warpImportOpen(); },
      });
      return;
    }
    // 无确认弹窗兜底：直接走一键注册
    window.__warpRegister();
  };
  // 一键注册：后端 POST /api/warpaccounts {action:'register'} 调注册 Worker，成功后刷新列表
  window.__warpRegister = async function () {
    if (!window.LiteAPI) { showToast('预览模式无法注册', true); return; }
    if (WAR_NO_D1) { showToast('未绑定 D1 数据库，无法保存账号', true); return; }
    var btn = document.querySelector('[onclick="__warpAddOpen()"]');
    if (btn) { btn.disabled = true; btn.textContent = '注册中…'; }
    try {
      var r = await LiteAPI.warpPost({ action: 'register' });
      if (!r) return;
      showToast(r.success ? ('注册成功：' + (r.account.name || r.account.id || '新账号')) : '注册失败：' + (r.error || '未知错误'), !r.success);
      if (r.success) await ensureWarpLoaded(true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '添加账号'; }
    }
  };
  // 导入账号：file input 解析 Usque JSON（单文件），校验字段后写库
  window.__warpImportOpen = function () {
    var f = document.getElementById('warpImportFile');
    if (f) f.click();
  };
  window.__warpImportChange = async function (inp) {
    if (!inp || !inp.files || !inp.files[0]) return;
    if (WAR_NO_D1) { showToast('未绑定 D1 数据库，无法保存账号', true); return; }
    var file = inp.files[0];
    try {
      var c = JSON.parse(await file.text());
    } catch (e) {
      showToast('JSON 解析失败：' + e.message, true);
      inp.value = '';
      return;
    }
    // 兼容 usque-worker 的大小写字段（注册输出即 PascalCase，兼容旧 snake_case 导入）
    var pk = c.PrivateKey || c.private_key || '';
    var ep = c.EndpointPubKey || c.endpoint_pub_key || '';
    var v4 = c.EndpointV4 || c.endpoint_v4 || '';
    var v6 = c.EndpointV6 || c.endpoint_v6 || '';
    var port = (c.EndpointPort != null ? c.EndpointPort : c.endpoint_port) || '';
    var backup = c.BackupPorts || c.backup_ports || [];
    var cid = c.ID || c.id || ('warp-' + Date.now());
    if (!pk || !ep || !v4) {
      showToast('缺少必要字段：PrivateKey / EndpointPubKey / EndpointV4', true);
      inp.value = '';
      return;
    }
    var obj = {
      id: String(cid),
      name: 'WARP-MASQUE',
      privateKey: String(pk),
      endpointPubKey: String(ep),
      endpointV4: String(v4),
      endpointV6: String(v6),
      endpointPort: String(port || '443'),
      backupPorts: JSON.stringify(Array.isArray(backup) ? backup : [backup].filter(Boolean)),
      createdAt: new Date().toISOString().slice(0, 10),
      status: 'normal',
    };
    // License / Token：JSON 里有才带上（旧文件无此字段时不覆盖已有值）
    var lic = c.License || c.license || '';
    var tok = c.Token || c.token || '';
    if (lic) obj.license = String(lic);
    if (tok) obj.token = String(tok);
    // id 冲突则覆盖
    var existing = warpById(obj.id);
    if (existing) { Object.assign(existing, obj); await warpPersistAll(); }
    else { WAR_ACCOUNTS.push(obj); await warpPersistAll(); }
    await ensureWarpLoaded(true);
    showToast('已导入账号 ' + (obj.name || obj.id));
    inp.value = '';
  };

  window.__warpEdit = function (id) {
    var a = warpById(id);
    if (!a) return;
    warpModal('编辑账号', a, function (obj) { Object.assign(a, obj); warpPersistAll(); });
  };
  window.__warpDel = async function (id) {
    if (!confirm('确定删除该 WARP 账号？删除后订阅节点将同步减少。')) return;
    var r = await LiteAPI.warpPost({ action: 'delete', id: id });
    if (r && r.success) { showToast('账号已删除'); await ensureWarpLoaded(true); }
  };
  window.__warpDownloadJson = function (id) {
    var a = warpById(id);
    if (!a) return;
    var backup = [];
    try { backup = JSON.parse(a.backupPorts || '[]'); } catch (e) { }
    var o = {
      PrivateKey: a.privateKey,
      EndpointV4: a.endpointV4,
      EndpointV6: a.endpointV6,
      EndpointPort: a.endpointPort ? Number(a.endpointPort) : 443,
      BackupPorts: backup,
      EndpointPubKey: a.endpointPubKey,
      ID: a.id,
      License: a.license || '',
      Token: a.token || '',
    };
    downloadText((a.name || a.id) + '.json', JSON.stringify(o, null, 2), '已下载账号 JSON', 'application/json;charset=utf-8');
  };
  // 账号新增/编辑弹窗（动态构建，样式复用主题弹窗 .modal）
  function warpModal(title, acc, onOk) {
    var old = document.getElementById('warpAccModal');
    if (old) old.remove();
    var isEdit = !!acc;
    var modal = document.createElement('div');
    modal.className = 'modal show';
    modal.id = 'warpAccModal';
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
    var field = function (id, label, type, val, ph, ro) {
      return '<div class="form-group"><label>' + label + (ro ? '（只读）' : '') + '</label>' +
        '<input type="' + (type || 'text') + '" class="form-control" id="' + id + '" value="' + escHtml(val == null ? '' : val) + '" placeholder="' + escHtml(ph || '') + '"' + (ro ? ' readonly onclick="this.select()" style="opacity:.75;cursor:text"' : '') + '></div>';
    };
    var roField = function (label, val) {
      if (!val) return '';
      return '<div class="form-group"><label>' + label + '（只读）</label>' +
        '<input type="text" class="form-control" readonly value="' + escHtml(val) + '" onclick="this.select()" style="opacity:.75;cursor:text"></div>';
    };
    modal.innerHTML = '<div class="modal-content" style="max-width:560px" onclick="event.stopPropagation()">' +
      '<div class="modal-header"><h3>' + title + '</h3><button class="modal-close" onclick="document.getElementById(\'warpAccModal\').remove()">×</button></div>' +
      '<div class="modal-body">' +
        field('waName', '名称', 'text', acc && acc.name, 'WARP-MASQUE') +
        roField('License', acc && acc.license) +
        field('waPub', '公钥', 'text', acc && acc.endpointPubKey, 'MFkwEwYH...', isEdit) +
        field('waPrivate', '私钥', 'text', acc && acc.privateKey, 'MHcCAQEEI...', isEdit) +
        field('waV4', 'IPv4', 'text', acc && acc.endpointV4, '162.159.198.2') +
        field('waV6', 'IPv6', 'text', acc && acc.endpointV6, '2606:4700:103::2') +
        field('waPort', '常用端口', 'text', acc && acc.endpointPort, '443') +
        field('waBackup', '备用端口', 'text', acc && acc.backupPorts, '[500,4500,8095]') +
        roField('Token', acc && acc.token) +
      '</div>' +
      '<div class="modal-footer"><button class="btn btn-outline" onclick="document.getElementById(\'warpAccModal\').remove()">取消</button>' +
      '<button class="btn btn-primary" id="warpAccOk">' + (isEdit ? '保存' : '添加') + '</button></div></div>';
    document.body.appendChild(modal);
    document.getElementById('warpAccOk').onclick = function () {
      var v = function (id) { return String(document.getElementById(id).value || '').trim(); };
      // 备用端口：接受 JSON 数组或逗号分隔文本
      var rawBackup = v('waBackup');
      var backup = [];
      try { backup = JSON.parse(rawBackup || '[]'); } catch (e) {
        backup = String(rawBackup).split(/[,，\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      }
      if (!Array.isArray(backup)) backup = [];
      onOk({
        name: v('waName') || 'WARP-MASQUE',
        endpointPubKey: v('waPub'),
        privateKey: v('waPrivate'),
        endpointV4: v('waV4'),
        endpointV6: v('waV6'),
        endpointPort: v('waPort') || '443',
        backupPorts: JSON.stringify(backup)
      });
      modal.remove();
    };
  }
  // 渲染账号卡片
  function warpRender() {
    var grid = document.getElementById('cfAccountsGrid');
    if (!grid) return;
    if (WAR_NO_D1) {
      // 仅后端真实声明未绑定 D1 时走到这里
      grid.innerHTML = '<div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;padding:56px 20px;color:var(--text-muted,#94a3b8);font-size:.88rem">未绑定 D1 数据库，WARP 账号管理不可用</div>';
      var bar = document.getElementById('cfActionBar');
      if (bar) bar.style.display = 'none';
      return;
    }
    if (!WAR_ACCOUNTS.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:56px 20px;text-align:center;color:var(--text-muted,#94a3b8)">' +
        '<div style="font-size:.92rem;font-weight:600">暂无 WARP 账号</div>' +
        '<div style="font-size:.78rem">点击下方「添加账号」登记注册生成的 MASQUE 账号，订阅节点将按端点生成</div>' +
        '</div>';
      updateCFSelected();
      return;
    }
    grid.innerHTML = WAR_ACCOUNTS.map(function (a) {
      var added = a.createdAt ? String(a.createdAt).slice(0, 10) : '';
      var aid = escHtml(a.id);
      var epV4 = a.endpointV4 || '—';
      var epV6 = a.endpointV6 || '';
      var epPort = a.endpointPort || '443';
      // 备用端口池（DB 存 JSON 字符串，兼容旧数组）
      var backupPorts = [];
      try { backupPorts = JSON.parse(a.backupPorts || '[]'); } catch (e) { }
      if (!Array.isArray(backupPorts)) backupPorts = [];
      var backupTxt = backupPorts.length ? backupPorts.join(' / ') : '—';
      return '<div class="cf-account-card" data-id="' + aid + '">' +
        '<div class="cf-card-header">' +
          '<label class="checkbox-label no-text"><input type="checkbox" class="cf-card-checkbox" data-id="' + aid + '"><span class="checkmark"></span></label>' +
        '</div>' +
        '<div class="cf-card-info">' +
          '<div class="cf-card-account">' +
            '<div class="cf-card-title">' +
              '<div class="cf-card-avatar">W<span class="cf-status-dot"></span></div>' +
              '<div class="cf-card-name"><h4>' + escHtml(a.name) + '</h4><p>' + aid + '</p></div>' +
            '</div>' +
          '</div>' +
          '<div class="cf-card-stats" style="display:flex;gap:10px;flex-wrap:wrap">' +
            '<div class="cf-stat-card" style="display:flex;flex-direction:column;gap:6px">' +
              '<div class="cf-card-row"><span class="label">IPv4</span><span class="value">' + escHtml(epV4) + '</span></div>' +
              (epV6 ? '<div class="cf-card-row"><span class="label">IPv6</span><span class="value">' + escHtml(epV6) + '</span></div>' : '') +
            '</div>' +
            '<div class="cf-stat-card" style="display:flex;flex-direction:column;gap:6px">' +
              '<div class="cf-card-row"><span class="label">常用端口</span><span class="value">' + escHtml(epPort) + '</span></div>' +
              (backupTxt !== '—' ? '<div class="cf-card-row"><span class="label">备用端口</span><span class="value">' + escHtml(backupTxt) + '</span></div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="cf-card-footer">' +
            '<span class="cf-card-time">' + (added ? '添加于 ' + escHtml(added) : '注册时间 ' + escHtml(a.createdAt || '')) + '</span>' +
            '<div class="cf-card-actions">' +
              '<button title="下载 JSON" data-act="dl" data-id="' + aid + '">' + WAR_ICON_JSON + '</button>' +
              '<button title="编辑" data-act="edit" data-id="' + aid + '">' + WAR_ICON_EDIT + '</button>' +
              '<button class="danger" title="删除" data-act="del" data-id="' + aid + '">' + WAR_ICON_TRASH + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    updateCFSelected();
  }
  function updateCFSelected() {
    var n = document.querySelectorAll('.cf-card-checkbox:checked').length;
    var el = document.getElementById('cfSelectedCount');
    if (el) el.textContent = n;
  }
  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('cf-card-checkbox')) updateCFSelected();
  });
  // 卡片操作按钮走事件委托（data-act/data-id，防注入）
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.cf-card-actions button[data-act]') : null;
    if (!btn) return;
    var id = btn.dataset.id;
    if (btn.dataset.act === 'dl') window.__warpDownloadJson(id);
    else if (btn.dataset.act === 'edit') window.__warpEdit(id);
    else if (btn.dataset.act === 'del') window.__warpDel(id);
  });
  // 批量操作下拉（批量删除；点击空白处关闭）
  window.toggleCFBatchDropdown = function (e) {
    e.stopPropagation();
    var menu = document.getElementById('cfBatchDropdownMenu');
    if (menu) menu.classList.toggle('show');
  };
  window.batchCFDelete = async function () {
    closeCFMenu();
    if (!window.LiteAPI) return;
    if (WAR_NO_D1) { showToast('未绑定 D1 数据库，无法删除账号', true); return; }
    var ids = Array.prototype.map.call(document.querySelectorAll('.cf-card-checkbox:checked'), function (c) { return c.dataset.id; });
    if (!ids.length) { showToast('请先勾选要删除的账号', true); return; }
    if (!confirm('确定删除选中的 ' + ids.length + ' 个 WARP 账号？')) return;
    var okN = 0;
    for (var i = 0; i < ids.length; i++) {
      var rr = await LiteAPI.warpPost({ action: 'delete', id: ids[i] });
      if (rr && rr.success) okN++;
    }
    showToast(okN === ids.length ? '已删除 ' + okN + ' 个账号' : '仅删除 ' + okN + '/' + ids.length + ' 个', okN !== ids.length);
    await ensureWarpLoaded(true);
  };
  function closeCFMenu() {
    var menu = document.getElementById('cfBatchDropdownMenu');
    if (menu) menu.classList.remove('show');
  }
  document.addEventListener('click', closeCFMenu);

  // ============ 数据看板（WARP 账号总览 + 网络检测 + 订阅活动） ============
  var DASH_STATUS = null;
  if (window.LiteAPI) {
    LiteAPI.getStatus().then(function (s) {
      if (s) DASH_STATUS = s;
    }).catch(function () {});
  }
  // WARP 账号总览：账号总数（注册成功即有效，无状态区分）
  function renderWarpOverview() {
    var totalEl = document.getElementById('warpDashTotal');
    var okEl = document.getElementById('warpDashOk');
    var warnEl = document.getElementById('warpDashWarn');
    var errEl = document.getElementById('warpDashErr');
    if (!totalEl) return;
    if (!window.LiteAPI) {   // 纯静态预览：无数据
      totalEl.textContent = '0'; okEl.textContent = '0'; warnEl.textContent = '0'; errEl.textContent = '0';
      return;
    }
    LiteAPI.warpGet().then(function (d) {
      var list = (d && d.accounts) || [];
      totalEl.textContent = cfFmt(list.length);
      okEl.textContent = cfFmt(list.length);
      warnEl.textContent = '0';
      errEl.textContent = '0';
    });
  }
  // 订阅活动：今日下发/拒绝计数 + 最近订阅日志（时间线列表，无表头）
  // 管理员/访客统一走 /api/overview 聚合（SQL 全表统计，同一份代码出数，两边数据必然一致）；
  // 旧实现从 /api/logs?limit=50 的混合日志流里本地过滤——日志被登录爆破刷屏时订阅事件
  // 会被挤出 50 条窗口漏计，导致管理员视图与访客视图数据不一致
  function renderSubActivity() {
    var todayEl = document.getElementById('subDashToday');
    var rejectEl = document.getElementById('subDashReject');
    var list = document.getElementById('subDashList');
    if (!list) return;
    if (!window.LiteAPI) {   // 纯静态预览
      if (todayEl) todayEl.textContent = '0';
      if (rejectEl) rejectEl.textContent = '0';
      list.innerHTML = '';
      return;
    }
    LiteAPI.call('/api/overview').then(function (o) {
      if (!o) return;
      if (todayEl) todayEl.textContent = cfFmt(o.subToday || 0);
      if (rejectEl) rejectEl.textContent = cfFmt(o.subReject || 0);
      list.innerHTML = subActivityRows(Array.isArray(o.recent) ? o.recent : []);
    });
  }
  // ============ 网络检测（采样与 IP 情报在 LiteCore，本节只画卡片） ============
  // 国内/国外站点并发延迟测试（8 轮采样取均值）；点击卡片查询访问该站点的出口 IP 详情
  var LATENCY_TEST_COUNT = 8;      // 心电图窗口：同屏展示最近 N 次采样
  var NETCHECK_POLL_MS = 1000;     // 轮询间隔：1s 一采样
  var netCheckStarted = false;
  var netCheckInFlight = false;
  var latencySites = [
    { name: '字节跳动', region: '国内', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1677FF" d="m19.9 1.5 4.1 1v19l-4.1 1zM6.5 10.9l4.1 1v9l-4 1.1zM0 2.6l4.1 1v16.8l-4.1 1zm17.5 5.6v11.1l-4.2-1v-9z"></path></svg>', url: 'https://lf3-zlink-tos.ugurl.cn/obj/zebra-public/resource_lmmizj_1632398893.png' },
    { name: '抖音', region: '国内', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#000" d="M16.75 0C15.78 0 15 .78 15 1.75v12.5c0 2.07-1.68 3.75-3.75 3.75S7.5 16.32 7.5 14.25s1.68-3.75 3.75-3.75c.28 0 .56.03.83.09V8.08c-.28-.03-.55-.08-.83-.08C7.19 8 4 11.19 4 15.25S7.19 22.5 11.25 22.5s7.25-3.19 7.25-7.25V7.76c1.38.88 3.03 1.39 4.75 1.39V6.65c-2.07 0-3.75-1.68-3.75-3.75V1.75C19.5.78 18.72 0 17.75 0z"/></svg>', url: 'https://www.douyin.com/favicon.ico' },
    { name: 'Bilibili', region: '国内', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FB7299" d="M17.813 4.653h.854q2.266.08 3.773 1.574Q23.946 7.72 24 9.987v7.36q-.054 2.266-1.56 3.773c-1.506 1.507-2.262 1.524-3.773 1.56H5.333q-2.266-.054-3.773-1.56C.053 19.614.036 18.858 0 17.347v-7.36q.054-2.267 1.56-3.76t3.773-1.574h.774l-1.174-1.12a1.23 1.23 0 0 1-.373-.906q0-.534.373-.907l.027-.027q.4-.373.92-.373t.92.373L9.653 4.44q.107.106.187.213h4.267a.8.8 0 0 1 .16-.213l2.853-2.747q.4-.373.92-.373c.347 0 .662.151.929.4s.391.551.391.907q0 .532-.373.906zM5.333 7.24q-1.12.027-1.88.773q-.76.748-.786 1.894v7.52q.026 1.146.786 1.893t1.88.773h13.334q1.12-.026 1.88-.773t.786-1.893v-7.52q-.026-1.147-.786-1.894t-1.88-.773zM8 11.107q.56 0 .933.373q.375.374.4.96v1.173q-.025.586-.4.96q-.373.375-.933.374c-.56-.001-.684-.125-.933-.374q-.375-.373-.4-.96V12.44q0-.56.386-.947q.387-.386.947-.386m8 0q.56 0 .933.373q.375.374.4.96v1.173q-.025.586-.4.96q-.373.375-.933.374c-.56-.001-.684-.125-.933-.374q-.375-.373-.4-.96V12.44q.025-.586.4-.96q.373-.373.933-.373"></path></svg>', url: 'https://i0.hdslb.com/bfs/face/member/noface.jpg@24w_24h_1c' },
    { name: '微信', region: '国内', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#09B83E" d="M8.7 2.19C3.9 2.19 0 5.48 0 9.53c0 2.21 1.17 4.2 3 5.55a.6.6 0 0 1 .21.66l-.39 1.48q-.03.11-.04.22c0 .16.13.3.29.3a.3.3 0 0 0 .16-.06l1.9-1.11a.9.9 0 0 1 .72-.1 10 10 0 0 0 2.84.4q.41-.01.81-.05a5.85 5.85 0 0 1 1.93-6.45 8.3 8.3 0 0 1 5.86-1.83c-.58-3.59-4.2-6.35-8.6-6.35m-2.9 3.8c.64 0 1.16.53 1.16 1.18a1.17 1.17 0 0 1-1.16 1.18 1.17 1.17 0 0 1-1.17-1.18c0-.65.52-1.18 1.17-1.18m5.8 0c.65 0 1.17.53 1.17 1.18a1.17 1.17 0 0 1-1.16 1.18 1.17 1.17 0 0 1-1.16-1.18c0-.65.52-1.18 1.16-1.18m5.34 2.87a8 8 0 0 0-5.28 1.78 5.5 5.5 0 0 0-1.78 6.22c.94 2.46 3.66 4.23 6.88 4.23q1.25 0 2.36-.33a.7.7 0 0 1 .6.08l1.59.93.14.04c.13 0 .24-.1.24-.24q-.01-.09-.04-.18l-.33-1.23-.02-.16a.5.5 0 0 1 .2-.4 5.8 5.8 0 0 0 2.5-4.62c0-3.21-2.93-5.84-6.66-6.09zm-2.53 3.27c.53 0 .97.44.97.98a1 1 0 0 1-.97.99 1 1 0 0 1-.97-.99c0-.54.43-.98.97-.98zm4.84 0c.54 0 .97.44.97.98a1 1 0 0 1-.97.99 1 1 0 0 1-.97-.99c0-.54.44-.98.97-.98"></path></svg>', url: 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico' },
    { name: '谷歌', region: '国外', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53"/></svg>', url: 'https://www.google.com/favicon.ico' },
    { name: 'Cloudflare', region: '国外', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#F6821F"><circle cx="8.5" cy="13" r="4"/><circle cx="14.5" cy="11.5" r="5"/><rect x="8" y="11" width="11" height="6" rx="3"/></g></svg>', url: 'https://www.cloudflare.com/favicon.ico' },
    { name: 'ChatGPT', region: '国外', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#10A37F" d="M22.3 8.7c.4-1.8-.1-3.7-1.4-5.1-1.3-1.3-3.2-1.8-5-1.4-1.1-1.5-2.9-2.4-4.9-2.2-2 .1-3.7 1.3-4.6 3-1.8.4-3.3 1.6-4.1 3.3-.8 1.7-.7 3.6.2 5.2-.4 1.8.1 3.7 1.4 5.1 1.3 1.3 3.2 1.8 5 1.4 1.1 1.5 2.9 2.4 4.9 2.2 2-.1 3.7-1.3 4.6-3 1.8-.4 3.3-1.6 4.1-3.3.8-1.7.7-3.6-.2-5.2m-10.3 11c-1.2.1-2.3-.4-3-1.3l.2-.1 5-2.9c.3-.1.4-.4.4-.7V9.3l2.1 1.2v5.2c0 2.2-1.7 4-3.7 4.1M4.5 17.5c-.6-1-.8-2.3-.4-3.4l.2.1 5 2.9c.3.1.6.1.8 0l6.1-3.5v2.4l-5 2.9c-1.9 1.1-4.4.5-5.7-1.4M3.3 8c.6-1 1.6-1.8 2.8-2.1v5.9c0 .3.1.5.4.7l6.1 3.5-2.1 1.2-5-2.9C3.6 13.2 2.2 10.9 3.3 8m16.4 3.7-6.1-3.5 2.1-1.2 5 2.9c1.9 1.1 2.6 3.5 1.5 5.4-.6 1-1.6 1.8-2.8 2.1v-5.9c0-.3-.1-.5-.4-.7m2.1-3.2-.2-.1-5-2.9c-.3-.1-.6-.1-.8 0L9.7 9v-2.4l5-2.9c1.9-1.1 4.4-.5 5.7 1.4.6 1 .8 2.3.4 3.4M9.7 13.3 7.6 12V6.8c0-2.2 1.8-4 4-4 1.2-.1 2.3.4 3 1.3l-.2.1-5 2.9c-.3.1-.4.4-.4.7zm1.1-2.4 2.7-1.6 2.7 1.6v3.2l-2.7 1.6-2.7-1.6z"/></svg>', url: 'https://cdn.oaistatic.com/_next/static/media/apple-touch-icon.59f2e898.png' },
    { name: 'YouTube', region: '国外', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#FF0000" d="M23.5 6.19a3 3 0 0 0-2.12-2.14c-1.87-.5-9.38-.5-9.38-.5s-7.5 0-9.38.5A3 3 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3 3 0 0 0 2.12 2.14c1.87.5 9.38.5 9.38.5s7.5 0 9.38-.5a3 3 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81M9.55 15.57V8.43L15.82 12z"></path></svg>', url: 'https://www.youtube.com/favicon.ico' }
  ];
  var siteLatencies = {};

  function generateLatencyCards() {
    var container = document.getElementById('latency-cards');
    if (!container) return;
    container.innerHTML = '';
    var sorted = latencySites.slice().sort(function (a, b) { return (a.region === '国内' ? 0 : 1) - (b.region === '国内' ? 0 : 1); });
    sorted.forEach(function (site) {
      var key = site.name.toLowerCase().replace(/\s+/g, '-');
      siteLatencies[key] = [];
      var card = document.createElement('div');
      card.className = 'latency-card';
      card.style.cursor = 'pointer';
      card.addEventListener('click', function () { queryIpForSite(site); });
      card.innerHTML = '<div class="latency-card-title"><div class="latency-card-icon">' + site.icon + '</div><span class="latency-card-name">' + site.name + '</span><div class="latency-value" id="latency-' + key + '">测试中...</div><span class="latency-card-region latency-card-region-' + (site.region === '国内' ? 'domestic' : 'international') + '">' + site.region + '</span></div><div class="latency-card-content"><div class="latency-bars" id="bars-' + key + '">' + Array(LATENCY_TEST_COUNT).fill('<div class="latency-bar loading"></div>').join('') + '</div></div>';
      container.appendChild(card);
    });
  }

  function updateLatencyDisplay(key, latencies) {
    var valueEl = document.getElementById('latency-' + key);
    var barsEl = document.getElementById('bars-' + key);
    if (!valueEl || !barsEl) return;
    var valid = latencies.filter(function (l) { return l !== -1; });
    var avg = valid.length > 0 ? valid.reduce(function (a, b) { return a + b; }, 0) / valid.length : -1;
    valueEl.textContent = avg === -1 ? '-ms' : Math.round(avg) + 'ms';
    valueEl.style.color = getLatencyColor(avg);
    barsEl.querySelectorAll('.latency-bar').forEach(function (bar, i) {
      var l = latencies[i];
      if (l !== undefined) {
        bar.style.backgroundColor = getLatencyColor(l);
        bar.title = l === -1 ? '连接失败' : l + 'ms';
        bar.classList.remove('loading');
      }
    });
  }

  /** 心电图式轮询：每 3s 各站点采一次样，新样本从右侧入列、最旧左移出窗 */
  function pollNetOnce() {
    if (netCheckInFlight || document.hidden) return;
    var view = document.getElementById('view-dashboard');
    var container = document.getElementById('latency-cards');
    if (!view || view.style.display === 'none' || !container) return;
    netCheckInFlight = true;
    Promise.all(latencySites.map(async function (site) {
      var key = site.name.toLowerCase().replace(/\s+/g, '-');
      var l = await testLatency(site);
      var arr = siteLatencies[key] || (siteLatencies[key] = []);
      arr.push(l);
      if (arr.length > LATENCY_TEST_COUNT) arr.shift();
      updateLatencyDisplay(key, arr);
    })).finally(function () { netCheckInFlight = false; });
  }

  function ensureNetCheck() {
    if (netCheckStarted) return;
    netCheckStarted = true;
    generateLatencyCards();          // 首次生成骨架（loading 态采样条）
    pollNetOnce();
    setInterval(pollNetOnce, NETCHECK_POLL_MS);
  }

  function formatIpType(type) {
    if (!type) return '<span class="ip-type-unknown">未知</span>';
    var map = { 'isp': '住宅', 'hosting': '机房', 'business': '商用' };
    var cls = ({ 'isp': 'residential', 'hosting': 'hosting', 'business': 'business' })[type.toLowerCase()] || 'unknown';
    return '<span class="ip-type-' + cls + '">' + (map[type.toLowerCase()] || type) + '</span>';
  }

  // 点击站点卡片：查询本机出口 IP 情报（取数在 LiteCore，这里只提示 + 弹窗）
  async function queryIpForSite(site) {
    showToast('正在查询访问 ' + site.name + ' 的 IP...');
    try {
      showIpDetailModal(await Core.queryIpDetail());
    } catch (e) {
      showToast('查询失败: ' + e.message, true);
    }
  }

  function showIpDetailModal(data) {
    var modal = document.createElement('div');
    modal.className = 'modal show';   // 复用后台标准遮罩外壳（同测速设置弹窗）
    var flags = { is_crawler: data.is_crawler, is_proxy: data.is_proxy, is_vpn: data.is_vpn, is_tor: data.is_tor, is_abuser: data.is_abuser, is_bogon: data.is_bogon };
    var score = calcAbuseScore(fmtAbuserScore(data.company && data.company.abuser_score), fmtAbuserScore(data.asn && data.asn.abuser_score), flags);
    var scoreBadge = getAbuseScoreBadge(score);
    var isValid = function (v) { return v && v !== '-' && v !== '未知' && v !== 'unknown'; };
    var html = '<div class="modal-content" style="max-width:520px"><div class="modal-header"><h3>IP 详细信息</h3><button class="modal-close" onclick="this.closest(\'.modal\').remove()">×</button></div><div class="modal-body">';
    var basic = '<div class="ip-detail-item"><span class="ip-detail-label">IP 地址</span><span class="ip-detail-value">' + (data.ip || '未知') + '</span></div>';
    if (data.rir) basic += '<div class="ip-detail-item"><span class="ip-detail-label">区域互联网注册机构</span><span class="ip-detail-value">' + data.rir + '</span></div>';   // 无数据的字段整行不渲染，不留「未知」占位
    if (score !== null) basic += '<div class="ip-detail-item"><span class="ip-detail-label">综合滥用评分</span><span class="ip-detail-value"><span class="ip-detail-badge ' + scoreBadge.cls + '">' + scoreBadge.text + '</span></span></div>';
    html += '<div class="ip-detail-section"><div class="ip-detail-section-title">基本信息</div>' + basic + '</div>';
    if (data.location) {
      var loc = '';
      loc += '<div class="ip-detail-item"><span class="ip-detail-label">国家</span><span class="ip-detail-value">' + (data.location.country || '未知') + ' (' + (data.location.country_code || '-') + ')</span></div>';
      if (isValid(data.location.state)) loc += '<div class="ip-detail-item"><span class="ip-detail-label">省份/州</span><span class="ip-detail-value">' + data.location.state + '</span></div>';
      if (isValid(data.location.city)) loc += '<div class="ip-detail-item"><span class="ip-detail-label">城市</span><span class="ip-detail-value">' + data.location.city + '</span></div>';
      if (isValid(data.location.zip)) loc += '<div class="ip-detail-item"><span class="ip-detail-label">邮编</span><span class="ip-detail-value">' + data.location.zip + '</span></div>';
      if (data.location.latitude && data.location.longitude) loc += '<div class="ip-detail-item"><span class="ip-detail-label">坐标</span><span class="ip-detail-value">' + data.location.latitude + ', ' + data.location.longitude + '</span></div>';
      if (isValid(data.location.timezone)) loc += '<div class="ip-detail-item"><span class="ip-detail-label">时区</span><span class="ip-detail-value">' + data.location.timezone + '</span></div>';
      if (isValid(data.location.local_time)) loc += '<div class="ip-detail-item"><span class="ip-detail-label">当地时间</span><span class="ip-detail-value">' + data.location.local_time + '</span></div>';
      html += '<div class="ip-detail-section"><div class="ip-detail-section-title">位置信息</div>' + loc + '</div>';
    }
    if (data.company && isValid(data.company.name)) {
      var co = '<div class="ip-detail-item"><span class="ip-detail-label">运营商</span><span class="ip-detail-value">' + data.company.name + '</span></div>';
      if (isValid(data.company.domain)) co += '<div class="ip-detail-item"><span class="ip-detail-label">域名</span><span class="ip-detail-value">' + data.company.domain + '</span></div>';
      if (isValid(data.company.type)) co += '<div class="ip-detail-item"><span class="ip-detail-label">类型</span><span class="ip-detail-value">' + formatIpType(data.company.type) + '</span></div>';
      if (isValid(data.company.network)) co += '<div class="ip-detail-item"><span class="ip-detail-label">网络范围</span><span class="ip-detail-value">' + data.company.network + '</span></div>';
      var coScore = fmtAbuserScore(data.company.abuser_score);
      if (coScore) co += '<div class="ip-detail-item"><span class="ip-detail-label">滥用评分</span><span class="ip-detail-value">' + coScore + '</span></div>';
      html += '<div class="ip-detail-section"><div class="ip-detail-section-title">运营商信息</div>' + co + '</div>';
    }
    if (data.asn && isValid(data.asn.asn)) {
      var asn = '<div class="ip-detail-item"><span class="ip-detail-label">ASN 编号</span><span class="ip-detail-value">AS' + data.asn.asn + '</span></div>';
      if (isValid(data.asn.org)) asn += '<div class="ip-detail-item"><span class="ip-detail-label">组织</span><span class="ip-detail-value">' + data.asn.org + '</span></div>';
      if (isValid(data.asn.route)) asn += '<div class="ip-detail-item"><span class="ip-detail-label">路由</span><span class="ip-detail-value">' + data.asn.route + '</span></div>';
      if (isValid(data.asn.type)) asn += '<div class="ip-detail-item"><span class="ip-detail-label">类型</span><span class="ip-detail-value">' + formatIpType(data.asn.type) + '</span></div>';
      var asnScore = fmtAbuserScore(data.asn.abuser_score);
      if (asnScore) asn += '<div class="ip-detail-item"><span class="ip-detail-label">滥用评分</span><span class="ip-detail-value">' + asnScore + '</span></div>';
      if (isValid(data.asn.country)) asn += '<div class="ip-detail-item"><span class="ip-detail-label">国家代码</span><span class="ip-detail-value">' + String(data.asn.country).toUpperCase() + '</span></div>';
      html += '<div class="ip-detail-section"><div class="ip-detail-section-title">ASN 信息</div>' + asn + '</div>';
    }
    html += '</div></div>';
    modal.innerHTML = html;
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
    document.addEventListener('keydown', function handler(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', handler); } });
    document.body.appendChild(modal);
  }

  // 订阅活动时间线行（管理员走 /api/logs，访客走 /api/overview.recent，共用渲染）
  function subActivityRows(arr) {
    return arr.length ? arr.map(function (l) {
      var t = new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false });
      var isErr = l.type === '订阅拒绝' || l.type === '订阅转换失败';
      var badge = isErr
        ? '<span class="sub-badge err">' + escHtml(l.type) + '</span>'
        : '<span class="sub-badge">' + escHtml(l.type) + '</span>';
      return '<div class="sub-act-item' + (isErr ? ' err' : ' ok') + '">' +
        '<span class="sub-act-time">' + escHtml(t) + '</span>' + badge +
        '<span class="sub-act-detail' + (isErr ? ' err' : '') + '">' + escHtml(l.detail || '') + '</span>' +
        '</div>';
    }).join('') : '';
  }
  // 访客看板：/api/overview 聚合（账号总数 + 今日下发/拒绝 + 最近订阅动态），不触碰账号/日志接口
  function renderGuestOverview() {
    if (!window.LiteAPI) return;
    LiteAPI.call('/api/overview').then(function (o) {
      if (!o) return;
      var total = cfFmt(o.accountsTotal || 0);
      var map = { warpDashTotal: total, warpDashOk: total, warpDashWarn: '0', warpDashErr: '0' };
      Object.keys(map).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.textContent = map[id];
      });
      var todayEl = document.getElementById('subDashToday');
      if (todayEl) todayEl.textContent = cfFmt(o.subToday || 0);
      var rejectEl = document.getElementById('subDashReject');
      if (rejectEl) rejectEl.textContent = cfFmt(o.subReject || 0);
      var list = document.getElementById('subDashList');
      if (list) list.innerHTML = subActivityRows(Array.isArray(o.recent) ? o.recent : []);
    });
  }
  async function dashboardLoad() {
    if (window.LiteAPI && !DASH_STATUS) {
      var s = await LiteAPI.getStatus();
      if (s) DASH_STATUS = s;
    }
    if (IS_GUEST) renderGuestOverview();
    else { renderWarpOverview(); renderSubActivity(); }
    ensureNetCheck();
  }
  // 高级设置系统状态栏（版本 / D1 绑定 / 登录时间）
  async function fillSystemBar(pre) {
    var s = pre || DASH_STATUS;
    if (!s && window.LiteAPI) { s = await LiteAPI.getStatus(); if (s) DASH_STATUS = s; }
    var v = document.getElementById('sys-version');
    if (v) v.textContent = s ? (s.version || '—') : '获取失败';
    var db = document.getElementById('sys-db-status');
    if (db) db.textContent = s ? (s.d1Bound ? 'D1' : '未绑定 D1') : '未知';
    var dot = document.getElementById('sys-d1-dot');
    if (dot) dot.classList.toggle('ok', !!(s && s.d1Bound));
    var ses = document.getElementById('sys-session');
    if (ses) {
      var t = 0;
      try { t = parseInt(localStorage.getItem('sf_warp_login_time') || '0', 10); } catch (e) {}
      ses.textContent = t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '-';
    }
  }

  // ---------- 安全设置：账号 / 登录安全 ----------
  function secSetVal(id, v) { var el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; }
  function fillSecurity() {
    if (!window.LiteAPI) return;
    LiteAPI.call('/api/config').then(function (c) {
      if (!c) return;
      secSetVal('secUser', c.USERNAME || '');
      secSetVal('secSession', c.sessionTimeout != null ? c.sessionTimeout : 24);
      var lockEl = document.getElementById('secLock');
      if (lockEl) lockEl.checked = c.loginLockEnabled !== false;
      var guestEl = document.getElementById('guestEnabled');
      if (guestEl) guestEl.checked = c.GuestEnabled !== false;
      // 回显当前访客密码（访客密码不走「留空不修改」脱敏策略，直接回显便于查看与修改）
      secSetVal('guestPass', String(c.GuestPassword != null ? c.GuestPassword : 'guest'));
    });
  }
  // 访客登录设置：开关 + 访客密码（留空不修改），保存后登录页入口即时生效
  window.__secSaveGuest = async function () {
    if (!window.LiteAPI) return;
    var payload = { GuestEnabled: !!(document.getElementById('guestEnabled') || {}).checked };
    var pw = (document.getElementById('guestPass') || {}).value || '';
    if (pw) payload.GuestPassword = pw;
    var r = await LiteAPI.call('/api/config', { method: 'POST', body: JSON.stringify(payload) });
    if (r) {
      var el = document.getElementById('guestPass');
      if (el) el.value = '';
      showToast(payload.GuestEnabled ? '访客登录已开启并保存' : '访客登录已关闭');
    }
  };
  window.__secResetUuid = async function () {
    if (!confirm('确定重置 UUID？旧订阅链接将立即失效，需重新分发新订阅。')) return;
    if (!confirm('再次确认：真的要重置吗？')) return;
    var nu = '';
    try { nu = (crypto.randomUUID && crypto.randomUUID()) || ''; } catch (e) {}
    if (!nu) {
      // fallback v4
      var s = function () { return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1); };
      nu = s() + s() + '-' + s() + '-4' + s().substr(1) + '-8' + s().substr(1) + '-' + s() + s() + s();
    }
    var r = await LiteAPI.call('/api/config', { method: 'POST', body: JSON.stringify({ SubKey: nu }) });
    if (r) { showToast('订阅密钥已重置，新订阅已生效'); }
  };
  window.__secSaveAccount = async function () {
    var u = ((document.getElementById('secUser') || {}).value || '').trim();
    var p = (document.getElementById('secPass') || {}).value || '';
    if (!u) { showToast('账号不能为空', true); return; }
    var payload = { USERNAME: u };
    if (p) payload.PASSWORD = p;
    var r = await LiteAPI.call('/api/config', { method: 'POST', body: JSON.stringify(payload) });
    if (r) {
      var passEl = document.getElementById('secPass');
      if (passEl) passEl.value = '';
      showToast(p ? '账号已保存，下次登录请使用新密码' : '账号已保存');
    }
  };
  window.__secSaveSecurity = async function () {
    var h = parseInt((document.getElementById('secSession') || {}).value, 10);
    if (!(h >= 1 && h <= 168)) { showToast('会话超时需在 1-168 小时之间', true); return; }
    var r = await LiteAPI.call('/api/config', { method: 'POST', body: JSON.stringify({
      loginLockEnabled: !!(document.getElementById('secLock') || {}).checked,
      sessionTimeout: h
    }) });
    if (r) showToast('登录安全已保存，下次登录生效');
  };

  // ---------- 系统日志（/api/logs；分页 10/20/30，默认 10） ----------
  var LOGS_CACHE = [];
  var LOGS_PAGE = 1;
  var LOGS_SIZE = 10;
  var LOGS_SIZE_OPTS = [10, 20, 30];
  function fillLogs() {
    if (!window.LiteAPI) return;
    LiteAPI.call('/api/logs?limit=500').then(function (rows) {
      LOGS_CACHE = Array.isArray(rows) ? rows : [];
      LOGS_PAGE = 1;
      logsRender();
    });
  }
  window.__logsRefresh = function () { fillLogs(); };
  window.__logsGo = function (p) { LOGS_PAGE = p; logsRender(); };
  window.__logsSizeToggle = function (e) {
    e.stopPropagation();
    var ms = document.getElementById('ms-logsize');
    if (ms) ms.classList.toggle('open');
  };
  window.__logsSize = function (n) {
    LOGS_SIZE = n;
    LOGS_PAGE = 1;
    logsRender();
  };
  function logsRender() {
    var tbody = document.getElementById('logsBody');
    if (!tbody) return;
    if (!LOGS_CACHE.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center" class="text-muted-light">暂无日志</td></tr>';
      var rowEmpty = document.getElementById('logsPagerRow');
      if (rowEmpty) rowEmpty.innerHTML = '';
      var footEmpty = document.getElementById('logsPager');
      if (footEmpty) footEmpty.style.display = 'none';
      return;
    }
    var total = LOGS_CACHE.length;
    var totalPages = Math.max(1, Math.ceil(total / LOGS_SIZE));
    if (LOGS_PAGE > totalPages) LOGS_PAGE = totalPages;
    if (LOGS_PAGE < 1) LOGS_PAGE = 1;
    var start = (LOGS_PAGE - 1) * LOGS_SIZE;
    var rows = LOGS_CACHE.slice(start, start + LOGS_SIZE);
    tbody.innerHTML = rows.map(function (lg, i) {
      var timeStr = Core.fmtLogTime(lg.time);   // UTC+8 展示，与表头一致
      var org = lg.org || '';
      var dc = org ? 'AS' + (lg.asn || '?') + ' ' + org : (lg.asn && lg.asn !== '-' ? 'AS' + lg.asn : '-');
      // 单用户面板：日志表不设用户名列（detail 里的「账号: xxx」保留在详情列可见）
      var detail = lg.detail || '';
      var absIdx = start + i + 1;
      return '<tr>' +
        '<td class="text-muted">' + absIdx + '</td>' +
        '<td class="text-muted">' + escHtml(timeStr) + '</td>' +
        '<td>' + escHtml(lg.ip || '-') + '</td>' +
        '<td>' + escHtml(lg.cc || '-') + '</td>' +
        '<td class="truncate" style="max-width:160px" title="' + escHtml(dc) + '">' + escHtml(dc) + '</td>' +
        '<td class="truncate" style="max-width:220px" title="' + escHtml(detail) + '">' + escHtml(detail || '-') + '</td>' +
        '<td><span class="node-type node">' + escHtml(lg.type || '-') + '</span></td>' +
        '</tr>';
    }).join('');
    // 分页栏
    var row = document.getElementById('logsPagerRow');
    var foot = document.getElementById('logsPager');
    if (!row || !foot) return;
    foot.style.display = '';
    if (total <= LOGS_SIZE) { row.innerHTML = ''; foot.style.display = 'none'; return; }
    var chevL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    var chevR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    var p = LOGS_PAGE;
    var html = '<button type="button" title="上一页"' + (p <= 1 ? ' disabled' : ' onclick="window.__logsGo(' + (p - 1) + ')"') + '>' + chevL + '</button>';
    pagerPages(p, totalPages).forEach(function (pg) {
      html += pg === '...'
        ? '<span class="page-ellipsis">…</span>'
        : '<button type="button"' + (pg === p ? ' class="active"' : ' onclick="window.__logsGo(' + pg + ')"') + '>' + pg + '</button>';
    });
    html += '<button type="button" title="下一页"' + (p >= totalPages ? ' disabled' : ' onclick="window.__logsGo(' + (p + 1) + ')"') + '>' + chevR + '</button>';
    html += '<span class="jump-box"><span class="jump-label">跳转</span><input id="logsJump" type="number" min="1" max="' + totalPages + '" placeholder="页码" value="' + p + '"><span class="jump-label">页</span></span>';
    html += '<div class="ms" id="ms-logsize" style="min-width:96px">' +
      '<button type="button" class="ms-trigger ui-field" style="height:34px;" onclick="window.__logsSizeToggle(event)">' +
      '<span class="ms-value">' + LOGS_SIZE + ' 条/页</span>' +
      '<svg class="ms-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<div class="ms-panel"><div class="ms-list">' +
      LOGS_SIZE_OPTS.map(function (n) {
        return '<div class="ms-opt single' + (n === LOGS_SIZE ? ' active' : '') + '" onclick="window.__logsSize(' + n + ')"><span>' + n + ' 条/页</span></div>';
      }).join('') +
      '</div></div></div>';
    row.innerHTML = html;
    var inp = document.getElementById('logsJump');
    if (inp) inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var v = parseInt(inp.value, 10); if (v >= 1 && v <= totalPages && v !== p) window.__logsGo(v); }
    });
  }

  // ---------- 高级设置：配置导出 / 导入 / 恢复出厂；退出登录 ----------
  window.__cfgExport = async function () {
    if (!window.LiteAPI) { showToast('后端未接入（纯静态预览）', true); return; }
    var c = await LiteAPI.getConfig();
    if (!c) return;
    downloadText('senflare-warp-config.json', JSON.stringify(c, null, 2), '配置已导出', 'application/json;charset=utf-8');
  };
  window.__cfgImport = function () {
    var inp = document.getElementById('cfgImportFile');
    if (inp) inp.click();
  };
  window.__cfgImportChange = async function (inp) {
    try {
      if (!inp.files || !inp.files[0]) return;
      var obj = JSON.parse(await inp.files[0].text());
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('格式不正确');
      delete obj.RESET;
      delete obj.USERNAME;      // 凭据不随配置文件迁移
      delete obj.PASSWORD;
      var r = await LiteAPI.saveConfig(obj);
      if (r) { CFG_SERVER = null; cfgDraftClear(); showToast('配置导入成功'); setTimeout(function () { location.reload(); }, 800); }
    } catch (e) {
      showToast('导入失败：' + e.message, true);
    }
    inp.value = '';
  };
  window.__factoryReset = function () {
    window.__showConfirm('确定恢复出厂设置？将清除 D1 中保存的全部节点/反代配置，此操作不可恢复！', function () {
      window.__showConfirm('再次确认：真的要清除全部配置吗？', async function () {
        var r = await LiteAPI.saveConfig({ RESET: true });
        if (r) {
          cfgDraftClear();
          CFG_SERVER = null;
          showToast('已恢复出厂设置');
          setTimeout(function () { location.reload(); }, 800);
        }
      }, '二次确认', { okText: '确认清除', cancelText: '取消', danger: true });
    }, '恢复出厂设置', { okText: '下一步', cancelText: '取消', danger: true });
  };
  // ---------- 通用确认弹窗（退出登录等场景；样式复用 .st-check-*） ----------
  // opts 可选：{ okText, cancelText, onDiscard }；遮罩 / ESC 恒为安全关闭
  // 按钮样式对齐「开始测速 / 测速设置」操作行：主按钮 btn-sm btn-primary，次按钮 btn-sm btn-outline
  var confirmCb = null, confirmDiscardCb = null;
  window.__showConfirm = function (msg, onConfirm, title, opts) {
    opts = opts || {};
    document.getElementById('confirmTitle').textContent = title || '确认';
    document.getElementById('confirmBody').textContent = msg;
    confirmCb = typeof onConfirm === 'function' ? onConfirm : null;
    confirmDiscardCb = typeof opts.onDiscard === 'function' ? opts.onDiscard : null;
    var cancelBtn = document.querySelector('#confirmModal .st-confirm-cancel');
    if (cancelBtn) cancelBtn.textContent = opts.cancelText || '取消';
    var okBtn = document.querySelector('#confirmModal .st-confirm-ok');
    if (okBtn) {
      okBtn.textContent = opts.okText || '确定';
      okBtn.classList.toggle('danger', !!opts.danger);
    }
    document.getElementById('confirmModal').classList.add('show');
  };
  window.__confirmCancel = function () {
    var m = document.getElementById('confirmModal');
    if (m) m.classList.remove('show');
    confirmCb = null; confirmDiscardCb = null;
  };
  window.__confirmDiscard = function () {          // 左键：关闭并执行放弃类分支（如「直接离开」）
    var d = confirmDiscardCb;
    window.__confirmCancel();
    if (d) d();
  };
  window.__confirmOk = function () {
    var cb = confirmCb;
    window.__confirmCancel();
    if (cb) cb();
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var m = document.getElementById('confirmModal');
      if (m && m.classList.contains('show')) window.__confirmCancel();
    }
  });

  // 退出登录：确认弹窗 → 清本地令牌 → 回登录页
  window.__logout = function () {
    window.__showConfirm('确定要退出登录吗？', async function () {
      try { await LiteAPI.call('/api/logout', { method: 'POST' }); } catch (e) {}
      try { LiteAPI.setToken(''); localStorage.removeItem('sf_warp_login_time'); } catch (e) {}
      location.href = 'login.html';
    }, '退出登录');
  };

  // 暴露到全局（主题明暗/调色盘由 js/theme.js 提供）
  window.toggleSidebar = toggleSidebar;
  window.toggleCard = toggleCard;
  window.showToast = showToast;
  window.switchTab = switchTab;
  window.generateSub = generateSub;
  window.copySubUrl = copySubUrl;
  window.toggleSubQR = toggleSubQR;
  window.switchSpeedTab = switchSpeedTab;
  window.toggleStFold = toggleStFold;
  window.toggleStFold = toggleStFold;

  document.addEventListener('DOMContentLoaded', function () {
    // 明暗/主题色初始化由 js/theme.js 负责（含服务端同步）
    // 字体大陆备份：主源超时切 gcore
    (function () {
      function fontBackupOnFail(linkId, family, backupUrl) {
        var link = document.getElementById(linkId);
        if (!link || link.dataset.backed) return;
        link.dataset.backed = '1';
        setTimeout(function () {
          var faces = document.fonts ? Array.from(document.fonts).filter(function (f) { return String(f.family).indexOf(family) !== -1; }) : [];
          var dead = !document.fonts || faces.length === 0 || faces.every(function (f) { return f.status === 'error'; });
          if (dead && link.getAttribute('href') !== backupUrl) { link.media = 'all'; link.href = backupUrl; }
        }, 2500);
      }
      fontBackupOnFail('fontInterCss', 'Inter Variable', 'https://gcore.jsdelivr.net/npm/@fontsource-variable/inter@5/index.css');
      fontBackupOnFail('fontNotoCss', 'Noto Sans SC Variable', 'https://gcore.jsdelivr.net/npm/@fontsource-variable/noto-sans-sc@5/index.css');
    })();
    var sidebar = document.getElementById('sidebar');
    if (sidebar && window.innerWidth > 768 && !sidebar.classList.contains('expanded')) sidebar.classList.add('expanded');
    // 恢复上次激活的 tab（键不存在或已失效则回落数据看板）；各视图数据由 doSwitchTab 钩子按需拉取
    var savedTab = null;
    try { savedTab = localStorage.getItem('sf_warp_tab'); } catch (e) {}
    var savedEl = savedTab && document.querySelector('.nav-item[data-tab="' + savedTab + '"]');
    if (savedEl) { try { localStorage.removeItem('sf_warp_cfg_draft_v1'); } catch (e) {} switchTab(savedTab, savedEl); }
    else switchTab('dashboard', document.querySelector('.nav-item[data-tab="dashboard"]'));
  });
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var sidebar = document.getElementById('sidebar');
      var overlay = document.querySelector('.sidebar-overlay');
      if (!sidebar) return;
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('show');
        if (overlay) overlay.classList.remove('show');
      }
    }, 150);
  });
})();
