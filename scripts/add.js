#!/usr/bin/env node
/* ============================================================
   二人食记 — 添加新餐次的交互式脚本（备用方案）
   日常推荐直接用网页：npm start 后点「＋ 添加一餐」
   本脚本保留给喜欢命令行的场景：node scripts/add.js（或 npm run add）

   流程：
   1. 扫描 photos/ 里还没登记过的照片（jpg/jpeg/png/webp/gif）
   2. 选择一张照片
   3. 日期默认取文件名里的日期（2025-03-15 或 IMG_20250315_xxxx），
      没有则取文件的修改时间，可手动修改
   4. 餐次按拍摄时间自动建议，可手动修改
   5. 输入标题 / 标签 / 备注，写入 data/data.js
   ============================================================ */

import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOT, PHOTO_DIR, PHOTO_EXTS, MEALS,
  isValidDate, fmtDate, parseDateFromName, suggestMeal,
  loadMeals, saveMeals, makeId, listNewPhotos,
} from './lib.js';

/* ---------- 行输入（兼容 TTY 与管道/EOF，避免 readline/promises 丢行） ---------- */

const rl = createInterface({ input, output });
const pendingLines = [];
const waiters = [];
let eof = false;

rl.on('line', (l) => {
  if (waiters.length) waiters.shift()(l);
  else pendingLines.push(l);
});
rl.on('close', () => {
  eof = true;
  while (waiters.length && pendingLines.length) waiters.shift()(pendingLines.shift());
  while (waiters.length) waiters.shift()('');
});

/** 与 rl.question 同款：显示提示并等待一行输入；EOF 时返回 '' */
function question(prompt) {
  output.write(prompt);
  if (pendingLines.length) return Promise.resolve(pendingLines.shift());
  if (eof) return Promise.resolve('');
  return new Promise((resolve) => waiters.push(resolve));
}

/* ---------- 主流程 ---------- */

async function main() {
  console.log('📖 二人食记 — 添加新餐次（命令行备用方案）\n');

  let meals;
  try {
    meals = loadMeals();
  } catch (e) {
    console.error('读取数据失败：' + e.message);
    process.exit(1);
  }

  if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });

  let pending = listNewPhotos(meals);
  if (pending.length === 0) {
    console.log('photos/ 里没有可添加的新照片。');
    console.log('请先把照片复制到 photos/ 文件夹（jpg / png / webp / gif），再重新运行本脚本。');
    rl.close();
    return;
  }

  while (pending.length > 0) {
    console.log(`\n待添加的照片（剩 ${pending.length} 张）：`);
    pending.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

    const ans = (await question('\n请输入照片编号（回车 = 退出）：')).trim();
    if (ans === '') break;
    const idx = parseInt(ans, 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.length) {
      console.log('无效编号，请重试。');
      continue;
    }
    const photo = pending[idx];

    // ---- 日期 ----
    const stat = statSync(join(ROOT, photo));
    const detected = parseDateFromName(photo);
    let date = detected ? detected.date : fmtDate(stat.mtime.getFullYear(), stat.mtime.getMonth() + 1, stat.mtime.getDate());
    let hour = detected ? detected.hour : stat.mtime.getHours();

    const dateAns = (await question(`日期 [${date}]（回车确认，或输入 2025-03-15）：`)).trim();
    if (dateAns) {
      const mm = dateAns.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!mm || !isValidDate(+mm[1], +mm[2], +mm[3])) {
        console.log('日期格式不正确，跳过这张照片。');
        continue;
      }
      date = fmtDate(+mm[1], +mm[2], +mm[3]);
    }

    // ---- 餐次 ----
    const sugMeal = suggestMeal(hour);
    const mealAns = (await question(`餐次 [${sugMeal}]（回车确认，或输入：早餐/午餐/晚餐/加餐）：`)).trim();
    const meal = mealAns || sugMeal;
    if (!MEALS.includes(meal)) {
      console.log('餐次无效（只能填：早餐/午餐/晚餐/加餐），跳过这张照片。');
      continue;
    }

    // ---- 标题 ----
    let title = '';
    let attempts = 0;
    while (!title.trim() && attempts < 3) {
      title = (await question('标题（如：晚餐：糖醋排骨 + 番茄蛋汤）：')).trim();
      if (!title) console.log('标题不能为空。');
      attempts++;
    }
    if (!title.trim()) {
      console.log('标题仍为空，跳过这张照片。');
      continue;
    }

    // ---- 标签 / 备注 ----
    const tagsRaw = (await question('标签（逗号分隔，可留空，如：家常菜, 快手菜）：')).trim();
    const tags = tagsRaw ? [...new Set(tagsRaw.split(/[,，、\s]+/).filter(Boolean))] : [];
    const notes = (await question('备注（可留空）：')).trim();

    // ---- 保存 ----
    const id = makeId(date, meal, meals);
    meals.push({ id, date, title, photo, meal, tags, notes });
    saveMeals(meals);
    console.log(`\n✅ 已保存：${title}（${date} · ${meal}）`);
    pending.splice(idx, 1);
  }

  console.log('\n完成！打开 index.html 即可查看。');
  rl.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('出错了：' + e.message);
    process.exit(1);
  });
}
