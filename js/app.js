/* 二人食记 — 前端逻辑
   两种模式：
   - 服务模式（通过 server.js 访问）：可添加 / 编辑 / 删除，数据写回 data/data.js
   - 只读模式（直接双击 index.html）：只能浏览 */

(function () {
  'use strict';

  var MEAL_ORDER = ['早餐', '午餐', '晚餐', '加餐'];
  var CATEGORY_ORDER = ['自制', '外食'];

  var state = {
    meals: [],
    serverMode: false,
    meal: null,          // 当前餐次筛选
    tag: null,           // 当前标签筛选
    category: null,      // 当前分类筛选（'自制' | '外食' | '未分类'）
    site: { title: '', subtitle: '', footer: '' },
    collapsedMonths: {}, // 折叠的月份：{ 'YYYY-MM': true }
    collapsedYears: {},  // 折叠的年份：{ 'YYYY': true }
    collapsedDays: {},   // 折叠的日期：{ 'YYYY-MM-DD': true }
    viewMode: 'list',    // 'list' 列表 | 'calendar' 日历
    calYear: 0,          // 日历当前显示的年
    calMonth: 0,         // 日历当前显示的月（1-12）
    calSelected: '',     // 日历中选中的日期 'YYYY-MM-DD'（空 = 未选中）
    zoom: 1,             // 页面缩放
    viewZoom: 1,         // 详情页照片缩放
    viewPhotos: [],      // 详情页当前餐的照片数组
    viewIndex: 0,        // 详情页当前显示第几张
    customBg: '',        // 自定义外层背景色（紫色区域）
    customSheet: '',     // 自定义内页颜色（米色纸面）
    titleFont: '',       // 自定义标题字体（空 = 默认）
    bodyFont: '',        // 自定义正文字体（空 = 默认）
    inkColor: '',        // 自定义字体颜色（空 = 默认）
    dialog: { mode: 'add', id: null, photos: [] }
  };

  function $(id) { return document.getElementById(id); }

  /** 归一读取照片数组：新数据 photos / 旧数据 photo / 都没有 → 空 */
  function mealPhotos(m) {
    if (!m) return [];
    if (Array.isArray(m.photos) && m.photos.length) return m.photos;
    return m.photo ? [m.photo] : [];
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mealRank(m) {
    var i = MEAL_ORDER.indexOf(m);
    return i === -1 ? MEAL_ORDER.length : i;
  }

  function sortMeals(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return mealRank(a.meal) - mealRank(b.meal);
    });
  }

  function monthKey(m) { return m.date.slice(0, 7); }

  function monthLabel(key) {
    return key.slice(0, 4) + '年' + (+key.slice(5, 7)) + '月';
  }

  function dateLabel(date) {
    var p = String(date).split('-');
    return p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日';
  }

  function fmtDate(date) {
    var p = String(date).split('-');
    return (+p[1]) + '月' + (+p[2]) + '日';
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function loadViewMode() {
    try {
      var v = localStorage.getItem('ershi-view');
      if (v === 'calendar' || v === 'list') state.viewMode = v;
    } catch (e) { /* 忽略 */ }
  }

  function saveViewMode() {
    try { localStorage.setItem('ershi-view', state.viewMode); } catch (e) { /* 忽略 */ }
  }

  function suggestMealNow() {
    var h = new Date().getHours();
    if (h >= 5 && h < 10) return '早餐';
    if (h >= 10 && h < 15) return '午餐';
    if (h >= 15 && h < 21) return '晚餐';
    return '加餐';
  }

  /** 兼容旧数据：把「夜宵」统一成「加餐」 */
  function normalizeMeals(list) {
    return list.map(function (m) {
      if (m.meal === '夜宵') return Object.assign({}, m, { meal: '加餐' });
      return m;
    });
  }

  function parseTags(raw) {
    return raw ? [...new Set(String(raw).split(/[,，、\s]+/).filter(Boolean))] : [];
  }

  /* ---------- 数据 ---------- */

  async function fetchData() {
    var r = await fetch('/api/data');
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || '读取数据失败');
    state.meals = sortMeals(normalizeMeals(j.meals));
  }

  /** 探测服务模式：能访问 /api/data 即为服务模式 */
  async function detectServer() {
    try {
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 1200);
      var r = await fetch('/api/data', { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return null;
      var j = await r.json();
      return j.ok ? j : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------- 统计 ---------- */

  function renderStats() {
    var el = $('stats');
    if (!el) return;
    var total = state.meals.length;
    if (total === 0) { el.textContent = '还没有记录。'; return; }

    var monthCounts = {};
    state.meals.forEach(function (m) { var k = monthKey(m); monthCounts[k] = (monthCounts[k] || 0) + 1; });
    var months = Object.keys(monthCounts).sort();
    var busiest = months.reduce(function (acc, k) {
      return monthCounts[k] > monthCounts[acc] ? k : acc;
    }, months[0]);

    el.innerHTML =
      '共 <b>' + total + '</b> 餐 · 覆盖 <b>' + months.length + '</b> 个月 · 每月约 <b>' +
      (total / months.length).toFixed(1) + '</b> 餐 · 最勤的一月：<b>' + monthLabel(busiest) +
      '（' + monthCounts[busiest] + ' 餐）</b>';
  }

  /* ---------- 筛选 ---------- */

  function mealCount(meal) { return state.meals.filter(function (m) { return m.meal === meal; }).length; }

  function tagCount(tag) { return state.meals.filter(function (m) { return (m.tags || []).indexOf(tag) !== -1; }).length; }

  /** 分类计数：无分类的记录计入 '未分类' */
  function categoryCount(cat) {
    return state.meals.filter(function (m) { return (m.category || '未分类') === cat; }).length;
  }

  function renderFilters() {
    var el = $('filters');
    if (!el) return;

    var tagSet = {};
    state.meals.forEach(function (m) { (m.tags || []).forEach(function (t) { tagSet[t] = true; }); });
    var tags = Object.keys(tagSet).sort();

    var hasCategory = state.meals.some(function (m) { return !!m.category; });
    var hasUncategorized = state.meals.some(function (m) { return !m.category; });

    var hasFilter = state.meal || state.tag || state.category;
    var html = '';
    if (state.serverMode) {
      // 添加按钮独立一行，右侧放「列表/日历」切换，避免挤开「餐次」标签
      html += '<div class="filter-group toolbar-row">' +
        '<button class="btn btn-primary" id="addBtn">＋ 添加一餐</button>' +
        '<div class="view-switch" role="tablist">' +
          '<button class="view-tab' + (state.viewMode === 'list' ? ' active' : '') + '" data-view="list" role="tab">列表</button>' +
          '<button class="view-tab' + (state.viewMode === 'calendar' ? ' active' : '') + '" data-view="calendar" role="tab">日历</button>' +
        '</div>' +
      '</div>';
    } else {
      html += '<div class="filter-group toolbar-row">' +
        '<div class="view-switch" role="tablist">' +
          '<button class="view-tab' + (state.viewMode === 'list' ? ' active' : '') + '" data-view="list" role="tab">列表</button>' +
          '<button class="view-tab' + (state.viewMode === 'calendar' ? ' active' : '') + '" data-view="calendar" role="tab">日历</button>' +
        '</div>' +
      '</div>';
    }
    html += '<div class="filter-group"><span class="filter-label">餐次</span>';
    html += '<button class="btn' + (state.meal ? '' : ' active') + '" data-meal="">全部</button>';
    MEAL_ORDER.forEach(function (meal) {
      var cnt = mealCount(meal);
      html += '<button class="btn' + (state.meal === meal ? ' active' : '') + '" data-meal="' + meal +
        '">' + meal + '<span class="cnt">' + cnt + '</span></button>';
    });
    html += '</div>';

    if (hasCategory || hasUncategorized) {
      html += '<div class="filter-group"><span class="filter-label">分类</span>';
      html += '<button class="btn' + (state.category ? '' : ' active') + '" data-category="">全部</button>';
      CATEGORY_ORDER.forEach(function (cat) {
        html += '<button class="btn' + (state.category === cat ? ' active' : '') + '" data-category="' + cat +
          '">' + cat + '<span class="cnt">' + categoryCount(cat) + '</span></button>';
      });
      if (hasUncategorized) {
        html += '<button class="btn' + (state.category === '未分类' ? ' active' : '') + '" data-category="未分类">未分类' +
          '<span class="cnt">' + categoryCount('未分类') + '</span></button>';
      }
      html += '</div>';
    }

    if (tags.length) {
      html += '<div class="filter-group"><span class="filter-label">标签</span>';
      tags.forEach(function (t) {
        html += '<button class="btn' + (state.tag === t ? ' active' : '') + '" data-tag="' + escapeHtml(t) +
          '">' + escapeHtml(t) + '<span class="cnt">' + tagCount(t) + '</span></button>';
      });
      html += '</div>';
    }

    if (hasFilter) {
      html += '<div class="filter-group"><button class="btn btn-clear" data-clear="1">清除筛选</button></div>';
    }
    el.innerHTML = html;
  }

  function filteredMeals() {
    return state.meals.filter(function (m) {
      if (state.meal && m.meal !== state.meal) return false;
      if (state.tag && (m.tags || []).indexOf(state.tag) === -1) return false;
      if (state.category && (m.category || '未分类') !== state.category) return false;
      return true;
    });
  }

  /* ---------- 时间线 ---------- */

  function cardHtml(m) {
    var id = escapeHtml(m.id);
    var photos = mealPhotos(m);
    var tags = (m.tags || []).map(function (t) {
      return '<span class="chip tag" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
    }).join('');

    var notes = m.notes ? '<div class="card-notes"><p>' + escapeHtml(m.notes) + '</p></div>' : '';

    var category = m.category
      ? '<span class="chip category' + (m.category === '外食' ? ' out' : '') + '">' + escapeHtml(m.category) + '</span>'
      : '';

    var countBadge = photos.length > 1
      ? '<span class="photo-count">+' + (photos.length - 1) + '</span>'
      : '';

    var actions = '';
    if (state.serverMode) {
      actions =
        '<div class="card-actions">' +
          '<button class="mini-btn" data-action="save-img" data-id="' + id + '" title="把这张卡片保存为图片">存图</button>' +
          '<button class="mini-btn" data-action="edit" data-id="' + id + '">编辑</button>' +
          '<button class="mini-btn danger" data-action="delete" data-id="' + id + '">删除</button>' +
        '</div>';
    }

    return (
      '<article class="card' + (m.notes ? '' : ' no-notes') + '" data-id="' + id + '" tabindex="0">' +
        '<div class="card-photo-wrap">' +
          '<img class="card-photo" src="' + escapeHtml(photos[0]) + '" alt="' + escapeHtml(m.title) + '" loading="lazy" />' +
          countBadge +
          '<span class="stamp">' + fmtDate(m.date) + '</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<h3 class="card-title">' + escapeHtml(m.title) + '</h3>' +
          '<div class="card-meta">' +
            '<span class="chip meal">' + escapeHtml(m.meal) + '</span>' +
            category +
            tags +
          '</div>' +
          notes +
          actions +
        '</div>' +
      '</article>'
    );
  }

  function renderTimeline() {
    var el = $('timeline');
    var emptyEl = $('empty');
    if (!el || !emptyEl) return;

    var list = filteredMeals();

    if (list.length === 0) {
      el.innerHTML = '';
      emptyEl.hidden = false;
      emptyEl.textContent = state.meals.length === 0
        ? (state.serverMode ? '还没有记录。点上方「＋ 添加一餐」开始吧。' : '还没有记录。用服务模式（npm start）添加第一餐吧。')
        : '没有找到符合条件的餐。换一换筛选吧。';
      return;
    }
    emptyEl.hidden = true;

    // 三层分组：年 → 月 → 天（日期倒序，天内早→午→晚→夜）
    var years = [];
    var lastYear = null;
    list.forEach(function (m) {
      var y = m.date.slice(0, 4);
      if (y !== lastYear) { years.push({ year: y, months: [], lastMonth: null }); lastYear = y; }
      var curY = years[years.length - 1];
      var mk = monthKey(m);
      if (mk !== curY.lastMonth) { curY.months.push({ key: mk, days: [], lastDate: null }); curY.lastMonth = mk; }
      var curM = curY.months[curY.months.length - 1];
      if (m.date !== curM.lastDate) { curM.days.push({ date: m.date, items: [] }); curM.lastDate = m.date; }
      curM.days[curM.days.length - 1].items.push(m);
    });

    function monthShortLabel(key) {
      return (+key.slice(5, 7)) + '月';
    }

    el.innerHTML = years.map(function (y) {
      var yTotal = y.months.reduce(function (n, mo) {
        return n + mo.days.reduce(function (m, d) { return m + d.items.length; }, 0);
      }, 0);
      var yCollapsed = state.collapsedYears[y.year] ? ' collapsed' : '';
      return (
        '<section class="year-block' + yCollapsed + '" data-year="' + y.year + '">' +
          '<div class="year-head" title="点击折叠 / 展开">' +
            '<span class="year-title">' + y.year + '年</span>' +
            '<span class="year-count">' + yTotal + ' 餐</span>' +
            '<span class="fold-toggle" aria-hidden="true">▾</span>' +
          '</div>' +
          y.months.map(function (mo) {
            var mTotal = mo.days.reduce(function (n, d) { return n + d.items.length; }, 0);
            var mCollapsed = state.collapsedMonths[mo.key] ? ' collapsed' : '';
            return (
              '<section class="month-block' + mCollapsed + '" data-month="' + mo.key + '">' +
                '<div class="month-head" title="点击折叠 / 展开">' +
                  '<span class="month-tape">' + monthShortLabel(mo.key) + '</span>' +
                  '<span class="month-count">' + mTotal + ' 餐</span>' +
                  '<span class="fold-toggle" aria-hidden="true">▾</span>' +
                '</div>' +
                mo.days.map(function (d) {
                  var dCollapsed = state.collapsedDays[d.date] ? ' collapsed' : '';
                  return (
                    '<div class="day-block' + dCollapsed + '" data-date="' + d.date + '">' +
                      '<div class="day-head" title="点击折叠 / 展开">' +
                        '<span class="day-title">' + fmtDate(d.date) + '</span>' +
                        '<span class="day-count">' + d.items.length + ' 餐</span>' +
                        '<span class="fold-toggle" aria-hidden="true">▾</span>' +
                      '</div>' +
                      '<div class="grid">' + d.items.map(cardHtml).join('') + '</div>' +
                    '</div>'
                  );
                }).join('') +
              '</section>'
            );
          }).join('') +
        '</section>'
      );
    }).join('');
  }

  /* ---------- 日历视图 ---------- */

  const CAL_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  /** 定位日历初始月份：有数据的最新月；无数据显示当前系统月 */
  function initCalendarMonth() {
    var latest = null;
    state.meals.forEach(function (m) {
      if (!latest || m.date > latest) latest = m.date;
    });
    if (latest) {
      state.calYear = +latest.slice(0, 4);
      state.calMonth = +latest.slice(5, 7);
    } else {
      var d = new Date();
      state.calYear = d.getFullYear();
      state.calMonth = d.getMonth() + 1;
    }
  }

  function renderCalendar() {
    var el = $('calendar');
    if (!el) return;
    if (!state.calYear || !state.calMonth) initCalendarMonth();

    var y = state.calYear;
    var mo = state.calMonth;
    var daysInMonth = new Date(y, mo, 0).getDate();
    var startWeekday = new Date(y, mo - 1, 1).getDay(); // 0=周日

    // 当前筛选下的有记录日期集合
    var daySet = {};
    filteredMeals().forEach(function (m) { daySet[m.date] = true; });

    var today = todayStr();
    var sel = state.calSelected;
    var pad = function (n) { return String(n).padStart(2, '0'); };

    var html =
      '<div class="cal-toolbar">' +
        '<button class="cal-nav" data-cal="prev" title="上个月" aria-label="上个月">‹</button>' +
        '<span class="cal-title">' + y + '年' + mo + '月</span>' +
        '<button class="cal-nav" data-cal="next" title="下个月" aria-label="下个月">›</button>' +
        '<button class="cal-today" data-cal="today">今天</button>' +
      '</div>' +
      '<div class="cal-week">' + CAL_WEEKDAYS.map(function (w) {
        return '<span class="cal-week-day">' + w + '</span>';
      }).join('') + '</div>' +
      '<div class="cal-grid">';

    for (var i = 0; i < startWeekday; i++) html += '<span class="cal-day blank"></span>';

    for (var d = 1; d <= daysInMonth; d++) {
      var date = y + '-' + pad(mo) + '-' + pad(d);
      var cls = 'cal-day';
      if (daySet[date]) cls += ' has';
      if (date === today) cls += ' today';
      if (date === sel) cls += ' selected';
      html += '<button type="button" class="' + cls + '" data-date="' + date + '">' + d + '</button>';
    }
    html += '</div>';

    html += '<div class="cal-day-cards">' + renderCalendarDay() + '</div>';
    el.innerHTML = html;
  }

  /** 日历中选中天的记录卡片（复用卡片样式与交互） */
  function renderCalendarDay() {
    if (!state.calSelected) {
      return '<p class="cal-hint">点击日历上的日期，查看当天吃了什么。</p>';
    }
    var items = filteredMeals().filter(function (m) { return m.date === state.calSelected; });
    if (!items.length) {
      return '<p class="cal-hint">' + dateLabel(state.calSelected) + ' 没有记录。</p>';
    }
    return '<div class="cal-day-head">' +
      '<span class="cal-day-title">' + dateLabel(state.calSelected) + '</span>' +
      '<span class="cal-day-count">' + items.length + ' 餐</span>' +
      '</div>' +
      '<div class="grid">' + items.map(cardHtml).join('') + '</div>';
  }

  /* ---------- 右侧月份导航（滚动时滑出） ---------- */

  function renderSideNav() {
    var nav = $('sideNav');
    if (!nav) return;
    // 按年份收集月份（年、月都按倒序）
    var yearMap = {};
    state.meals.forEach(function (m) {
      var y = m.date.slice(0, 4);
      var mk = monthKey(m);
      if (!yearMap[y]) yearMap[y] = [];
      if (yearMap[y].indexOf(mk) === -1) yearMap[y].push(mk);
    });
    var years = Object.keys(yearMap).sort().reverse();
    var html = '';
    years.forEach(function (y) {
      yearMap[y].sort().reverse();
      html += '<div class="side-nav-year">' + y + '年</div>';
      yearMap[y].forEach(function (mk) {
        html += '<button class="side-nav-btn" data-month="' + mk + '">' + (+mk.slice(5, 7)) + '月</button>';
      });
    });
    nav.innerHTML = html;
  }

  /** 滚动时高亮当前所在月份 */
  function updateSideNavActive() {
    var nav = $('sideNav');
    if (!nav) return;
    var blocks = document.querySelectorAll('.month-block');
    var current = null;
    var mark = 100; // 视口顶部阈值
    blocks.forEach(function (b) {
      if (b.getBoundingClientRect().top <= mark) current = b.dataset.month;
    });
    if (!current && blocks.length) current = blocks[0].dataset.month;
    nav.querySelectorAll('.side-nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.month === current);
    });
  }

  function bindSideNav() {
    var nav = $('sideNav');
    if (!nav) return;

    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('.side-nav-btn');
      if (!btn) return;
      var key = btn.dataset.month;
      // 折叠中的月份：先展开再跳转
      if (state.collapsedMonths[key]) {
        state.collapsedMonths[key] = false;
        var sec = document.querySelector('.month-block[data-month="' + key + '"]');
        if (sec) sec.classList.remove('collapsed');
      }
      var target = document.querySelector('.month-block[data-month="' + key + '"]');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        if (state.viewMode === 'calendar') {
          // 日历模式下不显示侧边月份导航
          nav.classList.remove('visible');
          ticking = false;
          return;
        }
        // 滚动超过 200px 时滑出，回到顶部附近收起
        nav.classList.toggle('visible', window.scrollY > 200);
        updateSideNavActive();
        ticking = false;
      });
    }, { passive: true });
    nav.classList.toggle('visible', !(state.viewMode === 'calendar') && window.scrollY > 200);
    updateSideNavActive();
  }

  /* ---------- 页面缩放 ---------- */

  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 1.4;
  var ZOOM_STEP = 0.1;

  function loadZoom() {
    try {
      var v = parseFloat(localStorage.getItem('ershi-zoom'));
      if (v && v >= ZOOM_MIN && v <= ZOOM_MAX) return v;
    } catch (e) { /* 忽略 */ }
    return 1;
  }

  function saveZoom(v) {
    try { localStorage.setItem('ershi-zoom', String(v)); } catch (e) { /* 忽略 */ }
  }

  function applyZoom() {
    var sheet = document.querySelector('.sheet');
    if (sheet) sheet.style.zoom = String(state.zoom);
    var label = $('zoomValue');
    if (label) label.textContent = Math.round(state.zoom * 100) + '%';
  }

  function bindZoom() {
    var inBtn = $('zoomIn');
    var outBtn = $('zoomOut');
    if (inBtn) inBtn.addEventListener('click', function () {
      state.zoom = Math.min(ZOOM_MAX, Math.round((state.zoom + ZOOM_STEP) * 10) / 10);
      applyZoom();
      saveZoom(state.zoom);
    });
    if (outBtn) outBtn.addEventListener('click', function () {
      state.zoom = Math.max(ZOOM_MIN, Math.round((state.zoom - ZOOM_STEP) * 10) / 10);
      applyZoom();
      saveZoom(state.zoom);
    });
  }

  /* ---------- 右键外观设置（颜色 + 字体） ---------- */

  var COLOR_PRESETS = ['#f0e9f8', '#e9dbf4', '#dfebf7', '#f7e7f0', '#f8f2e4', '#fff9ec', '#e9f4e6', '#f3efe4'];

  var INK_PRESETS = ['#483a5e', '#43352a', '#5a3f63', '#2f3a4a', '#6a5378', '#33404a'];

  var TITLE_FONTS = [
    { label: '默认（手写组合）', value: '' },
    { label: '萌趣软糖体', value: 'HandFont' },
    { label: '方正舒体', value: 'FZShuTi' },
    { label: '华文行楷', value: 'STXingkai' },
    { label: '楷体', value: 'KaiTi' },
    { label: '仿宋', value: 'FangSong' }
  ];

  var BODY_FONTS = [
    { label: '默认（组合）', value: '' },
    { label: 'HGZCS', value: 'BodyFont' },
    { label: '方正舒体', value: 'FZShuTi' },
    { label: '楷体', value: 'KaiTi' },
    { label: '仿宋', value: 'FangSong' },
    { label: '微软雅黑', value: 'Microsoft YaHei' }
  ];

  function loadFonts() {
    try {
      state.titleFont = localStorage.getItem('ershi-title-font') || '';
      state.bodyFont = localStorage.getItem('ershi-body-font') || '';
    } catch (e) { /* 忽略 */ }
  }

  function applyFonts() {
    var root = document.documentElement.style;
    if (state.titleFont) root.setProperty('--font-display', state.titleFont);
    else root.removeProperty('--font-display');
    if (state.bodyFont) root.setProperty('--font-body', state.bodyFont);
    else root.removeProperty('--font-body');
  }

  function loadInk() {
    try { state.inkColor = localStorage.getItem('ershi-ink-color') || ''; } catch (e) { /* 忽略 */ }
  }

  function applyInk() {
    var root = document.documentElement.style;
    if (state.inkColor) root.setProperty('--ink', state.inkColor);
    else root.removeProperty('--ink');
  }

  /** 容错解析颜色：支持 #aabbcc / aabbcc / #abc */
  function parseHexColor(raw) {
    var v = String(raw || '').trim().replace(/^#/, '');
    var m = v.match(/^([0-9a-fA-F]{3})$/);
    if (m) v = m[1].split('').map(function (c) { return c + c; }).join('');
    return /^[0-9a-fA-F]{6}$/.test(v) ? ('#' + v.toLowerCase()) : null;
  }

  function loadColors() {
    try {
      state.customBg = localStorage.getItem('ershi-bg-color') || '';
      state.customSheet = localStorage.getItem('ershi-sheet-color') || '';
    } catch (e) { /* 忽略 */ }
  }

  function applyCustomColors() {
    if (state.customBg) document.body.style.backgroundColor = state.customBg;
    var sheet = document.querySelector('.sheet');
    if (sheet && state.customSheet) sheet.style.backgroundColor = state.customSheet;
  }

  function bindColorPickers() {
    var pop = $('colorPop');
    var swatches = $('colorSwatches');
    var custom = $('colorCustom');
    var hex = $('colorHex');
    var applyBtn = $('colorApply');
    var resetBtn = $('colorReset');
    var titleFontSelect = $('titleFontSelect');
    var bodyFontSelect = $('bodyFontSelect');
    var inkSwatches = $('inkSwatches');
    var inkCustom = $('inkCustom');
    var inkHex = $('inkHex');
    var inkApply = $('inkApply');
    var activeKey = 'bg'; // 'bg' = 外层背景，'sheet' = 内页纸面

    function currentColor() {
      return activeKey === 'bg'
        ? (state.customBg || '#f0e9f8')
        : (state.customSheet || '#f8f2e4');
    }

    function applyColor(v) {
      if (activeKey === 'bg') {
        state.customBg = v;
        document.body.style.backgroundColor = v;
        try { localStorage.setItem('ershi-bg-color', v); } catch (e) { /* 忽略 */ }
      } else {
        state.customSheet = v;
        var sheet = document.querySelector('.sheet');
        if (sheet) sheet.style.backgroundColor = v;
        try { localStorage.setItem('ershi-sheet-color', v); } catch (e) { /* 忽略 */ }
      }
    }

    function openPop() {
      var cur = currentColor();
      swatches.innerHTML = COLOR_PRESETS.map(function (c) {
        return '<button class="color-swatch' + (c === cur ? ' active' : '') +
          '" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
      }).join('');
      custom.value = cur;
      hex.value = cur;
      hex.style.borderColor = '';
      // 字体颜色
      var ink = state.inkColor || '#483a5e';
      if (inkSwatches) {
        inkSwatches.innerHTML = INK_PRESETS.map(function (c) {
          return '<button class="color-swatch' + (c === ink ? ' active' : '') +
            '" data-color="' + c + '" style="background:' + c + '" title="' + c + '"></button>';
        }).join('');
      }
      if (inkCustom) inkCustom.value = ink;
      if (inkHex) { inkHex.value = ink; inkHex.style.borderColor = ''; }
      // 同步字体下拉当前值
      if (titleFontSelect) titleFontSelect.value = state.titleFont || '';
      if (bodyFontSelect) bodyFontSelect.value = state.bodyFont || '';
      pop.hidden = false;
    }

    function closePop() { pop.hidden = true; }

    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var sheet = document.querySelector('.sheet');
      activeKey = sheet && sheet.contains(e.target) ? 'sheet' : 'bg';
      openPop();
    });

    if (swatches) swatches.addEventListener('click', function (e) {
      var sw = e.target.closest('.color-swatch');
      if (!sw) return;
      applyColor(sw.dataset.color);
      closePop();
    });

    if (custom) custom.addEventListener('change', function () {
      applyColor(custom.value);
      closePop();
    });

    function applyHex() {
      var v = parseHexColor(hex.value);
      if (v) {
        applyColor(v);
        closePop();
      } else {
        hex.style.borderColor = '#c05545';
        hex.placeholder = '格式：#f0e9f8 或 #abc';
        hex.value = '';
      }
    }
    if (applyBtn) applyBtn.addEventListener('click', applyHex);
    if (hex) hex.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyHex();
    });

    // ---- 字体颜色 ----
    function applyInkColor(v) {
      state.inkColor = v;
      applyInk();
      try { localStorage.setItem('ershi-ink-color', v); } catch (e) { /* 忽略 */ }
    }
    if (inkSwatches) inkSwatches.addEventListener('click', function (e) {
      var sw = e.target.closest('.color-swatch');
      if (!sw) return;
      applyInkColor(sw.dataset.color);
      closePop();
    });
    if (inkCustom) inkCustom.addEventListener('change', function () {
      applyInkColor(inkCustom.value);
      closePop();
    });
    function applyInkHex() {
      var v = parseHexColor(inkHex.value);
      if (v) {
        applyInkColor(v);
        closePop();
      } else {
        inkHex.style.borderColor = '#c05545';
        inkHex.placeholder = '格式：#483a5e 或 #abc';
        inkHex.value = '';
      }
    }
    if (inkApply) inkApply.addEventListener('click', applyInkHex);
    if (inkHex) inkHex.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyInkHex();
    });

    if (resetBtn) resetBtn.addEventListener('click', function () {
      // 恢复背景颜色
      if (activeKey === 'bg') {
        state.customBg = '';
        document.body.style.backgroundColor = '';
        try { localStorage.removeItem('ershi-bg-color'); } catch (e) { /* 忽略 */ }
      } else {
        state.customSheet = '';
        var sheet = document.querySelector('.sheet');
        if (sheet) sheet.style.backgroundColor = '';
        try { localStorage.removeItem('ershi-sheet-color'); } catch (e) { /* 忽略 */ }
      }
      // 恢复字体颜色
      state.inkColor = '';
      applyInk();
      try { localStorage.removeItem('ershi-ink-color'); } catch (e) { /* 忽略 */ }
      // 恢复字体
      state.titleFont = '';
      state.bodyFont = '';
      applyFonts();
      if (titleFontSelect) titleFontSelect.value = '';
      if (bodyFontSelect) bodyFontSelect.value = '';
      try {
        localStorage.removeItem('ershi-title-font');
        localStorage.removeItem('ershi-body-font');
      } catch (e) { /* 忽略 */ }
      closePop();
    });

    // ---- 字体选择 ----
    function fillFontSelect(sel, list) {
      sel.innerHTML = list.map(function (f) {
        return '<option value="' + f.value + '" style="font-family:' + (f.value || 'inherit') + '">' + f.label + '</option>';
      }).join('');
    }
    if (titleFontSelect) {
      fillFontSelect(titleFontSelect, TITLE_FONTS);
      titleFontSelect.addEventListener('change', function () {
        state.titleFont = titleFontSelect.value;
        applyFonts();
        try { localStorage.setItem('ershi-title-font', state.titleFont); } catch (e) { /* 忽略 */ }
      });
    }
    if (bodyFontSelect) {
      fillFontSelect(bodyFontSelect, BODY_FONTS);
      bodyFontSelect.addEventListener('change', function () {
        state.bodyFont = bodyFontSelect.value;
        applyFonts();
        try { localStorage.setItem('ershi-body-font', state.bodyFont); } catch (e) { /* 忽略 */ }
      });
    }

    document.addEventListener('click', function (e) {
      if (!pop.hidden && !pop.contains(e.target)) closePop();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePop();
    });
  }

  function render() {
    renderStats();
    renderFilters();
    renderSideNav();
    if (state.viewMode === 'calendar') {
      renderCalendar();
    } else {
      renderTimeline();
    }
    // 列表 / 日历 互斥显示
    var cal = $('calendar');
    var tl = $('timeline');
    var empty = $('empty');
    if (cal) cal.hidden = state.viewMode !== 'calendar';
    if (tl) tl.hidden = state.viewMode === 'calendar';
    if (empty) empty.hidden = state.viewMode === 'calendar' ? true : empty.hidden;
    // 日历模式下收起侧边月份导航
    if (state.viewMode === 'calendar') {
      var nav = $('sideNav');
      if (nav) nav.classList.remove('visible');
    }
  }

  /* ---------- 站点标题 / 副标题（双击修改） ---------- */

  async function loadSite() {
    try {
      var r = await fetch('/api/site');
      var j = await r.json();
      if (!j.ok || !j.site) return;
      state.site = {
        title: String(j.site.title || ''),
        subtitle: String(j.site.subtitle || ''),
        footer: String(j.site.footer || '')
      };
      // 用 innerHTML 渲染，让多行文字（\n）正确显示为换行
      if (state.site.title && $('siteTitle')) $('siteTitle').innerHTML = escapeHtml(state.site.title).replace(/\n/g, '<br>');
      if ($('siteSub')) $('siteSub').innerHTML = escapeHtml(state.site.subtitle).replace(/\n/g, '<br>');
      if (state.site.footer && $('siteFooter')) $('siteFooter').innerHTML = escapeHtml(state.site.footer).replace(/\n/g, '<br>');
    } catch (e) { /* 读取失败则用页面默认文字 */ }
  }

  async function saveSiteText(which, text) {
    var site = { title: state.site.title, subtitle: state.site.subtitle, footer: state.site.footer };
    site[which] = text;
    var r = await fetch('/api/site', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(site)
    });
    var j = await r.json();
    if (!j.ok) throw new Error(j.error || '保存失败');
    state.site = site;
  }

  function selectAllText(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** 双击进入编辑，回车或失焦保存，Shift+回车换行，Esc 取消 */
  function makeEditable(el, saveFn) {
    if (!el) return;
    var original = '';
    var editing = false;

    // 把纯文本按换行渲染到页面上（\n → <br>）
    function renderText(text) {
      el.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
    }

    function enter() {
      // innerText 会把 <br> 还原成换行符，保证多行文本不被拍平
      original = (el.innerText || el.textContent);
      editing = true;
      el.contentEditable = 'plaintext-only';
      el.classList.add('editing');
      el.focus();
      selectAllText(el);
    }

    function exit(restore) {
      if (!editing) return;
      editing = false;
      if (restore) renderText(original);
      el.contentEditable = 'inherit';
      el.classList.remove('editing');
    }

    async function finish() {
      if (!editing) return;
      editing = false;
      var text = (el.innerText || el.textContent).trim();
      el.contentEditable = 'inherit';
      el.classList.remove('editing');
      if (!text || text === original) { renderText(original); return; }
      try {
        await saveFn(text);
        renderText(text);
      } catch (e) {
        renderText(original);
        window.alert('保存失败：' + (e.message || ''));
      }
    }

    el.addEventListener('dblclick', enter);
    el.addEventListener('keydown', function (e) {
      if (!editing) return;
      // Shift+Enter 不拦截，交给浏览器插入换行；Enter 保存
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(); }
      else if (e.key === 'Escape') { exit(true); el.blur(); }
    });
    el.addEventListener('blur', function () { if (editing) finish(); });
  }

  function bindSiteEdit() {
    makeEditable($('siteTitle'), function (t) { return saveSiteText('title', t); });
    makeEditable($('siteSub'), function (t) { return saveSiteText('subtitle', t); });
    makeEditable($('siteFooter'), function (t) { return saveSiteText('footer', t); });
  }

  /* ---------- 弹窗 ---------- */

  function findMeal(id) {
    return state.meals.find(function (m) { return m.id === id; }) || null;
  }

  /** 渲染弹窗里的照片预览网格（每个缩略图带移除按钮） */
  function renderPhotoPreviews() {
    var box = $('photoPreviews');
    if (!box) return;
    var photos = state.dialog.photos || [];
    box.innerHTML = photos.map(function (p, i) {
      return (
        '<div class="preview-item">' +
          '<img class="preview-thumb" src="' + escapeHtml(p) + '" alt="照片 ' + (i + 1) + '" />' +
          '<button type="button" class="preview-remove" data-remove="' + i + '" title="移除这张照片">✕</button>' +
        '</div>'
      );
    }).join('');
    box.hidden = photos.length === 0;
  }

  function showFormError(msg) {
    var el = $('formError');
    el.textContent = msg;
    el.hidden = false;
  }

  function hideFormError() {
    $('formError').hidden = true;
  }

  function openDialog(mode, meal) {
    hideFormError();
    state.dialog = {
      mode: mode,
      id: meal ? meal.id : null,
      photos: meal ? mealPhotos(meal).slice() : []
    };

    $('dialogTitle').textContent = mode === 'edit' ? '编辑这一餐' : '添加一餐';
    $('titleInput').value = meal ? (meal.title || '') : '';
    $('dateInput').value = meal ? (meal.date || '') : todayStr();
    $('mealInput').value = meal ? (meal.meal || '') : suggestMealNow();
    $('categoryInput').value = meal ? (meal.category || '') : '自制';
    $('tagsInput').value = meal && meal.tags ? meal.tags.join(', ') : '';
    $('notesInput').value = meal ? (meal.notes || '') : '';
    $('photoFile').value = '';

    renderPhotoPreviews();

    $('mealDialog').showModal();
  }

  function closeDialog() {
    $('mealDialog').close();
  }

  /* ---------- 图片放大查看 ---------- */

  function fmtFullDate(date) {
    var p = String(date).split('-');
    return p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日';
  }

  function openView(meal) {
    if (!meal) return;
    var photos = mealPhotos(meal);
    state.viewPhotos = photos;
    state.viewIndex = 0;

    var photo = $('viewPhoto');
    photo.src = photos[0];
    photo.alt = meal.title || '';
    $('viewTitle').textContent = meal.title || '';
    $('viewDate').textContent = fmtFullDate(meal.date);
    // 餐次 / 分类 / 标签全部动态生成，每次打开完整重写（幂等，不残留静态子元素）
    var meta = $('viewMeta');
    if (meta) {
      meta.innerHTML =
        '<span class="chip meal">' + escapeHtml(meal.meal || '') + '</span>' +
        (meal.category
          ? '<span class="chip category' + (meal.category === '外食' ? ' out' : '') + '">' + escapeHtml(meal.category) + '</span>'
          : '') +
        (meal.tags || []).map(function (t) {
          return '<span class="chip tag">' + escapeHtml(t) + '</span>';
        }).join('');
    }
    var notes = $('viewNotes');
    notes.textContent = meal.notes || '';
    notes.hidden = !meal.notes;
    state.viewZoom = 1; // 每次打开重置照片缩放
    applyViewZoom();
    renderViewThumbs();
    $('viewDialog').showModal();
  }

  function renderViewThumbs() {
    var box = $('viewThumbs');
    if (!box) return;
    var photos = state.viewPhotos || [];
    if (photos.length <= 1) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = photos.map(function (p, i) {
      return '<button type="button" class="view-thumb' + (i === state.viewIndex ? ' active' : '') +
        '" data-index="' + i + '" title="照片 ' + (i + 1) + '">' +
        '<img src="' + escapeHtml(p) + '" alt="照片 ' + (i + 1) + '" /></button>';
    }).join('');
  }

  function switchViewPhoto(i) {
    var photos = state.viewPhotos || [];
    if (i < 0 || i >= photos.length || i === state.viewIndex) return;
    state.viewIndex = i;
    var photo = $('viewPhoto');
    if (photo) photo.src = photos[i];
    renderViewThumbs();
  }

  /* ---------- 照片缩放 ---------- */

  function applyViewZoom() {
    var photo = $('viewPhoto');
    if (photo) photo.style.transform = 'scale(' + state.viewZoom + ')';
    var label = $('viewZoomValue');
    if (label) label.textContent = Math.round(state.viewZoom * 100) + '%';
  }

  function bindViewZoom() {
    var inBtn = $('viewZoomIn');
    var outBtn = $('viewZoomOut');
    if (inBtn) inBtn.addEventListener('click', function () {
      state.viewZoom = Math.min(3, Math.round((state.viewZoom + 0.25) * 100) / 100);
      applyViewZoom();
    });
    if (outBtn) outBtn.addEventListener('click', function () {
      state.viewZoom = Math.max(0.5, Math.round((state.viewZoom - 0.25) * 100) / 100);
      applyViewZoom();
    });
  }

  async function handleUpload(file) {
    if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
      showFormError('仅支持 jpg / jpeg / png / webp / gif 图片：' + file.name);
      return false;
    }
    var fd = new FormData();
    fd.append('file', file);
    var btn = $('fileBtn');
    var btnText = $('fileBtnText');
    var oldText = btnText ? btnText.textContent : '';
    if (btnText) btnText.textContent = '上传中…';
    if (btn) btn.classList.add('disabled');
    try {
      var r = await fetch('/api/upload', { method: 'POST', body: fd });
      var j = await r.json();
      if (!j.ok) { showFormError('上传失败：' + j.error); return false; }
      state.dialog.photos.push(j.photo);
      renderPhotoPreviews();
      // 新上传的照片自动预填日期与餐次（仅添加模式且用户还没改过）
      if (state.dialog.mode === 'add' && !$('dateInput').value && j.date) $('dateInput').value = j.date;
      if (state.dialog.mode === 'add' && j.meal) $('mealInput').value = j.meal;
      return true;
    } catch (e) {
      showFormError('上传失败，请重试。');
      return false;
    } finally {
      if (btnText) btnText.textContent = oldText;
      if (btn) btn.classList.remove('disabled');
    }
  }

  async function submitForm() {
    hideFormError();
    var title = $('titleInput').value.trim();
    var date = $('dateInput').value.trim();
    var meal = $('mealInput').value;
    var category = $('categoryInput').value;
    var tags = parseTags($('tagsInput').value);
    var notes = $('notesInput').value.trim();

    if (!title) return showFormError('标题不能为空。');
    if (!date) return showFormError('请选择日期。');
    if (!state.dialog.photos.length) return showFormError('请先选择或上传至少一张照片。');

    var payload = {
      title: title, date: date, meal: meal, category: category,
      tags: tags, notes: notes, photos: state.dialog.photos
    };

    try {
      var r, j;
      if (state.dialog.mode === 'edit') {
        r = await fetch('/api/meals/' + encodeURIComponent(state.dialog.id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      } else {
        r = await fetch('/api/meals', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      }
      j = await r.json();
      if (!j.ok) return showFormError(j.error || '保存失败');
      closeDialog();
      await fetchData();
      render();
    } catch (e) {
      showFormError('保存失败，请检查服务是否还在运行。');
    }
  }

  async function doDelete(id) {
    var meal = findMeal(id);
    if (!meal) return;
    var msg = '确定删除「' + meal.title + '」（' + meal.date + '）？\n照片文件不会被删除。';
    if (!window.confirm(msg)) return;
    try {
      var r = await fetch('/api/meals/' + encodeURIComponent(id), { method: 'DELETE' });
      var j = await r.json();
      if (!j.ok) { window.alert('删除失败：' + (j.error || '')); return; }
      await fetchData();
      render();
    } catch (e) {
      window.alert('删除失败，请检查服务是否还在运行。');
    }
  }

  /** 把一张卡片保存为 PNG 图片 */
  async function saveCardAsImage(id) {
    if (typeof html2canvas === 'undefined') {
      window.alert('图片组件未加载，请刷新重试。');
      return;
    }
    var meal = findMeal(id);
    var src = document.querySelector('.card[data-id="' + CSS.escape(id) + '"]');
    if (!src) return;

    // 克隆卡片并去掉操作按钮（编辑/删除/存图），只保留展示内容
    var clone = src.cloneNode(true);
    var act = clone.querySelector('.card-actions');
    if (act) act.remove();
    clone.classList.remove('expanded');

    // 吸附到离屏容器，保持与原卡片一致的宽度，避免布局错乱
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:' + src.offsetWidth + 'px;';
    holder.appendChild(clone);
    document.body.appendChild(holder);

    try {
      // 确保照片加载完成
      var imgs = Array.prototype.slice.call(clone.querySelectorAll('img'));
      await Promise.all(imgs.map(function (img) {
        if (img.complete && img.naturalWidth) return Promise.resolve();
        return new Promise(function (resolve) { img.onload = resolve; img.onerror = resolve; });
      }));

      var canvas = await html2canvas(clone, {
        scale: 4,
        backgroundColor: '#fdfcff',
        useCORS: true,
        logging: false,
      });
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = (meal && meal.title ? meal.title : '餐食卡片') + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      window.alert('保存图片失败：' + (e.message || ''));
    } finally {
      holder.remove();
    }
  }

  /* ---------- 事件绑定 ---------- */

  function bindEvents() {
    var cancelBtn = $('cancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeDialog);

    var viewClose = $('viewClose');
    if (viewClose) viewClose.addEventListener('click', function () { $('viewDialog').close(); });

    var viewDialog = $('viewDialog');
    if (viewDialog) viewDialog.addEventListener('click', function (e) {
      if (e.target === viewDialog) viewDialog.close();
    });

    var form = $('mealForm');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); submitForm(); });

    var photoFile = $('photoFile');
    if (photoFile) photoFile.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(photoFile.files || []);
      if (!files.length) return;
      var max = 9;
      var room = max - state.dialog.photos.length;
      if (files.length > room) {
        showFormError('每餐最多 ' + max + ' 张照片（当前已有 ' + state.dialog.photos.length +
          ' 张，本次最多再传 ' + room + ' 张）。');
        files = files.slice(0, Math.max(room, 0));
      }
      for (var i = 0; i < files.length; i++) {
        await handleUpload(files[i]);
      }
      photoFile.value = '';
    });

    var previews = $('photoPreviews');
    if (previews) previews.addEventListener('click', function (e) {
      var rm = e.target.closest('.preview-remove');
      if (!rm) return;
      var i = parseInt(rm.dataset.remove, 10);
      if (!Number.isInteger(i)) return;
      state.dialog.photos.splice(i, 1);
      renderPhotoPreviews();
      hideFormError();
    });

    var viewThumbs = $('viewThumbs');
    if (viewThumbs) viewThumbs.addEventListener('click', function (e) {
      var t = e.target.closest('.view-thumb');
      if (!t) return;
      switchViewPhoto(parseInt(t.dataset.index, 10));
    });

    var filtersEl = $('filters');
    if (filtersEl) filtersEl.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      // 「添加一餐」按钮由 filter 栏动态渲染，委托到容器上
      if (btn.id === 'addBtn') { openDialog('add', null); return; }
      if (btn.dataset.view !== undefined) {
        // 列表 / 日历 视图切换
        state.viewMode = btn.dataset.view;
        saveViewMode();
        if (state.viewMode === 'calendar') {
          // 首次进入日历且尚未定位月份时定位
          if (!state.calYear || !state.calMonth) initCalendarMonth();
          state.calSelected = '';
        }
        render();
        return;
      }
      if (btn.dataset.clear) { state.meal = null; state.tag = null; state.category = null; }
      else if (btn.dataset.meal !== undefined) { state.meal = btn.dataset.meal || null; }
      else if (btn.dataset.category !== undefined) { state.category = btn.dataset.category || null; }
      else if (btn.dataset.tag !== undefined) {
        state.tag = state.tag === btn.dataset.tag ? null : btn.dataset.tag;
      }
      render();
    });

    var calendarEl = $('calendar');
    if (calendarEl) {
      calendarEl.addEventListener('click', function (e) {
        // 编辑 / 删除（当天卡片）
        var act = e.target.closest('[data-action]');
        if (act) {
          e.stopPropagation();
          var id = act.dataset.id;
          if (act.dataset.action === 'edit') openDialog('edit', findMeal(id));
          else if (act.dataset.action === 'delete') doDelete(id);
          else if (act.dataset.action === 'save-img') saveCardAsImage(id);
          return;
        }
        // 翻月 / 今天
        var nav = e.target.closest('[data-cal]');
        if (nav) {
          e.stopPropagation();
          var dir = nav.dataset.cal;
          if (dir === 'prev') {
            state.calMonth--;
            if (state.calMonth < 1) { state.calMonth = 12; state.calYear--; }
          } else if (dir === 'next') {
            state.calMonth++;
            if (state.calMonth > 12) { state.calMonth = 1; state.calYear++; }
          } else {
            var d = new Date();
            state.calYear = d.getFullYear();
            state.calMonth = d.getMonth() + 1;
          }
          state.calSelected = '';
          renderCalendar();
          return;
        }
        // 选中某天
        var day = e.target.closest('.cal-day');
        if (day && !day.classList.contains('blank')) {
          e.stopPropagation();
          state.calSelected = day.dataset.date;
          renderCalendar();
          return;
        }
        // 点击照片 → 放大查看详情
        var photoArea = e.target.closest('.card-photo-wrap');
        if (photoArea) {
          e.stopPropagation();
          var pcard = photoArea.closest('.card');
          if (pcard) openView(findMeal(pcard.dataset.id));
          return;
        }
        // 标签筛选
        var tag = e.target.closest('.chip.tag');
        if (tag) {
          var t = tag.dataset.tag;
          state.tag = state.tag === t ? null : t;
          render();
          return;
        }
        // 卡片展开（备注）
        var card = e.target.closest('.card');
        if (!card || card.classList.contains('no-notes')) return;
        card.classList.toggle('expanded');
      });
    }

    var timelineEl = $('timeline');
    if (timelineEl) {
      timelineEl.addEventListener('click', function (e) {
        var act = e.target.closest('[data-action]');
        if (act) {
          e.stopPropagation();
          var id = act.dataset.id;
          if (act.dataset.action === 'edit') openDialog('edit', findMeal(id));
          else if (act.dataset.action === 'delete') doDelete(id);
          else if (act.dataset.action === 'save-img') saveCardAsImage(id);
          return;
        }
        // 点击年份标题 → 折叠 / 展开该年
        var yhead = e.target.closest('.year-head');
        if (yhead) {
          e.stopPropagation();
          var ysection = yhead.closest('.year-block');
          if (ysection) {
            var ykey = ysection.dataset.year;
            state.collapsedYears[ykey] = !state.collapsedYears[ykey];
            ysection.classList.toggle('collapsed');
          }
          return;
        }
        // 点击日期标题 → 折叠 / 展开当天
        var dhead = e.target.closest('.day-head');
        if (dhead) {
          e.stopPropagation();
          var dblock = dhead.closest('.day-block');
          if (dblock) {
            var dkey = dblock.dataset.date;
            state.collapsedDays[dkey] = !state.collapsedDays[dkey];
            dblock.classList.toggle('collapsed');
          }
          return;
        }
        // 点击月份标题 → 折叠 / 展开该月
        var mhead = e.target.closest('.month-head');
        if (mhead) {
          e.stopPropagation();
          var section = mhead.closest('.month-block');
          if (section) {
            var key = section.dataset.month;
            state.collapsedMonths[key] = !state.collapsedMonths[key];
            section.classList.toggle('collapsed');
          }
          return;
        }
        // 点击照片 → 放大查看详情
        var photoArea = e.target.closest('.card-photo-wrap');
        if (photoArea) {
          e.stopPropagation();
          var pcard = photoArea.closest('.card');
          if (pcard) openView(findMeal(pcard.dataset.id));
          return;
        }
        var tag = e.target.closest('.chip.tag');
        if (tag) {
          var t = tag.dataset.tag;
          state.tag = state.tag === t ? null : t;
          render();
          return;
        }
        var card = e.target.closest('.card');
        if (!card || card.classList.contains('no-notes')) return;
        card.classList.toggle('expanded');
      });

      timelineEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var card = e.target.closest('.card');
        if (!card || card.classList.contains('no-notes')) return;
        e.preventDefault();
        card.classList.toggle('expanded');
      });
    }
  }

  /* ---------- 启动 ---------- */

  async function init() {
    var detected = await detectServer();
    if (detected) {
      state.serverMode = true;
      state.meals = sortMeals(normalizeMeals(detected.meals || []));
    } else {
      state.meals = sortMeals(normalizeMeals(Array.isArray(window.MEALS) ? window.MEALS : []));
    }

    if (state.serverMode) {
      if (document.body && document.body.classList) document.body.classList.add('server-mode');
      // 兜底：站点设置还没保存过时，用页面当前文字（HTML 默认）作为初始值
      state.site = {
        title: $('siteTitle') ? $('siteTitle').textContent.trim() : '',
        subtitle: $('siteSub') ? $('siteSub').textContent.trim() : '',
        footer: $('siteFooter') ? $('siteFooter').textContent.trim() : ''
      };
      await loadSite();
      bindSiteEdit();
    }

    bindEvents();
    bindSideNav();
    bindZoom();
    bindViewZoom();
    bindColorPickers();
    loadViewMode();
    initCalendarMonth();
    state.zoom = loadZoom();
    applyZoom();
    loadColors();
    applyCustomColors();
    loadFonts();
    applyFonts();
    loadInk();
    applyInk();
    render();
  }

  init();
})();
