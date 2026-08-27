#!/usr/bin/env node
/* ============================================================
   二人食记 — 本地服务（零依赖，只用 Node 内置模块）
   用法：npm start  或  双击「启动二人食记.bat」
   默认地址：http://localhost:5180

   提供：
   - 静态文件（index.html / css / js / data / photos）
   - 网页增删改 API
       GET    /api/data         读取全部记录
       GET    /api/photos       列出 photos/ 里的图片（含是否已被使用）
       POST   /api/meals        新增一餐（photos: 照片路径数组 / photo: 兼容旧字段）
       PUT    /api/meals/:id    编辑一餐
       DELETE /api/meals/:id    删除一餐
       POST   /api/upload       上传单张照片（multipart/form-data, 字段名 file）
   ============================================================ */

import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, normalize, basename } from 'node:path';
import { spawn } from 'node:child_process';
import {
  ROOT, PHOTO_DIR, PHOTO_EXTS, MEALS, CATEGORIES,
  isValidDate, parseDateFromName, suggestMeal,
  loadMeals, saveMeals, makeId, parseTags, isSafePhotoPath,
  loadSite, saveSite,
} from './scripts/lib.js';

const START_PORT = Number(process.env.PORT) || 5180;
const MAX_BODY = 64 * 1024 * 1024; // 64MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/* ---------- 响应工具 ---------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function ok(res, obj) { sendJson(res, 200, { ok: true, ...obj }); }
function fail(res, status, error) { sendJson(res, status, { ok: false, error }); }

/** URL.pathname 不解码百分号，这里手动解一次；非法编码原样返回 */
function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- 照片上传（手写 multipart 解析，零依赖） ---------- */

function sanitizeFilename(name) {
  let n = basename(String(name || '').replace(/\\/g, '/')).trim();
  n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  if (!n || n === '.' || n === '..') n = 'photo-' + Date.now() + '.jpg';
  return n;
}

function parseMultipart(buf, boundary) {
  const parts = [];
  const marker = Buffer.from('--' + boundary);
  let pos = 0;
  for (;;) {
    const start = buf.indexOf(marker, pos);
    if (start === -1) break;
    let end = buf.indexOf(marker, start + marker.length);
    if (end === -1) end = buf.length;
    const headEnd = buf.indexOf('\r\n\r\n', start + marker.length);
    if (headEnd === -1 || headEnd > end) { pos = start + marker.length; continue; }
    const header = buf.slice(start + marker.length, headEnd).toString('utf8');
    let data = buf.slice(headEnd + 4, end);
    // 去掉每个 part 结尾的 \r\n
    if (data.length >= 2 && data[data.length - 2] === 13 && data[data.length - 1] === 10) {
      data = data.subarray(0, data.length - 2);
    }
    const nameM = header.match(/name="([^"]*)"/);
    const fileM = header.match(/filename="([^"]*)"/);
    if (nameM) parts.push({ name: nameM[1], filename: fileM ? fileM[1] : null, data });
    pos = end + marker.length;
  }
  return parts;
}

async function handleUpload(req, res) {
  const ctype = req.headers['content-type'] || '';
  const bm = ctype.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!bm) return fail(res, 400, '缺少 multipart boundary');
  const buf = await readBody(req);
  const parts = parseMultipart(buf, bm[1] || bm[2]);
  const file = parts.find((p) => p.name === 'file' && p.filename && p.data.length > 0);
  if (!file) return fail(res, 400, '没有收到文件（字段名应为 file）');

  const ext = extname(file.filename).toLowerCase();
  if (!PHOTO_EXTS.includes(ext)) {
    return fail(res, 400, '仅支持图片格式：jpg / jpeg / png / webp / gif');
  }

  let name = sanitizeFilename(file.filename);
  if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });
  if (existsSync(join(PHOTO_DIR, name))) {
    name = `${Date.now()}-${name}`; // 重名则加时间戳前缀
  }
  writeFileSync(join(PHOTO_DIR, name), file.data);
  const photo = 'photos/' + name;

  // 尝试从文件名/修改时间识别日期和餐次，方便前端预填
  const det = parseDateFromName(name);
  const mtime = statSync(join(PHOTO_DIR, name)).mtime;
  const date = det ? det.date : `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`;
  const hour = det ? det.hour : mtime.getHours();

  ok(res, { photo, date, meal: suggestMeal(hour) });
}

/* ---------- 记录校验与增删改 ---------- */

function validateMealPayload(body, { requirePhoto }) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const meal = typeof body.meal === 'string' ? body.meal.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const notes = typeof body.notes === 'string' ? String(body.notes).trim() : '';
  const tags = Array.isArray(body.tags) ? body.tags : [];

  if (!title || title.length > 200) return { error: '标题不能为空，且不超过 200 字' };
  const dm = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!dm || !isValidDate(+dm[1], +dm[2], +dm[3])) return { error: '日期格式不正确' };
  if (!MEALS.includes(meal)) return { error: '餐次只能是：早餐/午餐/晚餐/加餐' };
  if (category && !CATEGORIES.includes(category)) return { error: '分类只能是：自制/外食' };
  if (notes.length > 2000) return { error: '备注太长（最多 2000 字）' };

  const cleanTags = [...new Set(tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))]
    .slice(0, 20)
    .map((t) => t.slice(0, 20));

  return {
    value: {
      date: `${dm[1]}-${String(+dm[2]).padStart(2, '0')}-${String(+dm[3]).padStart(2, '0')}`,
      title,
      meal,
      category,
      tags: cleanTags,
      notes,
    },
  };
}

const MAX_PHOTOS = 9;

/** 解析照片数组：优先 body.photos，兼容旧字段 body.photo；update 时缺省保留原值 */
function resolvePhotos(body, existing) {
  if (Array.isArray(body.photos)) {
    const arr = body.photos.filter((p) => typeof p === 'string');
    if (arr.length === 0) return { error: '请至少选择或上传一张照片' };
    if (arr.length > MAX_PHOTOS) return { error: `照片最多 ${MAX_PHOTOS} 张` };
    for (const p of arr) {
      if (!photoExists(p)) return { error: '照片路径无效：' + p };
    }
    return { photos: arr };
  }
  if (typeof body.photo === 'string' && body.photo) {
    if (!photoExists(body.photo)) return { error: '照片路径无效' };
    return { photos: [body.photo] };
  }
  if (existing) {
    const cur = Array.isArray(existing.photos) && existing.photos.length ? existing.photos
      : (existing.photo ? [existing.photo] : []);
    return { photos: cur };
  }
  return { error: '请至少选择或上传一张照片' };
}

function handleList(res) {
  const meals = loadMeals();
  ok(res, { meals });
}

function handlePhotos(res) {
  const meals = loadMeals();
  const used = new Set();
  meals.forEach((m) => {
    const arr = Array.isArray(m.photos) && m.photos.length ? m.photos : (m.photo ? [m.photo] : []);
    arr.forEach((p) => used.add(String(p || '').replace(/\\/g, '/')));
  });
  const photos = [];
  if (existsSync(PHOTO_DIR)) {
    for (const f of readdirSync(PHOTO_DIR)) {
      if (!PHOTO_EXTS.includes(extname(f).toLowerCase())) continue;
      const rel = 'photos/' + f;
      photos.push({ path: rel, used: used.has(rel) });
    }
    photos.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
  }
  ok(res, { photos });
}

function photoExists(photo) {
  if (!isSafePhotoPath(photo)) return false;
  const file = join(PHOTO_DIR, photo.slice('photos/'.length));
  return existsSync(file) && statSync(file).isFile();
}

async function handleCreate(req, res) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  const { value, error } = validateMealPayload(body, { requirePhoto: true });
  if (error) return fail(res, 400, error);

  const { photos, error: photoErr } = resolvePhotos(body, null);
  if (photoErr) return fail(res, 400, photoErr);

  const meals = loadMeals();
  const meal = { id: makeId(value.date, value.meal, meals), photos, photo: photos[0], ...value };
  meals.push(meal);
  saveMeals(meals);
  ok(res, { meal });
}

async function handleUpdate(req, res, id) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  const { value, error } = validateMealPayload(body, { requirePhoto: false });
  if (error) return fail(res, 400, error);

  const meals = loadMeals();
  const idx = meals.findIndex((m) => m.id === id);
  if (idx === -1) return fail(res, 404, '没找到这条记录');

  const { photos, error: photoErr } = resolvePhotos(body, meals[idx]);
  if (photoErr) return fail(res, 400, photoErr);

  const meal = { ...meals[idx], ...value, id, photos, photo: photos[0] };
  meals[idx] = meal;
  saveMeals(meals);
  ok(res, { meal });
}

function handleDelete(res, id) {
  const meals = loadMeals();
  const idx = meals.findIndex((m) => m.id === id);
  if (idx === -1) return fail(res, 404, '没找到这条记录');
  meals.splice(idx, 1);
  saveMeals(meals);
  ok(res, {});
}

/** 批量更新：给指定 id 的记录统一设置分类 / 餐次（未提供的字段保持不变） */
async function handleBatchUpdate(req, res) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (!ids.length) return fail(res, 400, '没有选中的记录');

  const set = {};
  if (typeof body.category === 'string' && CATEGORIES.includes(body.category)) set.category = body.category;
  if (typeof body.meal === 'string' && MEALS.includes(body.meal)) set.meal = body.meal;
  if (!Object.keys(set).length) return fail(res, 400, '没有要修改的字段');

  const meals = loadMeals();
  let updated = 0;
  meals.forEach((m) => {
    if (ids.includes(m.id)) {
      if (set.category !== undefined) m.category = set.category;
      if (set.meal !== undefined) m.meal = set.meal;
      updated++;
    }
  });
  saveMeals(meals);
  ok(res, { updated });
}

/** 批量删除：删除指定 id 的记录（照片文件不删） */
async function handleBatchDelete(req, res) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (!ids.length) return fail(res, 400, '没有选中的记录');

  const meals = loadMeals();
  const before = meals.length;
  const kept = meals.filter((m) => !ids.includes(m.id));
  saveMeals(kept);
  ok(res, { deleted: before - kept.length });
}

/* ---------- 站点设置（标题 / 副标题） ---------- */

function handleGetSite(res) {
  ok(res, { site: loadSite() });
}

async function handlePutSite(req, res) {
  const body = JSON.parse((await readBody(req)).toString('utf8'));
  // 部分更新：只覆盖请求里提供的字段，其余保留现有值
  const prev = loadSite() || { title: '', subtitle: '', footer: '' };
  const title = typeof body.title === 'string' ? body.title.trim() : prev.title;
  const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim() : prev.subtitle;
  const footer = typeof body.footer === 'string' ? body.footer.trim() : prev.footer;
  if (!title) return fail(res, 400, '标题不能为空');
  if (title.length > 50) return fail(res, 400, '标题太长（最多 50 字）');
  if (subtitle.length > 100) return fail(res, 400, '副标题太长（最多 100 字）');
  if (footer.length > 50) return fail(res, 400, '页脚文字太长（最多 50 字）');
  const site = { title, subtitle, footer };
  saveSite(site);
  ok(res, { site });
}

/* ---------- 静态文件 ---------- */

function serveStatic(res, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return fail(res, 400, '非法路径');
  }
  if (p === '/' || p === '') p = '/index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    return fail(res, 404, '文件不存在');
  }
  const ext = extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
}

/* ---------- 路由 ---------- */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    if (path === '/api/data' && method === 'GET') return handleList(res);
    if (path === '/api/photos' && method === 'GET') return handlePhotos(res);
    if (path === '/api/meals' && method === 'POST') return await handleCreate(req, res);
    if (path === '/api/meals/batch-update' && method === 'POST') return await handleBatchUpdate(req, res);
    if (path === '/api/meals/batch-delete' && method === 'POST') return await handleBatchDelete(req, res);
    if (path === '/api/upload' && method === 'POST') return await handleUpload(req, res);
    if (path === '/api/site' && method === 'GET') return handleGetSite(res);
    if (path === '/api/site' && method === 'PUT') return await handlePutSite(req, res);

    const m = path.match(/^\/api\/meals\/([^/]+)$/);
    if (m && method === 'PUT') return await handleUpdate(req, res, decodeURIComponentSafe(m[1]));
    if (m && method === 'DELETE') return handleDelete(res, decodeURIComponentSafe(m[1]));

    if (path.startsWith('/api/')) return fail(res, 404, '接口不存在');

    return serveStatic(res, req.url);
  } catch (e) {
    if (e instanceof SyntaxError) return fail(res, 400, '请求体不是合法的 JSON');
    fail(res, 500, e.message || '服务器出错');
  }
});

/* ---------- 启动（端口被占用时自动 +1 尝试） ---------- */

function listen(port, triesLeft) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && triesLeft > 0) {
      console.log(`端口 ${port} 被占用，尝试 ${port + 1} …`);
      listen(port + 1, triesLeft - 1);
    } else {
      console.error('启动失败：' + e.message);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    console.log('');
    console.log('📖 二人食记已启动');
    console.log(`   请用浏览器打开：http://localhost:${port}`);
    console.log('   关闭本窗口即可停止服务。\n');
    if (process.stdout.isTTY && process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', `http://localhost:${port}`], { windowsHide: true, detached: true });
    }
  });
}

listen(START_PORT, 10);
