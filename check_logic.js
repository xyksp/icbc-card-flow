// 静态分析 + 函数抽测
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const adm = fs.readFileSync(path.join(dir, 'admin.html'), 'utf8');
const admJs = fs.readFileSync(path.join(dir, 'app-admin.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? ' :: ' + extra : '')); }
}

// ============= 1. 卡种配置 =============
console.log('\n=== 1. 4 卡种配置（app.js CARD_TYPES）===');
{
  const types = [['standard','普卡','100元/年','消费5笔免次年年费'],
                 ['gold','金卡','500元/年','消费7笔免次年年费'],
                 ['platinum','白金卡','1000元/年','消费12笔免次年年费'],
                 ['diamond','钻石卡','2000元/年','消费20笔免次年年费']];
  for (const [k, name, fee, free] of types) {
    const keyRe = new RegExp(k + ':\\s*\\{');
    ok(k + ' 卡种存在', keyRe.test(src));
    ok(k + ' 名称 "' + name + '"', src.indexOf('tier: "' + name + '"') >= 0);
    ok(k + ' 年费 "' + fee + '"', src.indexOf(fee) >= 0);
    ok(k + ' 免年费 "' + free + '"', src.indexOf(free) >= 0);
  }
}

// ============= 2. 拍照生成 idInfo =============
console.log('\n=== 2. 拍照生成 idInfo ===');
{
  // 提取 generateIdInfo
  const m = src.match(/function generateIdInfo\(\)\s*\{[\s\S]*?\n  \}/);
  if (!m) { ok('能提取 generateIdInfo', false); }
  else {
    const sb = { Math, String, Date, console };
    vm.createContext(sb);
    vm.runInContext(m[0] + '; this._gen = generateIdInfo;', sb);
    for (let i = 0; i < 20; i++) {
      const info = sb._gen();
      if (!info.name || info.name.length < 2) { ok('第 ' + i + ' 次姓名合法', false); break; }
      if (!/^\d{18}$/.test(info.idNo)) { ok('第 ' + i + ' 次证件号 18 位', false, info.idNo); break; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(info.startDate)) { ok('第 ' + i + ' 次起始日期', false, info.startDate); break; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(info.endDate)) { ok('第 ' + i + ' 次截止日期', false, info.endDate); break; }
    }
    const info = sb._gen();
    ok('姓名非空', !!info.name && info.name.length >= 2);
    ok('证件号 18 位数字', /^\d{18}$/.test(info.idNo));
    ok('起始日期 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(info.startDate));
    ok('截止日期 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(info.endDate));
    ok('截止 = 起始 + 20 年', info.endDate.startsWith(String(parseInt(info.startDate.slice(0,4))+20)));
  }
}

// ============= 3. confirm / info 跨页回填 =============
console.log('\n=== 3. confirm / info 跨页回填 ===');
{
  for (const id of ['cf-name','cf-idno','cf-long','cf-start','cf-end','if-start','if-end']) {
    ok('app.js 引用 #' + id, src.indexOf('"#' + id + '"') >= 0);
  }
  for (const id of ['cf-name','cf-idno','cf-long','cf-start','cf-end','if-start','if-end']) {
    ok('index.html 存在 id="' + id + '"', idx.indexOf('id="' + id + '"') >= 0);
  }
  // fillConfirmFromId 和 fillInfoFromId 必须被调用
  ok('onEnterStep 调 fillConfirmFromId', src.indexOf('fillConfirmFromId()') >= 0);
  ok('onEnterStep 调 fillInfoFromId', src.indexOf('fillInfoFromId()') >= 0);
  ok('进 confirm 前 gate', src.indexOf('"confirm"') >= 0 && /if\s*\(\s*step\s*===\s*"confirm"\s*\)/.test(src));
}

// ============= 4. "模拟" 字样去掉 =============
console.log('\n=== 4. 短信"模拟"字样 ===');
{
  const toastRe = /toast\(\s*["'][^"']*模拟[^"']*["']/g;
  const bad = src.match(toastRe);
  ok('app.js toast 中无"模拟"', !bad, bad ? '命中: ' + bad.join(' | ') : '');
  // 也搜 toast 字符串字面量
  const allToasts = [...src.matchAll(/toast\(\s*["']([^"']+)["']/g)].map(m=>m[1]);
  ok('所有 toast 文案不含"模拟"', allToasts.every(t => t.indexOf('模拟') < 0), allToasts.filter(t=>t.indexOf('模拟')>=0).join(' | '));
}

// ============= 5. 守卫：未审核/未通过不能进卡片详情 =============
console.log('\n=== 5. gateApproved 守卫 ===');
{
  const m = src.match(/function gateApproved\(\)\s*\{[\s\S]*?\n  \}/);
  if (!m) ok('能提取 gateApproved', false);
  else {
    // 模拟 state
    const sb = { Math, console };
    vm.createContext(sb);
    vm.runInContext('var state = { users: {}, currentUser: null };' +
      'var getCurrentUser = function(){return state.currentUser?state.users[state.currentUser]:null;};' +
      'var toast = function(m){_lastToast=m;};' +
      'var goStep = function(s){_lastGo=s;};' +
      m[0] + '; this.gateApproved = gateApproved;', sb);

    // case 1: 无 currentUser
    sb._lastToast = ''; sb._lastGo = '';
    const r1 = sb.gateApproved();
    ok('无账号时返回 false', r1 === false);
    ok('无账号时跳转到 auth', sb._lastGo === 'auth');
    ok('无账号时 toast 提示登录', sb._lastToast.indexOf('登录') >= 0);

    // case 2: pending
    sb.state.users['13800000001'] = { status: 'pending' };
    sb.state.currentUser = '13800000001';
    sb._lastToast = ''; sb._lastGo = '';
    const r2 = sb.gateApproved();
    ok('待审核返回 false', r2 === false);
    ok('待审核跳转到 auth', sb._lastGo === 'auth');
    ok('待审核 toast 包含"审核"', sb._lastToast.indexOf('审核') >= 0);

    // case 3: rejected
    sb.state.users['13800000001'].status = 'rejected';
    sb._lastToast = ''; sb._lastGo = '';
    const r3 = sb.gateApproved();
    ok('已拒绝返回 false', r3 === false);
    ok('已拒绝跳转到 auth', sb._lastGo === 'auth');

    // case 4: approved
    sb.state.users['13800000001'].status = 'approved';
    sb._lastToast = ''; sb._lastGo = '';
    const r4 = sb.gateApproved();
    ok('已通过返回 true', r4 === true);
  }
}

// ============= 6. 退出登录 + 状态持久化 =============
console.log('\n=== 6. 退出登录与持久化 ===');
{
  ok('btn-logout 绑事件', src.indexOf('btn-logout') >= 0 && src.indexOf('addEventListener') >= 0 && /btn-logout[\s\S]{0,100}addEventListener/.test(src));
  ok('退出时清 currentUser', /state\.currentUser\s*=\s*null/.test(src));
  ok('localStorage 持久化', src.indexOf('localStorage.setItem') >= 0 && src.indexOf('localStorage.getItem') >= 0);
  ok('共享 STORAGE_KEY 与 admin 一致', src.indexOf('"icbc_card_flow_v1"') >= 0 && admJs.indexOf('"icbc_card_flow_v1"') >= 0);
}

// ============= 7. admin.html 入口和默认密码 =============
console.log('\n=== 7. admin 后台 ===');
{
  ok('auth 页 不再有 admin.html 入口（后台独立）', idx.indexOf('auth-admin-link') < 0 && idx.indexOf('>进入审核后台') < 0);
  ok('admin.html 存在', fs.existsSync(path.join(dir, 'admin.html')));
  ok('app-admin.js 存在', fs.existsSync(path.join(dir, 'app-admin.js')));
  ok('admin.html 提示默认密码', adm.indexOf('admin123') >= 0);
  ok('app-admin.js 默认密码 admin123', /ADMIN_PWD\s*=\s*["']admin123["']/.test(admJs));
  ok('app-admin.js 有 通过/拒绝 操作', admJs.indexOf('"approved"') >= 0 && admJs.indexOf('"rejected"') >= 0);
  ok('app-admin.js 渲染 user 列表', admJs.indexOf('renderList') >= 0 && admJs.indexOf('Object.values') >= 0);
}

// ============= 7b. 登录页文案精简：去 logo 副标、去登录 tip、去 admin link、手机号→工号 =============
console.log('\n=== 7b. 登录页文案精简 ===');
{
  ok('logo 不再有 <p>信用卡申请</p>', !/<p>\s*信用卡申请\s*<\/p>/.test(idx));
  ok('登录表单 不再有 "未注册的账号" 提示', idx.indexOf('未注册的账号') < 0);
  ok('登录 label = 工号', /<label>\s*工号\s*<\/label>/.test(idx));
  ok('登录 placeholder = 请输入工号', idx.indexOf('placeholder="请输入工号"') >= 0);
  ok('注册 label = 工号', (idx.match(/<label>\s*工号\s*<\/label>/g) || []).length >= 2);
  ok('注册 placeholder = 请输入工号', (idx.match(/placeholder="请输入工号"/g) || []).length >= 2);
  ok('顶栏 “账号：” 改 “工号：”', idx.indexOf('工号：<em id="user-phone-show"') >= 0);
  ok('app.js 工号正则 = 4-20 位数字', src.indexOf('/^\\d{4,20}$/') >= 0);
  ok('app.js toast “请输入正确的工号”', src.indexOf('请输入正确的工号') >= 0);
  ok('app.js toast “该工号已注册”', src.indexOf('该工号已注册') >= 0);
  ok('app.js 不再有 11位手机号', src.indexOf('11位手机号') < 0);
  ok('app.js 不再有 手机号 正则 /^1\\d{10}$/（仅确认/获取验证码处保留）',
      (src.match(/\/\^1\\d\{10\}\$\//g) || []).length === 2); // 确认页 + confirm sms
}

// ============= 8. 拍照门控：两张都拍才能下一步 =============
console.log('\n=== 8. 拍身份证门控 ===');
{
  ok('frontShot 标志', /\bfrontShot\b/.test(src));
  ok('backShot 标志', /\bbackShot\b/.test(src));
  ok('btn-captured 初始 disabled', /btn-captured[\s\S]{0,200}disabled/.test(src));
  ok('两张都拍才生成 idInfo', /frontShot\s*&&\s*backShot[\s\S]{0,200}idInfo/.test(src));
}

// ============= 9. confirm 页"已发送（模拟）" 改 "已发送" =============
console.log('\n=== 9. confirm 页验证码文案 ===');
{
  ok('toast "验证码已发送"（无"模拟"）', src.indexOf('验证码已发送') >= 0);
  ok('无"已发送（模拟）"字符串', src.indexOf('已发送（模拟）') < 0 && src.indexOf('已发送(模拟)') < 0);
}

console.log(`\n\u7ed3\u679c\uff1a\u901a\u8fc7 ${pass} / \u5931\u8d25 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
