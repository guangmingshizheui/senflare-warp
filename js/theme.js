/**
 * Senflare Warp — Theme 模块（主题色调色盘 + 全局同步）
 *
 * 样式：弹窗内调色盘）；弹窗外壳 .modal
 * 首帧上色由各页内联脚本按 localStorage 即时完成（避免闪色）；本模块负责运行时部分：
 *   1) 应用本地已存主题色，补齐全部派生变量；
 *   2) GET /api/theme 服务端同步——其他设备改过主题时以服务端为准并回写本地；
 *   3) 「主题设置」弹窗（渐变取色/预设/输入），点「应用」POST /api/config 写入后端
 *       动态 favicon（原 js/favicon.js）——徽章底色跟随主题色
 */
(function () {
  /* 动态 favicon 刷新句柄（由下方 favicon 子模块赋值） */
  var faviconRefresh = null;
  /* ---------- 基础工具 ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function hexToHsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }
  function hexToRgb(hex) { return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }; }
  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    var r, g, b;
    if (s === 0) { r = g = b = l; } else {
      var hue2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q; if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(function (x) { var h = x.toString(16); return h.length === 1 ? '0' + h : h; }).join(''); }

  /* 轻量提示：复用页面 #toast（走 showToast，避免内联 opacity 抢占共用元素） */
  function notify(msg) {
    if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------- 变量应用 ---------- */
  /* 光斑色写为 CSS hsl() 分量三元组：--orb-* 由 .orb 规则包一层 hsl(var(--orb-1)) 再合成。
     HSL 分量与 hex 色值互转时经 8bit 取整，写回前用 CSS 同款 round 保证所见即所得；
     无法互换时退回主题色的 hex 直填（--color-primary 始终接受 hex） */
  function hslToCssValue(hsl, suffix) {
    var s = Math.max(0, Math.min(100, Math.round(hsl.s)));
    var l = Math.max(0, Math.min(100, Math.round(hsl.l)));
    return Math.round(hsl.h) + ', ' + s + '%, ' + l + '%' + (suffix || '');
  }
  function updateOrbColors(hsl) {
    var root = document.documentElement;
    if (isNaN(hsl.h) || isNaN(hsl.s) || isNaN(hsl.l)) {
      // 退化：无法换算时给中性雾白，避免出现饱和红橙之类的伪色（历史 bug：把预设红直塞进 orb）
      root.style.setProperty('--orb-1', '0, 0%, 96%');
      root.style.setProperty('--orb-2', '0, 0%, 94%');
      root.style.setProperty('--orb-3', '0, 0%, 95%');
      return;
    }
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      root.style.setProperty('--orb-1', hslToCssValue({ h: hsl.h, s: 100, l: 10 }));
      root.style.setProperty('--orb-2', hslToCssValue({ h: hsl.h, s: 100, l: 8 }));
      root.style.setProperty('--orb-3', hslToCssValue({ h: hsl.h, s: 100, l: 12 }));
    } else {
      root.style.setProperty('--orb-1', hslToCssValue({ h: hsl.h, s: Math.max(hsl.s - 10, 80), l: 90 }));
      root.style.setProperty('--orb-2', hslToCssValue({ h: hsl.h, s: Math.max(hsl.s - 15, 75), l: 92 }));
      root.style.setProperty('--orb-3', hslToCssValue({ h: hsl.h, s: Math.max(hsl.s - 12, 78), l: 91 }));
    }
  }

  /** 把一个主题色应用到全部根变量（两张样式表的派生令牌都挂在这几个根变量上） */
  function applyVars(color) {
    var root = document.documentElement;
    root.style.setProperty('--color-primary', color);
    var hsl = hexToHsl(color);
    root.style.setProperty('--color-primary-light', 'hsl(' + Math.round(hsl.h) + ', ' + Math.round(hsl.s) + '%, ' + Math.min(Math.round(hsl.l) + 15, 90) + '%)');
    root.style.setProperty('--color-primary-dark', 'hsl(' + Math.round(hsl.h) + ', ' + Math.round(hsl.s) + '%, ' + Math.max(Math.round(hsl.l) - 6, 20) + '%)');
    var rgb = hexToRgb(color);
    var rgbStr = rgb.r + ',' + rgb.g + ',' + rgb.b;
    root.style.setProperty('--color-primary-rgb', rgbStr);
    root.style.setProperty('--landing-rgb', rgb.r + ', ' + rgb.g + ', ' + rgb.b);   // 落地页光晕/阴影跟随
    root.style.setProperty('--color-primary-bg-2', 'rgba(' + rgbStr + ', 0.02)');
    root.style.setProperty('--color-primary-bg-5', 'rgba(' + rgbStr + ', 0.05)');
    root.style.setProperty('--color-primary-bg-8', 'rgba(' + rgbStr + ', 0.08)');
    root.style.setProperty('--color-primary-bg-10', 'rgba(' + rgbStr + ', 0.1)');
    root.style.setProperty('--color-primary-bg-15', 'rgba(' + rgbStr + ', 0.15)');
    root.style.setProperty('--color-primary-bg-20', 'rgba(' + rgbStr + ', 0.2)');
    root.style.setProperty('--color-primary-bg-40', 'rgba(' + rgbStr + ', 0.4)');
    root.style.setProperty('--color-primary-border', 'rgba(' + rgbStr + ', 0.3)');
    root.style.setProperty('--color-primary-border-20', 'rgba(' + rgbStr + ', 0.2)');
    root.style.setProperty('--color-primary-shadow', 'rgba(' + rgbStr + ', 0.3)');
    return hsl;
  }

  /** 品牌标记刷新：后台侧边栏 SVG 渐变 + 动态 favicon */
  function refreshMarks(color, hsl) {
    var logoGrad = document.getElementById('logo-grad');
    if (logoGrad) {
      var stops = logoGrad.querySelectorAll('stop');
      if (stops[0]) stops[0].style.stopColor = color;
      if (stops[1]) stops[1].style.stopColor = 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + Math.max(hsl.l - 10, 10) + '%)';
    }
    if (faviconRefresh) faviconRefresh();
  }

  /* ---------- 后端同步 ---------- */
  // API 基址：同源部署为 ''；面板单独托管时与 admin.js 同源读取 sf_warp_api_base（LiteAPI 未加载的页面回落直读）
  function apiBase() {
    try {
      if (window.LiteAPI && window.LiteAPI.API_BASE) return window.LiteAPI.API_BASE;
      return (localStorage.getItem('sf_warp_api_base') || '').replace(/\/+$/, '');
    } catch (e) { return ''; }
  }
  function postBackend(payload) {
    // 同步到后端（config）：静默失败——离线/未绑 D1 时仅本地生效；
    // 令牌缺失也发送，恢复鉴权后由后端拒绝
    // 传字符串视为 { ThemeColor }，传对象则原样发送（全站主题色 / 登录壁纸来源等即时同步用）
    if (typeof payload === 'string') payload = { ThemeColor: payload };
    try {
      var token = null;
      try { token = localStorage.getItem('sf_warp_token'); } catch (e2) {}
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      fetch(apiBase() + '/api/config', { method: 'POST', headers: headers, body: JSON.stringify(payload) }).catch(function () {});
    } catch (e) {}
  }

  /** 拉取服务端主题色/壁纸：与其他设备不一致时以服务端为准重算并回写本地。
   * 兜底：服务端返回默认蓝且本地有自定义色时，视为「未登录/未配置」而非「权威设为蓝」，
   * 保留本地用户设置，避免刷新把用户换的颜色冲回默认蓝。 */
  function serverSync() {
    fetch(apiBase() + '/api/theme')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // 登录壁纸配置：写本地供 initLoginBg 使用（服务端权威；未配置回落源站）
        if (d && d.bgSource) {
          try { localStorage.setItem('sf_warp_bg_source', d.bgSource); } catch (e) {}
          if (d.bgSource === 'custom' && d.bgCustomUrl) {
            try { localStorage.setItem('sf_warp_bg_custom', d.bgCustomUrl); } catch (e) {}
          }
        }
        var c = d && d.color;
        if (!c || !/^#[0-9a-fA-F]{6}$/.test(c)) return;   // 未设置/非法：保持本地
        var local = lsGet('theme-color') || '';
        if (local.toLowerCase() === c.toLowerCase()) { refreshMarks(c, hexToHsl(c)); return; }   // 同色也刷标记（服务端可能刚改，本地同名但 favicon/logo 未更新）
        // 服务端没配置过（默认蓝）而本地有自定义色 → 尊重本地，等用户下次登录后由 applyThemeColor 写回后端
        if (c.toLowerCase() === '#1677ff' && local && local.toLowerCase() !== '#1677ff') return;
        applyVars(c);
        lsSet('theme-color', c);   // 同 applyThemeColor：先落存储再刷 favicon/标记
        refreshMarks(c, hexToHsl(c));
      })
      .catch(function () {});
  }

  /* ---------- 明暗切换（自 admin-ui.js 迁入：三页统一由本文件初始化，落地页无 admin-ui 也可切换） ---------- */
  function syncThemeIcon(theme) {
    var svg = theme === 'dark'
      ? '<svg class="moon-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
      : '<svg class="sun-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    // 同步所有主题图标槽位（顶栏 + 侧边栏）
    var slots = document.querySelectorAll('.theme-icon-slot');
    if (slots.length) slots.forEach(function (s) { s.innerHTML = svg; });
    else {
      var i = document.getElementById('theme-icon');
      if (i) i.innerHTML = svg;
    }
  }
  function applyModeTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    lsSet('theme', mode);
    syncThemeIcon(mode);
    var savedColor = lsGet('theme-color');
    if (savedColor) { try { updateOrbColors(hexToHsl(savedColor)); } catch (e) {} }
  }
  window.toggleTheme = function () {
    var cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyModeTheme(cur === 'light' ? 'dark' : 'light');
  };
  // 初始恢复：data-theme 同步设置避免暗色闪白；图标槽位等 DOM 就绪后再填
  var bootMode = lsGet('theme') || 'light';
  document.documentElement.setAttribute('data-theme', bootMode);
  var bootColor = lsGet('theme-color');
  if (bootColor) { try { updateOrbColors(hexToHsl(bootColor)); } catch (e) {} }
  function bootModeIcon() { syncThemeIcon(bootMode); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootModeIcon);
  else bootModeIcon();

  /* ---------- 调色盘 ---------- */
  var colorPicker = { hue: 0, saturation: 100, lightness: 50, alpha: 1, currentColor: '#1677ff' };

  var PRESET_COLORS = ['#ff0000', '#db3a2b', '#ff7979', '#ff5476', '#ff4500', '#ff6901', '#f8d300', '#93d82c', '#11b35f', '#2c921f', '#5d8feb', '#1e8af5', '#00bfff', '#1677ff', '#1f51ff', '#9370db','#5865f2','#5a4fcf','#6a5acd','#707070'];

  function openThemeModal(mode) {
    var modal = document.createElement('div');
    modal.className = 'modal show';
    modal.onclick = function (e) { if (e.target === modal) closeThemeModal(modal); };
    modal.innerHTML = '<div class="modal-content theme-modal" onclick="event.stopPropagation()"><div class="modal-header"><h3>主题设置</h3><button class="modal-close" onclick="closeThemeModal(this.closest(\'.modal\'))">×</button></div><div class="modal-body"><div class="color-picker"><div class="color-gradient" id="color-gradient"><div class="gradient-cursor" id="gradient-cursor"></div></div><div class="color-controls"><div class="color-preview" id="color-preview"></div><div class="color-sliders"><div class="slider-wrapper"><div class="hue-slider" id="hue-slider"><div class="slider-thumb" id="hue-thumb"></div></div></div><div class="slider-wrapper"><div class="alpha-slider" id="alpha-slider"><div class="slider-thumb" id="alpha-thumb"></div></div></div></div></div><div class="color-input-wrapper"><input type="text" class="color-input" id="color-input" value="#1677ff" maxlength="7"></div><div class="preset-colors">' + PRESET_COLORS.map(function (c) { return '<div class="preset-color" style="background:' + c + '" onclick="selectPresetColor(\'' + c + '\')"></div>'; }).join('') + '</div></div></div><div class="modal-footer"><button class="btn btn-outline" onclick="closeThemeModal(this.closest(\'.modal\'))">取消</button><button class="btn btn-primary" onclick="' + (mode === 'global' ? 'applyGlobalThemeColor()' : 'applyThemeColor()') + '">应用</button></div></div>';
    document.body.appendChild(modal);
    // 初始色：全站卡读全站色（sf_warp_global_theme）；顶栏/落地页读当前实际生效色（CSS --color-primary，与页面所见一致），
    // 避免存储里的旧值与页面显示不一致导致弹窗"对不上"
    var initHex = '#1677ff';
    if (mode === 'global') {
      var g = lsGet('sf_warp_global_theme');
      if (/^#[0-9a-fA-F]{6}$/.test(g)) initHex = g;
    } else {
      try {
        var cs = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim();
        if (/^#[0-9a-fA-F]{6}$/.test(cs)) initHex = cs;
      } catch (e) {}
      if (initHex === '#1677ff') {
        var l = lsGet('theme-color');
        if (/^#[0-9a-fA-F]{6}$/.test(l)) initHex = l;
      }
    }
    colorPicker.currentColor = initHex;
    initColorPicker();
    setColorFromHex(initHex);   // 最后执行：按 initHex 重渲染色块/渐变/输入框，保证弹窗与初始色一致
  }
  function closeThemeModal(modal) { if (modal) modal.remove(); }

  function updateGradientBackground() {
    var g = document.getElementById('color-gradient');
    if (g) g.style.background = 'linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, hsl(' + colorPicker.hue + ', 100%, 50%))';
  }
  function updateColor() {
    var rgb = hslToRgb(colorPicker.hue, colorPicker.saturation, colorPicker.lightness);
    var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    colorPicker.currentColor = hex;
    var preview = document.getElementById('color-preview');
    if (preview) preview.style.background = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + colorPicker.alpha + ')';
    var input = document.getElementById('color-input');
    if (input) input.value = hex;
    var alphaSlider = document.getElementById('alpha-slider');
    if (alphaSlider) alphaSlider.style.background = 'linear-gradient(to right, transparent, ' + hex + '), repeating-conic-gradient(#ddd 0% 25%, white 0% 50%) 50% / 10px 10px';
  }
  function setColorFromHex(hex) {
    var hsl = hexToHsl(hex);
    colorPicker.hue = hsl.h; colorPicker.saturation = hsl.s; colorPicker.lightness = hsl.l;
    var hueSlider = document.getElementById('hue-slider'), hueThumb = document.getElementById('hue-thumb');
    if (hueSlider && hueThumb) hueThumb.style.left = (colorPicker.hue / 360) * hueSlider.offsetWidth + 'px';
    var gradient = document.getElementById('color-gradient'), cursor = document.getElementById('gradient-cursor');
    if (gradient && cursor) {
      var x = (colorPicker.saturation / 100) * gradient.offsetWidth;
      var sf = colorPicker.saturation / 100, maxL = 100 - sf * 50;
      var yFactor = maxL > 0 ? 1 - (colorPicker.lightness / maxL) : 1;
      cursor.style.left = x + 'px'; cursor.style.top = (yFactor * gradient.offsetHeight) + 'px';
    }
    updateGradientBackground(); updateColor();
  }
  function selectPresetColor(color) { setColorFromHex(color); }

  function applyThemeColor() {
    var color = colorPicker.currentColor;
    var hsl = applyVars(color);
    updateOrbColors(hsl);
    lsSet('theme-color', color);   // 先落存储再刷标记：favicon/主题标读取的是 localStorage 里的当前色
    refreshMarks(color, hsl);
    // 后台顶栏/落地页入口：只改本地（本机个性化），不写服务端
    syncGlobalThemeCard();
    notify('主题色已更新（本机生效）');
    closeThemeModal(document.querySelector('.theme-modal') && document.querySelector('.theme-modal').closest('.modal'));
  }

  /** 全站主题色（仅高级设置卡片入口）：写入服务端 config.ThemeColor，全站访客经 /api/theme 拿到该默认色 */
  function applyGlobalThemeColor() {
    var color = colorPicker.currentColor;
    // 全站默认仅改服务端权威 + 本地"未自定义"时的兜底：
    // 若本地没有访客自定义色，则本机也跟随全站色；访客自行改过则保持其本地偏好
    if (!lsGet('theme-color')) {
      var hsl = applyVars(color);
      updateOrbColors(hsl);
      refreshMarks(color, hsl);
      lsSet('theme-color', color);
    }
    lsSet('sf_warp_global_theme', color);
    postBackend(color);
    syncGlobalThemeCard();
    notify('全站主题色已更新');
    closeThemeModal(document.querySelector('.theme-modal') && document.querySelector('.theme-modal').closest('.modal'));
  }

  /** 登录壁纸卡：下拉/输入框改动仅同步显隐，保存走下方按钮 */
  window.__bgSourceApply = function (el) {
    var sel = document.getElementById('bgSourceSel');
    if (!sel) return;
    // 联动：选「自定义」显示输入框，其余隐藏
    var wrap = document.getElementById('bgCustomWrap');
    if (wrap) wrap.style.display = sel.value === 'custom' ? '' : 'none';
  };
  // 保存壁纸来源：写服务端 config，访客刷新 login.html 即生效
  window.__bgSourceSave = function () {
    var sel = document.getElementById('bgSourceSel');
    var url = document.getElementById('bgCustomUrl');
    if (!sel) return;
    var payload = { BgSource: sel.value };
    if (sel.value === 'custom' && url && String(url.value).trim()) payload.BgCustomUrl = String(url.value).trim();
    else payload.BgCustomUrl = '';
    postBackend(payload);
    notify('登录壁纸来源已保存');
  };

  function loadSavedThemeColor() {
    var saved = lsGet('theme-color');
    if (!saved || !/^#[0-9a-fA-F]{6}$/.test(saved)) return;
    var hsl = applyVars(saved);
    updateOrbColors(hsl);
    refreshMarks(saved, hsl);
  }

  function initColorPicker() {
    var gradient = document.getElementById('color-gradient'), gradientCursor = document.getElementById('gradient-cursor');
    var hueSlider = document.getElementById('hue-slider'), hueThumb = document.getElementById('hue-thumb');
    var alphaSlider = document.getElementById('alpha-slider'), alphaThumb = document.getElementById('alpha-thumb');
    var colorInput = document.getElementById('color-input');
    var isDraggingGradient = false;
    if (gradient) {
      gradient.addEventListener('mousedown', function (e) { isDraggingGradient = true; updateGradientPosition(e); });
      document.addEventListener('mousemove', function (e) { if (isDraggingGradient) updateGradientPosition(e); });
      document.addEventListener('mouseup', function () { isDraggingGradient = false; });
      function updateGradientPosition(e) {
        var rect = gradient.getBoundingClientRect();
        var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        var y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
        colorPicker.saturation = (x / rect.width) * 100;
        var sf = colorPicker.saturation / 100, yFactor = y / rect.height;
        colorPicker.lightness = (1 - yFactor) * (100 - sf * 50);
        gradientCursor.style.left = x + 'px'; gradientCursor.style.top = y + 'px';
        updateColor();
      }
    }
    var isDraggingHue = false;
    if (hueSlider) {
      hueSlider.addEventListener('mousedown', function (e) { isDraggingHue = true; updateHuePosition(e); });
      document.addEventListener('mousemove', function (e) { if (isDraggingHue) updateHuePosition(e); });
      document.addEventListener('mouseup', function () { isDraggingHue = false; });
      function updateHuePosition(e) {
        var rect = hueSlider.getBoundingClientRect();
        var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        colorPicker.hue = (x / rect.width) * 360;
        hueThumb.style.left = x + 'px';
        updateGradientBackground(); updateColor();
      }
    }
    var isDraggingAlpha = false;
    if (alphaSlider) {
      alphaSlider.addEventListener('mousedown', function (e) { isDraggingAlpha = true; updateAlphaPosition(e); });
      document.addEventListener('mousemove', function (e) { if (isDraggingAlpha) updateAlphaPosition(e); });
      document.addEventListener('mouseup', function () { isDraggingAlpha = false; });
      function updateAlphaPosition(e) {
        var rect = alphaSlider.getBoundingClientRect();
        var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        colorPicker.alpha = x / rect.width;
        alphaThumb.style.left = x + 'px';
        updateColor();
      }
    }
    if (colorInput) colorInput.addEventListener('input', function (e) { var hex = e.target.value; if (/^#[0-9A-Fa-f]{6}$/.test(hex)) setColorFromHex(hex); });
    updateGradientBackground(); updateColor();
  }

  /* ---------- 全局导出（弹窗内联 onclick 依赖这些名字） ---------- */
  window.openThemeModal = openThemeModal;
  window.closeThemeModal = closeThemeModal;
  window.selectPresetColor = selectPresetColor;
  window.applyThemeColor = applyThemeColor;
  window.applyGlobalThemeColor = applyGlobalThemeColor;

  /* ---------- 启动：应用本地已存色 → 服务端同步校正 ---------- */
  loadSavedThemeColor();
  serverSync();

  /* ---------- 登录壁纸（登录页背景）：内置接口 + 自定义直链 ---------- */
  // 下拉「自定义」时显示直链输入框；其余来源固定 URL
  var BG_API = {
    elaina: 'https://api.elaina.cat/random/',
    yeqing: 'https://api.yppp.net/api.php',
    uapis: 'https://uapis.cn/api/v1/random/image'
  };
  // 从所选来源解析一张图片 URL；内置接口直接作为背景图地址（接口 302 跳图）
  function resolveBgUrl(src, customUrl) {
    if (src === 'builtin' || !src) return '';
    if (src === 'custom') return String(customUrl || '').trim();
    return BG_API[src] || '';
  }
  // 登录页首帧背景设置：读配置（BgSource 值：builtin/elaina/yeqing/uapis/custom），自定义时读 BgCustomUrl
  // 配置来自 /api/theme（服务端 D1）；未配置回落源站壁纸（login.html 静态 banner）
  function initLoginBg() {
    var src = '';
    var custom = '';
    try { src = localStorage.getItem('sf_warp_bg_source') || ''; } catch (e) {}
    try { custom = localStorage.getItem('sf_warp_bg_custom') || ''; } catch (e) {}
    var url = resolveBgUrl(src, custom);
    if (!url) return;
    var slides = document.querySelector('.bg-slides');
    if (slides) {
      // 登录页 .bg-slide 是纯 CSS 背景图，换成接口图
      var slide = slides.querySelector('.bg-slide');
      if (slide) slide.style.backgroundImage = 'url(' + url + ')';
    }
  }
  initLoginBg();

  /* ---------- 高级设置「全站主题」卡片：色点/hex 跟随当前主题色 ---------- */
  function syncGlobalThemeCard() {
    var dot = document.getElementById('themeColorDot');
    if (!dot) return;
    // 全站主题卡片只显示「全站色」（sf_warp_global_theme / 服务端 ThemeColor）；
    // 未设置时回落默认蓝，不用访客本地 theme-color —— 全站色与本地主题是两回事
    var c = lsGet('sf_warp_global_theme') || '';
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) c = '#1677ff';
    dot.style.background = c;
  }
  syncGlobalThemeCard();
  // 弹窗每次打开时刷新卡片（弹窗内 onChange 会改 currentColor，关闭前点应用已由 applyGlobalThemeColor 刷新）
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncGlobalThemeCard);
  else syncGlobalThemeCard();

  /* ---------- 动态 favicon（原 js/favicon.js 并入）：徽章底色跟随主题色 ---------- */
  (function () {
    var DEFAULT = '#1677ff';
    function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
    // 与外层 hexToHsl 规则不同（支持 #abc 三位缩写），独立命名避免遮蔽
    function favHexToHsl(hex) {
      var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
      if (!m) return null;
      var h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var r = parseInt(h.slice(0, 2), 16) / 255,
          g = parseInt(h.slice(2, 4), 16) / 255,
          b = parseInt(h.slice(4, 6), 16) / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      var hue = 0;
      if (d) {
        if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) hue = ((b - r) / d + 2) * 60;
        else hue = ((r - g) / d + 4) * 60;
      }
      var l = (max + min) / 2;
      var s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
      return { h: hue, s: s * 100, l: l * 100 };
    }
    function favHslToHex(h, s, l) {
      s /= 100; l /= 100;
      var k = function (n) { return (n + h / 30) % 12; };
      var a = s * Math.min(l, 1 - l);
      var f = function (n) {
        var c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return Math.round(clamp(c, 0, 1) * 255);
      };
      var to2 = function (n) { return ('0' + n.toString(16)).slice(-2); };
      return '#' + to2(f(0)) + to2(f(8)) + to2(f(4));
    }
    // 渐变端点与 applyVars 的派生规则一致：亮端 +15 明度、暗端 -10 明度
    function buildSvg(base) {
      var hsl = favHexToHsl(base);
      if (!hsl) return null;
      var light = favHslToHex(hsl.h, hsl.s, clamp(hsl.l + 15, 0, 90));
      var dark = favHslToHex(hsl.h, hsl.s, clamp(hsl.l - 10, 10, 100));
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
        + '<defs>'
        + '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        + '<stop offset="0" stop-color="' + light + '"/>'
        + '<stop offset=".55" stop-color="' + base + '"/>'
        + '<stop offset="1" stop-color="' + dark + '"/>'
        + '</linearGradient>'
        + '<linearGradient id="sh" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="#FFFFFF" stop-opacity=".32"/>'
        + '<stop offset=".5" stop-color="#FFFFFF" stop-opacity="0"/>'
        + '</linearGradient>'
        + '</defs>'
        + '<rect width="96" height="96" rx="22" fill="url(#bg)"/>'
        + '<rect width="96" height="96" rx="22" fill="url(#sh)"/>'
        // 云朵（白色，叠在渐变底上；与 favicon.svg 同款）
        + '<path fill="#FFFFFF" transform="scale(0.09375)"'
        + ' d="M597.333333 256c140.8 0 256 115.2 256 256s-115.2 256-256 256H341.333333c-93.866667 0-170.666667-76.8-170.666666-170.666667 0-85.333333 59.733333-153.6 140.8-166.4l38.4-8.533333 21.333333-34.133333C418.133333 307.2 503.466667 256 597.333333 256m0-85.333333c-128 0-238.933333 68.266667-298.666666 174.933333-119.466667 17.066667-213.333333 123.733333-213.333334 251.733333 0 140.8 115.2 256 256 256h256c187.733333 0 341.333333-153.6 341.333334-341.333333s-153.6-341.333333-341.333334-341.333333z"/>'
        + '</svg>';
    }
    function currentColor() {
      var saved = lsGet('theme-color');
      if (!saved) {
        try { saved = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(); } catch (e) {}
      }
      return favHexToHsl(saved) ? saved : DEFAULT;
    }
    function refresh() {
      var svg = buildSvg(currentColor());
      if (!svg) return;
      var uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
      var link = document.querySelector('link[rel="icon"]');
      if (link) link.href = uri;
      var imgs = document.querySelectorAll('img[src*="favicon"]');
      for (var i = 0; i < imgs.length; i++) imgs[i].src = uri;
    }
    faviconRefresh = refresh;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
    else refresh();
  })();
})();
