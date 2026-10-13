// 这里编写自定义js脚本；将被静态引入到页面中

/* ============================================
   Photography Page — O.G.
   放入: NotionNext/public/js/custom.js

   机制: custom.js 由 NotionNext 在每个页面自动注入。
   此脚本检测当前路径, 仅当访问 /photography 时
   接管整个页面并动态构建摄影画廊 UI。
   其他页面不受任何影响。
   ============================================ */

(function () {
  'use strict';

  /* ---------- 配置 ---------- */
  var CONFIG = {
    // 触发页面的路径
    path: '/photography',
    // 照片数据文件位置(放在 NotionNext/public/ 下)
    dataUrl: '/photos.json',
    // 分类标签: 值 -> 显示名
    categories: {
      street: '街拍',
      portrait: '人像',
      landscape: '风光',
      casual: '随拍'
    },
    brand: 'O.G.',
    title: 'Photography'
  };

  /* ---------- 路径匹配 ---------- */
  function isPhotographyPage() {
    var p = window.location.pathname.replace(/\/+$/, ''); // 去尾部斜杠
    p = p.replace(/\.html$/, ''); // 兼容伪静态
    return p === CONFIG.path || p === CONFIG.path + '/index';
  }

  if (!isPhotographyPage()) return; // 非摄影页, 直接退出

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

  /* ---------- 构建 UI ---------- */
  var photos = [];
  var root, gallery, emptyState, lightbox, lbImg, lbCaption;
  var filteredIndices = [];
  var currentIndex = 0;

  function buildUI() {
    // 主体容器
    root = el('div');
    root.id = 'og-photography';

    // 导航栏
    var nav = el('nav', 'og-navbar');
    var navInner = el('div', 'og-navbar-inner');
    navInner.appendChild(
      el('div', 'og-brand', '<a href="/">' + CONFIG.brand + '</a>')
    );

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

    // 画廊
    gallery = el('div', 'og-gallery');
    root.appendChild(gallery);

    // 空状态
    emptyState = el(
      'div',
      'og-empty',
      '<h3>暂无作品</h3><p>该分类下还没有照片，敬请期待。</p>'
    );
    root.appendChild(emptyState);

    // Lightbox
    lightbox = el('div', 'og-lightbox');
    var lbClose = el('button', 'og-lightbox-close', '\u00D7');
    lbClose.setAttribute('aria-label', '关闭');
    var lbPrev = el('button', 'og-lightbox-nav og-lightbox-prev', '\u2039');
    lbPrev.setAttribute('aria-label', '上一张');
    lbImg = el('img', 'og-lightbox-img');
    lbImg.src = '';
    lbImg.alt = '';
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
      el(
        'footer',
        'og-footer',
        '<p>\u00A9 ' +
          new Date().getFullYear() +
          ' ' +
          CONFIG.brand +
          ' \u00B7 <a href="/">guohaobo.com</a></p>'
      )
    );

    // Lightbox 事件
    lbClose.addEventListener('click', closeLightbox);
    lbNext.addEventListener('click', function () {
      step(1);
    });
    lbPrev.addEventListener('click', function () {
      step(-1);
    });
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('og-open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    });

    // 导航栏滚动效果
    window.addEventListener('scroll', function () {
      nav.style.background =
        window.pageYOffset > 80
          ? 'rgba(10,10,10,0.95)'
          : 'rgba(10,10,10,0.85)';
    });

    return root;
  }

  function filterBtn(value, text, active) {
    var b = el(
      'button',
      'og-filter-btn' + (active ? ' og-active' : ''),
      text
    );
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
    gallery.innerHTML = '';
    var count = 0;

    photos.forEach(function (photo, index) {
      if (filter !== 'all' && photo.category !== filter) return;

      var item = el('div', 'og-gallery-item');
      item.dataset.index = index;

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
      item.addEventListener('click', function () {
        openLightbox(index);
      });

      gallery.appendChild(item);
      count++;
    });

    emptyState.classList.toggle('og-visible', count === 0);
  }

  /* ---------- Lightbox 逻辑 ---------- */
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
    // Unsplash 等支持尺寸参数的图源, 放大时取更高分辨率
    if (/w=\d+/.test(src)) src = src.replace(/w=\d+/, 'w=1600');
    lbImg.src = src;
    lbImg.alt = photo.title || '';
    lbCaption.textContent =
      (photo.title || '') + ' \u00B7 ' + labelOf(photo.category);
  }

  function closeLightbox() {
    lightbox.classList.remove('og-open');
    document.body.style.overflow = '';
  }

  function step(dir) {
    if (!filteredIndices.length) return;
    currentIndex =
      (currentIndex + dir + filteredIndices.length) % filteredIndices.length;
    showImage();
  }

  /* ---------- 加载数据 ---------- */
  function loadPhotos(cb) {
    fetch(CONFIG.dataUrl, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var list = Array.isArray(data) ? data : data.photos;
        cb(Array.isArray(list) ? list : []);
      })
      .catch(function (err) {
        console.warn('[O.G. Photography] 无法加载 ' + CONFIG.dataUrl, err);
        cb([]);
      });
  }

  /* ---------- 接管页面 ---------- */
  function mount() {
    if (document.getElementById('og-photography')) return; // 防重复

    var ui = buildUI();

    // 隐藏 NotionNext 原有的页面内容, 让摄影页完全接管
    var style = document.createElement('style');
    style.textContent =
      'body.og-photo-active > *:not(#og-photography){display:none !important;}' +
      'body.og-photo-active{margin:0;padding:0;}';
    document.head.appendChild(style);

    document.body.classList.add('og-photo-active');
    document.body.appendChild(ui);

    loadPhotos(function (list) {
      photos = list;
      renderGallery('all');
    });
  }

  /* ---------- 启动 ---------- */
  function start() {
    mount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(start, 0);
    });
  } else {
    setTimeout(start, 0);
  }

  // NotionNext 客户端路由切换后重新检测
  window.addEventListener('popstate', function () {
    if (isPhotographyPage()) {
      if (!document.getElementById('og-photography')) start();
    } else if (document.body.classList.contains('og-photo-active')) {
      document.body.classList.remove('og-photo-active');
      var n = document.getElementById('og-photography');
      if (n) n.remove();
    }
  });
})();
