// 精确 id 引用检查：只匹配 jQuery 风格的 $('#xxx') 和 document.getElementById("xxx")
const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname);
const htmls = ['index.html', 'admin.html'].map(f => path.join(dir, f));
const jss = ['app.js', 'app-admin.js'].map(f => path.join(dir, f));

// 1) HTML id 收集
const htmlIdRe = /\bid\s*=\s*["']([^"']+)["']/g;
const htmlIds = new Set();
const htmlIdTrace = {};
for (const h of htmls) {
  const t = fs.readFileSync(h, 'utf8');
  let m;
  htmlIdRe.lastIndex = 0;
  while ((m = htmlIdRe.exec(t))) {
    htmlIds.add(m[1]);
    htmlIdTrace[m[1]] = path.basename(h);
  }
}

// 2) JS 引用收集
//    2a)  jQuery 形式：$('#xxx') 或 $('.yyy #xxx') 之类
//         但要避开 $('.class') 中的 # 与 class 同时出现
//    2b)  document.getElementById("xxx")
const refSet = new Set();
function push(id) { if (id && /^[A-Za-z][A-Za-z0-9_\-]*$/.test(id)) refSet.add(id); }

for (const j of jss) {
  const t = fs.readFileSync(j, 'utf8');
  // jQuery: 以 $(' 开头，包含 #xxx
  // 匹配 $(' 或 $( " 后到 ' 或 " 结束的字符串，提取 #xxx
  const jqRe = /\$\(\s*['"]([^'"]*?)['"]\s*(?:,\s*[^)]*)?\)/g;
  let m;
  while ((m = jqRe.exec(t))) {
    const inside = m[1];
    // 提取 #xxx （可能有 .class 先来）
    const ids = inside.match(/#[A-Za-z][A-Za-z0-9_\-]*/g);
    if (ids) for (const s of ids) push(s.slice(1));
  }
  // getElementById
  const geiRe = /getElementById\(\s*['"]([A-Za-z][A-Za-z0-9_\-]*)['"]\s*\)/g;
  while ((m = geiRe.exec(t))) push(m[1]);
}

const missing = [];
for (const id of refSet) if (!htmlIds.has(id)) missing.push(id);

console.log('HTML id 数量:', htmlIds.size);
console.log('JS 引用 id 数量:', refSet.size);
console.log('缺失的 id:');
if (missing.length === 0) console.log('  (无) ✓');
else for (const id of missing) console.log('  - ' + id);
