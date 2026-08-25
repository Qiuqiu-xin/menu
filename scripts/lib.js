/* ============================================================
   二人食记 — 公共模块（数据读写 / 日期识别 / 校验）
   被 scripts/add.js 和 server.js 共用
   ============================================================ */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PHOTO_DIR = join(ROOT, 'photos');
export const DATA_FILE = join(ROOT, 'data', 'data.js');
export const SITE_FILE = join(ROOT, 'data', 'site.js');

export const PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
export const MEALS = ['早餐', '午餐', '晚餐', '加餐'];

export const DATA_HEADER = `// 二人食记数据文件 — 由本地服务（server.js）或 scripts/add.js 自动维护，也可手动编辑
// 字段：id(唯一) / date(YYYY-MM-DD) / title(标题) / photo(照片路径) / meal(餐次: 早餐|午餐|晚餐|加餐) / tags(标签数组) / notes(备注)
`;

/* ---------- 日期 ---------- */

export function isValidDate(y, mo, d) {
  if (!(y >= 2000 && y <= 2100) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

export function fmtDate(y, mo, d) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 从文件名识别日期与时间。返回 { date, hour } 或 null */
export function parseDateFromName(name) {
  // 分隔格式：2025-03-15 / 2025.3.15 / 2025_03_15
  const m = name.match(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (isValidDate(y, mo, d)) {
      return { date: fmtDate(y, mo, d), hour: parseHour(name) };
    }
  }
  // 相机命名：IMG_20250315_143012 / 20250315
  const m2 = name.match(/(\d{4})(\d{2})(\d{2})(?:_(\d{2})(\d{2}))?/);
  if (m2) {
    const y = +m2[1], mo = +m2[2], d = +m2[3];
    if (isValidDate(y, mo, d)) {
      const h = m2[4] != null ? +m2[4] : null;
      return { date: fmtDate(y, mo, d), hour: h != null ? h : parseHour(name) };
    }
  }
  return null;
}

function parseHour(name) {
  const m = name.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const h = +m[1];
    if (h >= 0 && h <= 23) return h;
  }
  return null;
}

/** 按小时建议餐次 */
export function suggestMeal(hour) {
  const h = hour == null ? 12 : hour;
  if (h >= 5 && h < 10) return '早餐';
  if (h >= 10 && h < 15) return '午餐';
  if (h >= 15 && h < 21) return '晚餐';
  return '加餐';
}

/* ---------- 数据读写 ---------- */

export function loadMeals() {
  const text = readFileSync(DATA_FILE, 'utf8');
  const m = text.match(/window\.MEALS\s*=\s*(\[[\s\S]*\])\s*;?/);
  if (!m) throw new Error(`无法解析 ${DATA_FILE}`);
  return JSON.parse(m[1]);
}

export function saveMeals(meals) {
  writeFileSync(DATA_FILE, DATA_HEADER + 'window.MEALS = ' + JSON.stringify(meals, null, 2) + ';\n', 'utf8');
}

/** 读取站点设置（标题/副标题/页脚）。文件不存在或损坏时返回 null */
export function loadSite() {
  try {
    const text = readFileSync(SITE_FILE, 'utf8');
    const m = text.match(/window\.SITE\s*=\s*(\{[\s\S]*\})\s*;?/);
    if (!m) return null;
    const obj = JSON.parse(m[1]);
    return {
      title: typeof obj.title === 'string' ? obj.title : '',
      subtitle: typeof obj.subtitle === 'string' ? obj.subtitle : '',
      footer: typeof obj.footer === 'string' ? obj.footer : '',
    };
  } catch {
    return null;
  }
}

export function saveSite(site) {
  const header = '// 二人食记站点设置 — 由网页上双击标题/副标题/页脚后自动保存\n';
  writeFileSync(SITE_FILE, header + 'window.SITE = ' + JSON.stringify({
    title: site.title, subtitle: site.subtitle, footer: site.footer,
  }, null, 2) + ';\n', 'utf8');
}

/** 生成唯一 id：date-meal，冲突时追加 -2、-3… */
export function makeId(date, meal, meals) {
  const base = `${date}-${meal}`;
  let id = base;
  let n = 2;
  while (meals.some((m) => m.id === id)) id = `${base}-${n++}`;
  return id;
}

/** 解析用户输入的标签：按逗号/顿号/空白分隔，去重 */
export function parseTags(raw) {
  return raw ? [...new Set(String(raw).split(/[,，、\s]+/).filter(Boolean))] : [];
}

/* ---------- 照片 ---------- */

/** 列出 photos/ 里所有图片文件（未登记的新照片） */
export function listNewPhotos(meals) {
  const used = new Set((meals || []).map((m) => String(m.photo || '').replace(/\\/g, '/')));
  const items = [];
  for (const f of readdirSync(PHOTO_DIR)) {
    if (!PHOTO_EXTS.includes(extname(f).toLowerCase())) continue;
    const rel = 'photos/' + f;
    if (used.has(rel)) continue;
    items.push(rel);
  }
  return items.sort();
}

/** 照片路径是否合法：必须是 photos/ 下的图片文件 */
export function isSafePhotoPath(photo) {
  if (typeof photo !== 'string') return false;
  if (!photo.startsWith('photos/')) return false;
  const name = photo.slice('photos/'.length);
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  if (!PHOTO_EXTS.includes(extname(name).toLowerCase())) return false;
  return true;
}
