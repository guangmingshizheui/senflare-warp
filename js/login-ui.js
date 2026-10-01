/**
 * Senflare Warp — Login 登录逻辑
 */
(function () {
    var REMEMBER_KEY = 'sf_warp_remember';           // 记住密码：本地存账号密码，下次自动回填
    var GUEST_REMEMBER_KEY = 'sf_warp_guest_remember'; // 访客记住密码：与管理员分开存储

    function showToast(msg, isError) {
        var t = document.getElementById('toast');
        if (!t || !msg) return;
        t.textContent = msg;
        t.classList.toggle('error', !!isError);
        t.classList.add('show');
        clearTimeout(t._timer);
        t._timer = setTimeout(function () { t.classList.remove('show'); }, 3000);
    }
    // api.js / theme.js 的错误提示走 window.showToast（同 admin-ui.js），必须挂到全局否则登录失败无提示
    window.showToast = showToast;

    // 记住的账号密码（管理员 / 访客分开存储，勾选「记住密码」登录过才会存在）
    // 默认打开的是访客模式，管理员密码绝不能误填进访客密码框
    var savedCreds = null, savedGuest = null;
    try { savedCreds = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null'); } catch (e) {}
    try { savedGuest = JSON.parse(localStorage.getItem(GUEST_REMEMBER_KEY) || 'null'); } catch (e) {}
    if (savedCreds && !savedCreds.u) savedCreds = null;
    if (savedGuest && !savedGuest.p) savedGuest = null;

    // 自动登录：已有未过期令牌直接进后台
    (function checkAutoLogin() {
        if (!window.LiteAPI) return;                 // API 层缺失时不拦截（纯静态预览）
        if (!window.LiteAPI.loginExpired()) { /* 预览 UI 时注释掉下面这行 */ // location.replace('sf-admin.html');
        }
    })();

    // ==================== 管理员 / 访客 双模式（默认访客登录） ====================
    // 访客登录：仅输入访客密码，进入后面板只开放 数据看板 / 节点订阅 / 关于我们（角色编码在令牌内）
    var loginMode = 'admin';
    var loginTitle = document.getElementById('loginTitle');
    var userGroup = document.getElementById('userGroup');
    var rememberRow = document.getElementById('rememberRow');
    var submitBtn = document.getElementById('adminLoginBtn');
    var guestBtn = document.getElementById('guestBtn');
    var divider = document.getElementById('guestDivider');
    var pwdInput = document.getElementById('password');
    var guestLocked = false;                                 // 服务端关闭访客入口后置真

    function setLoginMode(mode) {
        if (guestLocked && mode === 'guest') mode = 'admin'; // 访客入口已关闭：强制管理员模式
        loginMode = mode;
        var guest = mode === 'guest';
        if (userGroup) userGroup.style.display = guest ? 'none' : '';
        // 隐藏的 required 字段会触发浏览器原生校验拦下表单提交，切模式时同步去留
        var userInput = document.getElementById('username');
        if (userInput) userInput.required = !guest;
        if (rememberRow) rememberRow.style.display = '';         // 两种模式都有记住密码
        if (loginTitle) loginTitle.textContent = guest ? '访客登录' : '管理员登录';
        if (submitBtn) submitBtn.textContent = guest ? '访客登录' : '登 录';
        if (guestBtn) guestBtn.textContent = guest ? '管理员登录' : '访客登录';
        if (divider) divider.style.display = '';                 // 分隔线两种模式都显示
        if (pwdInput) {
            pwdInput.placeholder = guest ? '请输入访客密码' : '请输入管理员密码';
            var lbl = document.getElementById('pwdLabel');
            if (lbl) lbl.textContent = guest ? '密码' : '密码';
        }
        // 切换模式清空密码框，再按当前模式回填各自记住的密码（避免两种密码串框）
        var rEl = document.getElementById('rememberPwd');
        if (pwdInput) pwdInput.value = '';
        if (guest) {
            if (savedGuest && pwdInput) pwdInput.value = savedGuest.p || '';
            if (rEl) rEl.checked = !!(savedGuest && savedGuest.p);
        } else {
            if (savedCreds && userInput && savedCreds.u) userInput.value = savedCreds.u;
            if (savedCreds && pwdInput) pwdInput.value = savedCreds.p || '';
            if (rEl) rEl.checked = !!savedCreds;
        }
    }
    // 模式切换：访客页 →「管理员登录」，管理员页 →「访客登录」
    if (guestBtn) guestBtn.addEventListener('click', function () {
        setLoginMode(loginMode === 'guest' ? 'admin' : 'guest');
        if (pwdInput) pwdInput.focus();
    });
    setLoginMode('guest');                                   // 默认打开访客登录

    // 访客入口随服务端开关显隐（安全设置关闭 GuestEnabled 后回到管理员登录）
    if (window.LiteAPI) {
        fetch((window.LiteAPI.API_BASE || '') + '/api/theme').then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
            if (t && t.guestEnabled === false) {
                guestLocked = true;
                if (divider) divider.style.display = 'none';
                if (guestBtn) guestBtn.style.display = 'none';
                if (loginMode === 'guest') setLoginMode('admin');
            }
        }).catch(function () {});
    }

    document.getElementById('loginForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var isGuestMode = loginMode === 'guest';
        var username = document.getElementById('username').value.trim();
        var password = document.getElementById('password').value;
        var btn = document.getElementById('adminLoginBtn');

        if (!password || (!isGuestMode && !username)) {
            showToast(isGuestMode ? '请输入访客密码' : '请输入账号和密码', true);
            return;
        }

        var remember = document.getElementById('rememberPwd').checked;
        btn.textContent = isGuestMode ? '验证中...' : '验证中...';
        btn.disabled = true;

        var r = !window.LiteAPI ? null : (isGuestMode
            ? await window.LiteAPI.guestLogin(password)
            : await window.LiteAPI.login(username, password));
        if (!r || !r.token) {
            btn.textContent = isGuestMode ? '访客登录' : '登 录';
            btn.disabled = false;
            return;                                   // 错误 Toast 已由 API 层统一弹出
        }

        try {
            window.LiteAPI.setToken(r.token);         // 令牌必须落库，否则后续所有 /api 调用都是未授权
            localStorage.setItem('sf_warp_login_time', String(Date.now()));
            if (isGuestMode) {
                if (remember) { savedGuest = { p: password }; localStorage.setItem(GUEST_REMEMBER_KEY, JSON.stringify(savedGuest)); }
                else { savedGuest = null; localStorage.removeItem(GUEST_REMEMBER_KEY); }
            } else {
                if (remember) { savedCreds = { u: username, p: password }; localStorage.setItem(REMEMBER_KEY, JSON.stringify(savedCreds)); }
                else { savedCreds = null; localStorage.removeItem(REMEMBER_KEY); }
            }
        } catch (e) {}
        showToast(isGuestMode ? '访客登录成功' : '登录成功');
        // 留 900ms 让成功 Toast 可见（toast 淡入需 0.3s，原 400ms 页面已跳走等于没显示）
        setTimeout(function () { location.href = 'sf-admin.html'; }, 900);
    });

    // ==================== 登录页壁纸（刷新随机一张，停留期间静止） ====================
    // 图源：Firefly 主题 banner（assets/images/wallpapers/）。
    // 刷新时在 6 张中随机挑一张静止展示，不再 8s 自动轮播。
    // 桌面横版 / 移动竖版两套，按 1024px 断点选用。
    var WALLPAPERS_DESKTOP = [
        'assets/images/wallpapers/banner-1.webp',
        'assets/images/wallpapers/banner-2.webp',
        'assets/images/wallpapers/banner-3.webp'
    ];
    var WALLPAPERS_MOBILE = [
        'assets/images/wallpapers/banner-mobile-1.webp',
        'assets/images/wallpapers/banner-mobile-2.webp',
        'assets/images/wallpapers/banner-mobile-3.webp'
    ];
    (function initWallpaper() {
        // 已配置第三方/自定义壁纸时，交给 js/theme.js 的 initLoginBg() 处理（接口背景/自定义直链），
        // 本模块只负责「源站壁纸」随机；未配置/源站时才接管
        var bgSrc = '';
        try { bgSrc = localStorage.getItem('sf_warp_bg_source') || ''; } catch (e) {}
        if (bgSrc && bgSrc !== 'builtin') return;
        var root = document.getElementById('bgSlides');
        if (!root) return;
        var REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
        var isDesktop = !window.matchMedia || matchMedia('(min-width: 1024px)').matches;
        var list = isDesktop ? WALLPAPERS_DESKTOP : WALLPAPERS_MOBILE;
        var pick = list[Math.floor(Math.random() * list.length)];
        var cls = isDesktop ? 'only-desktop' : 'only-mobile';
        // 预加载选中图，成功后替换为单张静止背景；失败保留 HTML 首帧兜底
        var im = new Image();
        im.onload = function () {
            root.innerHTML = '';
            var slide = document.createElement('div');
            slide.className = 'bg-slide active ' + cls;
            if (REDUCED) slide.style.transition = 'none';
            slide.style.backgroundImage = 'url("' + pick + '")';
            root.appendChild(slide);
        };
        im.onerror = function () {
            // 加载失败：仍清理隐藏断点的冗余节点，仅保留可见那张
            var slides = root.querySelectorAll('.bg-slide');
            for (var i = slides.length - 1; i >= 0; i--) {
                if (slides[i].offsetParent === null) slides[i].remove();
            }
        };
        im.src = pick;
    })();
})();
