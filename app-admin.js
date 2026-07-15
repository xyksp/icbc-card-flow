(function () {
  "use strict";

  var STORAGE_KEY = "icbc_card_flow_v1";
  var TOKEN_KEY = "icbc_gh_token";
  var ADMIN_PWD = "admin123";
  var REPO = "xyksp/icbc-card-flow";
  var FILE_PATH = "data/users.json";
  var API_URL = "https://api.github.com/repos/" + REPO + "/contents/" + FILE_PATH;

  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

  function getToken() {
    try { return (localStorage.getItem(TOKEN_KEY) || "").trim(); } catch (e) { return ""; }
  }
  function saveToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
  }

  function toast(m) {
    var t = $(".toast");
    if (!t) return;
    t.textContent = m;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 3000);
  }

  // UTF-8 安全 base64
  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\s/g, ""))));
  }

  // 通过 GitHub API（带 token）读取文件，返回 { sha, json }
  function ghApiGet(cb) {
    var token = getToken();
    if (!token) { cb(new Error("missing-token")); return; }
    var x = new XMLHttpRequest();
    x.open("GET", API_URL + "?t=" + Date.now(), true);
    x.setRequestHeader("Authorization", "token " + token);
    x.setRequestHeader("Accept", "application/vnd.github.v3+json");
    x.onload = function () {
      if (x.status === 200) {
        try {
          var d = JSON.parse(x.responseText);
          var json = JSON.parse(b64decode(d.content));
          cb(null, { sha: d.sha, json: json });
        } catch (e) { cb(new Error("解析失败")); }
      } else if (x.status === 404) {
        cb(null, { sha: null, json: { users: [] } });
      } else if (x.status === 401) {
        cb(new Error("Token 无效或无权限（401）"));
      } else {
        cb(new Error("HTTP " + x.status));
      }
    };
    x.onerror = function () { cb(new Error("网络错误")); };
    x.send();
  }

  // 写入文件（带 sha；sha 为 null 表示新建）
  function ghApiPut(json, sha, cb) {
    var token = getToken();
    if (!token) { cb(new Error("missing-token")); return; }
    var body = { message: "Update users", content: b64encode(JSON.stringify(json, null, 2)) };
    if (sha) body.sha = sha;
    var x = new XMLHttpRequest();
    x.open("PUT", API_URL, true);
    x.setRequestHeader("Authorization", "token " + token);
    x.setRequestHeader("Accept", "application/vnd.github.v3+json");
    x.setRequestHeader("Content-Type", "application/json");
    x.onload = function () {
      if (x.status === 200 || x.status === 201) { cb(null); }
      else if (x.status === 409) { cb(new Error("conflict")); }
      else if (x.status === 401) { cb(new Error("Token 无效或无权限（401）")); }
      else { cb(new Error("HTTP " + x.status)); }
    };
    x.onerror = function () { cb(new Error("网络错误")); };
    x.send(JSON.stringify(body));
  }

  function renderList() {
    ghApiGet(function (err, data) {
      if (err) {
        var el = document.getElementById("admin-list");
        if (el) el.innerHTML = '<div class="empty">读取失败：' + err.message + '</div>';
        toast("读取失败：" + err.message);
        return;
      }
      var gUsers = (data && data.json && data.json.users) || [];
      var s = loadState();
      var statTotal = document.getElementById("stat-total");
      var statApplied = document.getElementById("stat-applied");
      if (statTotal) statTotal.textContent = gUsers.length;
      if (statApplied) statApplied.textContent = gUsers.filter(function (u) {
        var us = s.users && s.users[u]; return us && us.idInfo;
      }).length;
      var list = document.getElementById("admin-list");
      if (!list) return;
      if (gUsers.length === 0) { list.innerHTML = '<div class="empty">暂无工号，请在上方新增</div>'; return; }
      list.innerHTML = gUsers.map(function (phone) {
        var us = s.users && s.users[phone];
        var idTxt = us && us.idInfo ? (us.idInfo.name + " / " + us.idInfo.idNo) : "（未申请）";
        var badge = us && us.idInfo ? '<span class="ai-status is-approved">已申请</span>' : '<span class="ai-status is-pending">待审核</span>';
        return '<div class="admin-item"><div class="ai-row1"><span class="ai-phone">工号 ' + phone + '</span>' + badge + '</div><div class="ai-row2">信息：' + idTxt + '</div><div class="ai-row3"><button class="btn-mini btn-reject" data-phone="' + phone + '">删除</button></div></div>';
      }).join("");
      $all(".btn-reject").forEach(function (b) {
        b.onclick = function () {
          var phone = b.dataset.phone;
          if (!confirm("确认删除工号 " + phone + "？")) return;
          ghApiGet(function (err2, data2) {
            if (err2) { toast("读取失败：" + err2.message); return; }
            var arr = ((data2 && data2.json && data2.json.users) || []).filter(function (x) { return x !== phone; });
            ghApiPut({ users: arr }, data2.sha, function (err3) {
              if (err3 && err3.message === "conflict") {
                // sha 过期，重试一次
                ghApiGet(function (e4, d4) {
                  if (e4) { toast("保存失败：" + e4.message); return; }
                  var arr2 = ((d4 && d4.json && d4.json.users) || []).filter(function (x) { return x !== phone; });
                  ghApiPut({ users: arr2 }, d4.sha, function (e5) {
                    if (e5) { toast("保存失败：" + e5.message); return; }
                    clearLocal(phone); toast("已删除 " + phone); renderList();
                  });
                });
                return;
              }
              if (err3) { toast("保存失败：" + err3.message); return; }
              clearLocal(phone); toast("已删除 " + phone); renderList();
            });
          });
        };
      });
    });
  }

  function clearLocal(phone) {
    var s = loadState();
    if (s.users && s.users[phone]) { delete s.users[phone]; saveState(s); }
  }

  function doAdd() {
    var input = document.getElementById("new-gonghao");
    var phone = input ? input.value.trim() : "";
    if (!/^\d{4,20}$/.test(phone)) { toast("请输入 4-20 位数字工号"); return; }
    var token = getToken();
    if (!token) { toast("请先填写 GitHub Token"); return; }
    ghApiGet(function (err, data) {
      if (err) { toast("读取失败：" + err.message); return; }
      var arr = (data && data.json && data.json.users) || [];
      if (arr.indexOf(phone) !== -1) { toast("工号已存在"); return; }
      arr.push(phone);
      ghApiPut({ users: arr }, data.sha, function (err2) {
        if (err2 && err2.message === "conflict") {
          ghApiGet(function (e3, d3) {
            if (e3) { toast("保存失败：" + e3.message); return; }
            var arr2 = (d3 && d3.json && d3.json.users) || [];
            if (arr2.indexOf(phone) !== -1) { toast("工号已存在"); return; }
            arr2.push(phone);
            ghApiPut({ users: arr2 }, d3.sha, function (e4) {
              if (e4) { toast("保存失败：" + e4.message); return; }
              finishAdd(phone);
            });
          });
          return;
        }
        if (err2) { toast("保存失败：" + err2.message); return; }
        finishAdd(phone);
      });
    });
  }

  function finishAdd(phone) {
    var s = loadState();
    if (!s.users) s.users = {};
    s.users[phone] = { phone: phone, createdAt: Date.now() };
    saveState(s);
    var input = document.getElementById("new-gonghao");
    if (input) input.value = "";
    toast("已新增工号 " + phone);
    renderList();
  }

  function init() {
    var btnLogin = document.getElementById("admin-login-btn");
    var btnAdd = document.getElementById("admin-add");
    var btnRefresh = document.getElementById("admin-refresh");
    var btnClear = document.getElementById("admin-clear");
    var btnLogout = document.getElementById("admin-logout");

    var loginBox = document.getElementById("admin-login");
    var panel = document.getElementById("admin-panel");

    if (btnLogin) btnLogin.onclick = function () {
      var pwd = document.getElementById("admin-pwd");
      var tokenInput = document.getElementById("admin-token");
      if (!pwd || pwd.value !== ADMIN_PWD) { toast("密码错误"); return; }
      if (!tokenInput || !tokenInput.value.trim()) { toast("请输入 GitHub Token"); return; }
      saveToken(tokenInput.value.trim());
      if (loginBox) loginBox.style.display = "none";
      if (panel) { panel.classList.remove("hidden"); panel.style.display = "block"; }
      renderList();
    };

    if (btnAdd) btnAdd.onclick = doAdd;
    if (btnRefresh) btnRefresh.onclick = renderList;

    if (btnClear) btnClear.onclick = function () {
      if (!confirm("确认清空本机缓存的申请人信息？（不影响 GitHub 上的工号列表）")) return;
      localStorage.removeItem(STORAGE_KEY);
      toast("本机缓存已清空");
      renderList();
    };

    if (btnLogout) btnLogout.onclick = function () {
      if (loginBox) loginBox.style.display = "flex";
      if (panel) { panel.classList.add("hidden"); panel.style.display = "none"; }
      var pwd = document.getElementById("admin-pwd");
      var tokenInput = document.getElementById("admin-token");
      if (pwd) pwd.value = "";
      if (tokenInput) tokenInput.value = "";
    };
  }

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
