// 控制台品牌信息
console.log("%c Senflare Warp", "color:#fff;font-weight:700;background:linear-gradient(270deg,#986fee,#8695e6,#68b7dd,#18d7d3);padding:8px 15px;border-radius:15px");
console.log("%c Powered by 简睿 | TG @Senflare", "color:#FFD700;background:linear-gradient(135deg,#0a0a0a,#1a1a1a,#0a0a0a);padding:8px 15px;font-weight:700;border-radius:15px;text-shadow:0 0 10px rgba(255, 215, 0)");

/**
 * ==================== Senflare Warp - 落地页脚本 ====================
 * 仅落地页所需模块：头部滚动 / 打字机 / Canvas 网络动画 / 数字计数
 */

// ==================== 1. UI 交互 ====================
/** 头部滚动效果：滚动超过 50px 添加阴影 */
function initHeaderScroll() {
    const header = document.querySelector('.header');
    if (!header) return;
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 50);
    });
}

// ==================== 2. 视觉效果 ====================
/** 打字机效果（Hero 区域标题，循环） */
function initTypewriter() {
    const el = document.getElementById('heroTypewriter');
    if (!el) return;

    const texts = ['最快、最稳、最安全的网络加速服务'];

    let textIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    function type() {
        const currentText = texts[textIndex];

        if (isDeleting) {
            el.textContent = currentText.substring(0, charIndex - 1);
            charIndex--;
        } else {
            el.textContent = currentText.substring(0, charIndex + 1);
            charIndex++;
        }

        let delay = isDeleting ? 50 : 100;

        if (!isDeleting && charIndex === currentText.length) {
            delay = 3000;
            isDeleting = true;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            textIndex = (textIndex + 1) % texts.length;
            delay = 500;
        }

        setTimeout(type, delay);
    }

    setTimeout(type, 500);
}

/** Canvas 网络节点动画（Hero 背景，节点/连线跟随动态主题色） */
function initNetworkCanvas() {
    const canvas = document.getElementById('networkCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    // 每帧从 CSS 变量重读（单次读取开销可忽略），调色盘换色后粒子/连线实时跟随
    let rgb = (getComputedStyle(document.documentElement).getPropertyValue('--landing-rgb') || '22, 119, 255').trim();
    let nodes = [];
    let animationId;

    function resize() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        initNodes();
    }

    function initNodes() {
        nodes = [];
        const count = Math.min(25, Math.floor(canvas.width / 60));
        for (let i = 0; i < count; i++) {
            nodes.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                radius: 2 + Math.random() * 2
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        rgb = (getComputedStyle(document.documentElement).getPropertyValue('--landing-rgb') || '22, 119, 255').trim();

        // 绘制连线
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 150) {
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.strokeStyle = `rgba(${rgb}, ${0.15 * (1 - dist / 150)})`;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        // 绘制节点
        nodes.forEach(node => {
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${rgb}, 0.6)`;
            ctx.fill();

            // 更新位置
            node.x += node.vx;
            node.y += node.vy;

            // 边界反弹
            if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
            if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
        });

        animationId = requestAnimationFrame(draw);
    }

    resize();
    draw();

    window.addEventListener('resize', resize);

    // 清理函数（页面卸载时取消动画）
    window.addEventListener('beforeunload', () => {
        if (animationId) cancelAnimationFrame(animationId);
    });
}

// ==================== 4. 数字计数动画 ====================
function initCounterAnimation() {
    const counters = document.querySelectorAll('.counter');
    if (!counters.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}

function animateCounter(el) {
    const target = parseFloat(el.dataset.target);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1500;
    const startTime = performance.now();
    const isDecimal = target % 1 !== 0;

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // easeOutQuart 缓动
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = target * eased;

        el.textContent = prefix + (isDecimal ? current.toFixed(1) : Math.floor(current)) + suffix;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            el.textContent = prefix + (isDecimal ? target.toFixed(1) : target) + suffix;
        }
    }

    requestAnimationFrame(update);
}

// ==================== 初始化 ====================
window.addEventListener('DOMContentLoaded', () => {
    initHeaderScroll();
    initTypewriter();
    initNetworkCanvas();
    initCounterAnimation();
});

