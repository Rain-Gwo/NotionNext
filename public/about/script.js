/* ============================================================
   Oliver Guo · About Page · 动效
   ============================================================ */

// 标记 JS 已启用（让 CSS 中的 [data-reveal] 初始隐藏）
document.documentElement.classList.add('js');

// ---------- 滚动揭示 ----------
const revealEls = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('is-in'));
}

// ---------- 中英切换 ----------
// 中英文分别固定在 data-zh（中文）/ data-en（英文）属性上，互不覆盖；
// 编辑器有时会把英文态写进 innerHTML，故加载时强制以 data-zh 复位为中文，
// 避免「切换按钮点了没反应」。
const langBtn = document.getElementById('langToggle');
const i18nEls = document.querySelectorAll('[data-en]');

// 兜底：若元素缺失 data-zh（被编辑器清空），用当前文本补上，避免切换后变空白
i18nEls.forEach((el) => {
  if (!el.getAttribute('data-zh')) el.setAttribute('data-zh', el.innerHTML);
});

let lang = 'zh';
function setLang(next) {
  i18nEls.forEach((el) => {
    el.innerHTML = next === 'en' ? el.getAttribute('data-en') : el.getAttribute('data-zh');
  });
  lang = next;
  document.documentElement.classList.toggle('is-en', next === 'en');
}

// 初始强制回到中文态（覆盖编辑器可能写入的英文 innerHTML / is-en class）
setLang('zh');

if (langBtn) {
  langBtn.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
}

// ---------- 主题切换（亮 / 暗） ----------
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    document.documentElement.classList.toggle('is-light');
  });
}

// ---------- 平滑锚点（兼容老浏览器） ----------
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length > 1) {
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });
});

// ---------- Hero 视频淡入（canplay 后再显示，避免空白跳变） ----------
const heroVideo = document.querySelector('.hero-video');
if (heroVideo) {
  const revealVideo = () => heroVideo.classList.add('is-ready');
  if (heroVideo.readyState >= 3) {
    revealVideo();
  } else {
    heroVideo.addEventListener('canplay', revealVideo, { once: true });
    heroVideo.addEventListener('loadeddata', revealVideo, { once: true });
    // 兜底：若事件未触发，2.5s 后强制显示
    setTimeout(revealVideo, 2500);
  }
}
