// 这里编写自定义js脚本；将被静态引入到页面中
/* ============================================
   Photography Page — O.G.
   放入: NotionNext/public/js/custom.js

   机制: custom.js 由 NotionNext 在每个页面自动注入。
   此脚本持续监听路由变化, 当路径为 /photography 时
   接管页面并动态构建摄影画廊; 离开时完整还原现场。

   重要: NotionNext 使用 Next.js 客户端路由, 站内点击
   链接走 history.pushState, 不触发页面重载也不触发
   popstate。因此这里同时 patch pushState/replaceState、
   监听 popstate, 并加轮询兜底。

   数据来源优先级:
   1. Notion 页面正文里的 code block (JSON 格式)
      → 在 Notion 里直接管理照片, 无需改代码
   2. Notion 页面正文里的 image block
      → 直接在 Notion 页面里拖图片, 自动提取
   3. /photos.json (静态文件兜底)
   4. 内置 FALLBACK (避免空白)
   ============================================ */

(function () {
  'use strict';

  /* ---------- 配置 ---------- */
  var CONFIG = {
    path: '/photography',
    dataUrl: '/photos.json',
    categories: {
      street: '街拍',
      portrait: '人像',
      landscape: '风光',
      casual: '随拍'
    },
    brand: 'O.G.',
    title: 'Photography',
    pollInterval: 400,
    // Notion code block 的 JSON 标识标记
    // 在 Notion 页面正文里写一个 code block, 第一行写这个标记
    // 后面跟 JSON 数组, 脚本会自动识别并提取
    notionJsonTag: 'og-photography-data',
    // 等待 NotionNext 渲染 DOM 的最大时间(ms)
    notionWaitTimeout: 6000
  };

  /* ---------- 路径匹配 ---------- */
  function isPhotographyPage() {
    var p = window.location.pathname.replace(/\/+$/, '');
    p = p.replace(/\.html$/, '');
    return p === CONFIG.path || p === CONFIG.path + '/index';
  }

  /* ---------- 工具 ---------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function labelOf(cat) {
    return CONFIG.categories[cat] || cat;
  }

  function log() {
    var args = ['[O.G. Photography]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    if (typeof console !== 'undefined' && console.log) console.log.apply(console, args);
  }

  /* ---------- 状态 ---------- */
  var photos = [];
  var photosLoaded = false;
  var root, gallery, emptyState, lightbox, lbImg, lbCaption, loadingHint;
  var filteredIndices = [];
  var currentIndex = 0;
  var styleEl = null;
  var mounted = false;
  var keydownHandler = null;
  var scrollHandler = null;
  var notionWaitTimer = null;

  /* ---------- 兜底数据 ---------- */
  var FALLBACK = [
    { src: 'https://images.unsplash.com/photo-1444723121867-7b2422116bbd?w=800&q=80', title: '城市黄昏', category: 'street', w: 800, h: 1000 },
    { src: 'https://images.unsplash.com/photo-1506794778132-b462deda8f3a?w=800&q=80', title: '街角人像', category: 'portrait', w: 800, h: 1000 },
    { src: 'https://images.unsplash.com/photo-1500530855697-58d8b0430f9a?w=800&q=80', title: '山间晨雾', category: 'landscape', w: 800, h: 1000 },
    { src: 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=800&q=80', title: '猫咪凝视', category: 'casual', w: 800, h: 533 }
  ];

  /* ---------- 从 NotionNext 渲染的 DOM 提取照片数据 ---------- */

  // 方式1: 从 code block 里提取 JSON
  function extractFromCodeBlocks() {
    var blocks = document.querySelectorAll('pre code, pre, code');
    for (var i = 0; i < blocks.length; i++) {
      var text = blocks[i].textContent || blocks[i].innerText || '';
      text = text.trim();
      if (text.indexOf(CONFIG.notionJsonTag) === -1) continue;

      // 去掉标记行, 提取 JSON
      var jsonStr = text.replace(CONFIG.notionJsonTag, '').trim();
      // 尝试找到 JSON 数组的起始
      var arrStart = jsonStr.indexOf('[');
      var arrEnd = jsonStr.lastIndexOf(']');
      if (arrStart === -1 || arrEnd === -1) continue;

      jsonStr = jsonStr.substring(arrStart, arrEnd + 1);
      try {
        var data = JSON.parse(jsonStr);
        if (Array.isArray(data) && data.length > 0) {
          // 验证每条记录至少有 src 字段
          var valid = data.filter(function (p) {
            return p && typeof p.src === 'string' && p.src.length > 0;
          });
          if (valid.length > 0) {
            log('从 Notion code block 提取到 ' + valid.length + ' 张照片');
            return valid;
          }
        }
      } catch (e) {
        log('Code block JSON 解析失败:', e.message);
      }
    }
    return null;
  }

  // 方式2: 从 Notion 页面正文里直接提取 image block
  function extractFromNotionImages() {
    // NotionNext 渲染的图片通常在 .notion-page-content 或 article 内
    var containers = document.querySelectorAll(
      '.notion-page-content, article, [class*="notion-page"], #article-wrapper, .notion-text'
    );
    if (!containers.length) return null;

    var imgs = [];
    containers.forEach(function (c) {
      var images = c.querySelectorAll('img');
      images.forEach(function (img) {
        var src = img.src || img.getAttribute('data-src') || '';
        if (!src) return;
        // 过滤掉 icon、avatar 等小图
        if (src.indexOf('favicon') > -1) return;
        if (img.width && img.width < 100) return;
        if (img.closest('.notion-page-icon, .notion-collection, .notion-header')) return;

        // 尝试从前面的 text block 提取标题和分类
        var prev = img.closest('.notion-text, figure, p, div');
        var title = '';
        var category = 'casual';
        if (prev) {
          var text = prev.textContent || '';
          // 尝试匹配 "分类:标题" 格式 或 "#分类 标题" 格式
          var match = text.match(/#(street|portrait|landscape|casual)\s*(.*)/i);
          if (match) {
            category = match[1].toLowerCase();
            title = match[2].trim();
          } else {
            title = text.trim().split('\n')[0].substring(0, 50);
          }
        }

        imgs.push({
          src: src,
          title: title || 'Untitled',
          category: category,
          w: img.naturalWidth || img.width || 800,
          h: img.naturalHeight || img.height || 600
        });
      });
    });

    if (imgs.length > 0) {
      log('从 Notion 页面图片提取到 ' + imgs.length + ' 张照片');
      return imgs;
    }
    return null;
  }

  // 主提取函数: 依次尝试各种数据源
  function extractFromNotion() {
    // 方式1: code block JSON
    var fromCode = extractFromCodeBlocks();
    if (fromCode) return fromCode;

    // 方式2: 页面图片
    var fromImgs = extractFromNotionImages();
    if (fromImgs) return fromImgs;

    return null;
  }

  /* ---------- 构建 UI ---------- */
  function buildUI() {
    root = el('div');
    root.id = 'og-photography';

    // 导航栏
    var nav = el('nav', 'og-navbar');
    var navInner = el('div', 'og-navbar-inner');
    navInner.appendChild(el('div', 'og-brand', '<a href="/">' + CONFIG.brand + '</a>'));

    var links = el('ul', 'og-nav-links');
    links.id = 'ogNavLinks';
    links.appendChild(el('li', null, '<a href="/">首页</a>'));
    links.appendChild(el('li', null, '<a href="/tag">标签</a>'));
    navInner.appendChild(links);

    var back = el('a', 'og-back', '\u2190 返回博客');
    back.href = '/';
    navInner.appendChild(back);

    var toggle = el('button', 'og-menu-toggle', '\u2630');
    toggle.setAttribute('aria-label', '菜单');
    navInner.appendChild(toggle);
    nav.appendChild(navInner);
    root.appendChild(nav);

    toggle.addEventListener('click', function () {
      links.classList.toggle('og-open');
    });

    // 英雄区
    var hero = el('section', 'og-hero');
    hero.appendChild(el('h1', null, CONFIG.title));
    root.appendChild(hero);

    // 筛选栏
    var bar = el('div', 'og-filter-bar');
    bar.appendChild(filterBtn('all', '全部', true));
    Object.keys(CONFIG.categories).forEach(function (key) {
      bar.appendChild(filterBtn(key, CONFIG.categories[key], false));
    });
    root.appendChild(bar);

    // 加载提示 (Notion 数据异步加载时显示)
    loadingHint = el('div', 'og-loading', '<div class="og-spinner"></div><p>正在加载照片...</p>');
    root.appendChild(loadingHint);

    // 画廊
    gallery = el('div', 'og-gallery');
    root.appendChild(gallery);

    // 空状态
    emptyState = el('div', 'og-empty', '<h3>暂无作品</h3><p>该分类下还没有照片，敬请期待。</p>');
    root.appendChild(emptyState);

    // Lightbox
    lightbox = el('div', 'og-lightbox');
    var lbClose = el('button', 'og-lightbox-close', '\u00D7');
    lbClose.setAttribute('aria-label', '关闭');
    var lbPrev = el('button', 'og-lightbox-nav og-lightbox-prev', '\u2039');
    lbPrev.setAttribute('aria-label', '上一张');
    lbImg = el('img', 'og-lightbox-img');
    var lbNext = el('button', 'og-lightbox-nav og-lightbox-next', '\u203A');
    lbNext.setAttribute('aria-label', '下一张');
    lbCaption = el('div', 'og-lightbox-caption');

    lightbox.appendChild(lbClose);
    lightbox.appendChild(lbPrev);
    lightbox.appendChild(lbImg);
    lightbox.appendChild(lbNext);
    lightbox.appendChild(lbCaption);
    root.appendChild(lightbox);

    // 页脚
    root.appendChild(
      el('footer', 'og-footer',
        '<p>\u00A9 ' + new Date().getFullYear() + ' ' + CONFIG.brand +
        ' \u00B7 <a href="/">guohaobo.com</a></p>')
    );

    // 事件
    lbClose.addEventListener('click', closeLightbox);
    lbNext.addEventListener('click', function () { step(1); });
    lbPrev.addEventListener('click', function () { step(-1); });
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });
    keydownHandler = function (e) {
      if (!lightbox.classList.contains('og-open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', keydownHandler);

    scrollHandler = function () {
      nav.style.background = window.pageYOffset > 80 ? 'rgba(10,10,10,0.95)' : 'rgba(10,10,10,0.85)';
    };
    window.addEventListener('scroll', scrollHandler);

    return root;
  }

  function filterBtn(value, text, active) {
    var b = el('button', 'og-filter-btn' + (active ? ' og-active' : ''), text);
    b.dataset.filter = value;
    b.addEventListener('click', function () {
      var all = root.querySelectorAll('.og-filter-btn');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('og-active');
      b.classList.add('og-active');
      renderGallery(value);
    });
    return b;
  }

  /* ---------- 渲染 ---------- */
  function renderGallery(filter) {
    if (!gallery) return;
    gallery.innerHTML = '';
    var count = 0;

    photos.forEach(function (photo, index) {
      if (filter !== 'all' && photo.category !== filter) return;

      var item = el('div', 'og-gallery-item');
      var img = el('img');
      img.src = photo.src;
      img.alt = photo.title || '';
      img.loading = 'lazy';
      if (photo.w) img.width = photo.w;
      if (photo.h) img.height = photo.h;

      var ov = el('div', 'og-overlay');
      ov.appendChild(el('div', 'og-overlay-title', photo.title || ''));
      ov.appendChild(el('div', 'og-overlay-meta', labelOf(photo.category)));

      item.appendChild(img);
      item.appendChild(ov);
      item.addEventListener('click', function () { openLightbox(index); });

      gallery.appendChild(item);
      count++;
    });

    if (loadingHint) loadingHint.style.display = 'none';
    emptyState.classList.toggle('og-visible', count === 0);
  }

  /* ---------- Lightbox ---------- */
  function currentFilter() {
    var active = root.querySelector('.og-filter-btn.og-active');
    return active ? active.dataset.filter : 'all';
  }

  function computeIndices(filter) {
    var out = [];
    photos.forEach(function (p, i) {
      if (filter === 'all' || p.category === filter) out.push(i);
    });
    return out;
  }

  function openLightbox(index) {
    if (!photos.length) return;
    filteredIndices = computeIndices(currentFilter());
    var pos = filteredIndices.indexOf(index);
    currentIndex = pos === -1 ? 0 : pos;
    showImage();
    lightbox.classList.add('og-open');
    document.body.style.overflow = 'hidden';
  }

  function showImage() {
    var photo = photos[filteredIndices[currentIndex]];
    if (!photo) return;
    var src = photo.src;
    if (/w=\d+/.test(src)) src = src.replace(/w=\d+/, 'w=1600');
    lbImg.src = src;
    lbImg.alt = photo.title || '';
    lbCaption.textContent = (photo.title || '') + ' \u00B7 ' + labelOf(photo.category);
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('og-open');
    document.body.style.overflow = '';
  }

  function step(dir) {
    if (!filteredIndices.length) return;
    currentIndex = (currentIndex + dir + filteredIndices.length) % filteredIndices.length;
    showImage();
  }

  /* ---------- 加载数据 ---------- */

  // 尝试从 Notion DOM 提取, 带重试 (NotionNext 异步渲染)
  function tryLoadFromNotion(retriesLeft, onDone) {
    if (notionWaitTimer) {
      clearTimeout(notionWaitTimer);
      notionWaitTimer = null;
    }

    var data = extractFromNotion();
    if (data) {
      photos = data;
      photosLoaded = true;
      if (mounted) renderGallery('all');
      onDone(true);
      return;
    }

    if (retriesLeft > 0) {
      log('Notion DOM 尚未渲染, 剩余重试 ' + retriesLeft + ' 次');
      notionWaitTimer = setTimeout(function () {
        tryLoadFromNotion(retriesLeft - 1, onDone);
      }, 500);
    } else {
      onDone(false);
    }
  }

  function loadPhotos() {
    if (photosLoaded) {
      renderGallery('all');
      return;
    }

    // 策略: 先尝试从 Notion DOM 提取 (最多等 6 秒)
    // 失败后退回 photos.json
    // 再失败用 FALLBACK
    var maxRetries = Math.floor(CONFIG.notionWaitTimeout / 500); // 12 次

    tryLoadFromNotion(maxRetries, function (success) {
      if (success) return;
      log('Notion DOM 无数据, 退回 photos.json');

      fetch(CONFIG.dataUrl, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          var list = Array.isArray(data) ? data : data.photos;
          photos = Array.isArray(list) && list.length ? list : FALLBACK;
          photosLoaded = true;
          if (mounted) renderGallery('all');
        })
        .catch(function () {
          log('photos.json 也失败, 使用兜底数据');
          photos = FALLBACK;
          photosLoaded = true;
          if (mounted) renderGallery('all');
        });
    });
  }

  /* ---------- 接管 / 还原 ---------- */
  function mount() {
    if (mounted) return;
    mounted = true;

    var ui = buildUI();

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'og-photo-style';
      styleEl.textContent =
        'body.og-photo-active > *:not(#og-photography){display:none !important;}' +
        'body.og-photo-active{margin:0 !important;padding:0 !important;}';
      document.head.appendChild(styleEl);
    }

    document.body.classList.add('og-photo-active');
    document.body.appendChild(ui);

    loadPhotos();
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;

    if (notionWaitTimer) {
      clearTimeout(notionWaitTimer);
      notionWaitTimer = null;
    }

    closeLightbox();

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler);
      scrollHandler = null;
    }

    document.body.classList.remove('og-photo-active');
    document.body.style.overflow = '';

    var n = document.getElementById('og-photography');
    if (n) n.remove();

    root = gallery = emptyState = lightbox = lbImg = lbCaption = loadingHint = null;
    filteredIndices = [];
    currentIndex = 0;
  }

  /* ---------- 路由检测 ---------- */
  var lastPath = null;

  function routeCheck() {
    var p = window.location.pathname;
    if (p === lastPath) return;
    lastPath = p;

    var want = isPhotographyPage();
    if (want && !mounted) mount();
    else if (!want && mounted) unmount();
  }

  function scheduleCheck() {
    [0, 50, 150, 400].forEach(function (d) {
      setTimeout(routeCheck, d);
    });
  }

  /* ---------- 劫持 Next.js 客户端路由 ---------- */
  var origPush = history.pushState;
  var origReplace = history.replaceState;

  history.pushState = function () {
    var r = origPush.apply(this, arguments);
    scheduleCheck();
    return r;
  };
  history.replaceState = function () {
    var r = origReplace.apply(this, arguments);
    scheduleCheck();
    return r;
  };

  window.addEventListener('popstate', scheduleCheck);
  window.addEventListener('hashchange', scheduleCheck);

  setInterval(routeCheck, CONFIG.pollInterval);

  /* ---------- 启动 ---------- */
  function boot() {
    lastPath = window.location.pathname;
    if (isPhotographyPage()) mount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(boot, 0);
      scheduleCheck();
    });
  } else {
    boot();
    scheduleCheck();
  }
})();


