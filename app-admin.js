(function () {
  "use strict";

  var STORAGE_KEY = "icbc_card_flow_v1";
  var TOKEN_KEY = "icbc_gh_token";
  var ADMIN_PWD = "admin123";
  var REPO = "xyksp/icbc-card-flow";
  var FILE_PATH = "data/users.json";
  var API_URL = "https://api.github.com/repos/" + REPO + "/contents/" + FILE_PATH;

  function log(msg, data) {
    console.log("[ICBC Admin] " + msg, data || "");
  }

  function getToken() {
    var t = localStorage.getItem(TOKEN_KEY);
    log("getToken:", t ? "Token exists (" + t.substring(0, 8) + "...)" : "Token NOT FOUND");
    return t || "";
  }

  function saveToken(token) {
    log("saveToken:", token ? "Saving token..." : "Clearing token");
    localStorage.setItem(TOKEN_KEY, token);
  }

  function b64DecodeUnicode(str) {
    try {
      // Remove BOM if present (GitHub API sometimes returns UTF-8 BOM)
      var decoded = atob(str);
      if (decoded.charCodeAt(0) === 0xFEFF || decoded.charCodeAt(0) === 0xEF && decoded.charCodeAt(1) === 0xBB && decoded.charCodeAt(2) === 0xBF) {
        decoded = decoded.replace(/^\uFEFF/, "").replace(/^\xEF\xBB\xBF/, "");
      }
      return decodeURIComponent(decoded.split("").map(function(c) {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(""));
    } catch (e) {
      log("b64DecodeUnicode error:", e.message);
      return "";
    }
  }

  function b64EncodeUnicode(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
      return String.fromCharCode("0x" + p1);
    }));
  }

  function ghApiGet(callback) {
    var token = getToken();
    log("ghApiGet starting, token length:", token.length);
    
    if (!token) {
      log("ERROR: No token in localStorage!");
      callback && callback(new Error("请先输入 GitHub Token 并登录"), null);
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_URL, true);
    xhr.setRequestHeader("Authorization", "token " + token);
    xhr.setRequestHeader("Accept", "application/vnd.github.v3+json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        log("ghApiGet response status:", xhr.status);
        log("ghApiGet response text (first 200 chars):", xhr.responseText.substring(0, 200));
        
        if (xhr.status === 200) {
          try {
            var data = JSON.parse(xhr.responseText);
            log("ghApiGet JSON parsed, has content:", !!data.content);
            var content = data.content ? b64DecodeUnicode(data.content) : "{\"users\":[]}";
            log("ghApiGet decoded content (first 100 chars):", content.substring(0, 100));
            var json = JSON.parse(content);
            callback && callback(null, { sha: data.sha, data: json });
          } catch (e) {
            log("ghApiGet PARSE ERROR:", e.message);
            callback && callback(new Error("解析失败: " + e.message), null);
          }
        } else if (xhr.status === 401) {
          log("ghApiGet 401 Unauthorized - Token invalid or expired");
          callback && callback(new Error("Token 无效或已过期，请重新输入"), null);
        } else {
          log("ghApiGet HTTP error:", xhr.status);
          callback && callback(new Error("GitHub API 错误: " + xhr.status), null);
        }
      }
    };
    xhr.onerror = function () {
      log("ghApiGet network error");
      callback && callback(new Error("网络请求失败"), null);
    };
    xhr.send();
  }

  function ghApiPut(contentObj, sha, callback) {
    var token = getToken();
    if (!token) {
      callback && callback(new Error("Token 不存在"));
      return;
    }

    var body = {
      message: "Update users.json",
      content: b64EncodeUnicode(JSON.stringify(contentObj)),
      sha: sha
    };

    var xhr = new XMLHttpRequest();
    xhr.open("PUT", API_URL, true);
    xhr.setRequestHeader("Authorization", "token " + token);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200 || xhr.status === 201) {
          callback && callback(null, JSON.parse(xhr.responseText));
        } else if (xhr.status === 409) {
          callback && callback(new Error("文件冲突，请刷新重试"));
        } else {
          callback && callback(new Error("保存失败: " + xhr.status));
        }
      }
    };
    xhr.onerror = function () {
      callback && callback(new Error("网络请求失败"));
    };
    xhr.send(JSON.stringify(body));
  }

  function renderList() {
    var listEl = document.getElementById("user-list");
    var countEl = document.getElementById("user-count");
    if (!listEl) return;

    listEl.innerHTML = "<div style=\"color:#999\">加载中...</div>";
    
    ghApiGet(function (err, result) {
      if (err) {
        log("renderList error:", err.message);
        listEl.innerHTML = "<div style=\"color:#c00\">读取失败：" + err.message + "</div>";
        return;
      }
      
      var users = result.data.users || [];
      log("renderList loaded, user count:", users.length);
      if (countEl) countEl.textContent = users.length;
      
      if (users.length === 0) {
        listEl.innerHTML = "<div style=\"color:#999\">暂无工号</div>";
        return;
      }
      
      var html = "";
      users.forEach(function (id) {
        html += "<div class=\"user-item\" style=\"padding:10px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center\">" +
          "<span>" + id + "</span>" +
          "<button class=\"btn-delete\" data-id=\"" + id + "\" style=\"padding:4px 12px;background:#c00;color:#fff;border:none;border-radius:4px;cursor:pointer\">删除</button>" +
          "</div>";
      });
      listEl.innerHTML = html;

      document.querySelectorAll(".btn-delete").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = this.getAttribute("data-id");
          if (confirm("确定删除工号 " + id + " 吗？")) {
            deleteUser(id);
          }
        });
      });
    });
  }

  function addUser() {
    var input = document.getElementById("new-gonghao");
    if (!input) {
      log("ERROR: input #new-gonghao not found!");
      alert("页面元素错误");
      return;
    }
    
    var id = input.value.trim();
    log("addUser called with id:", id);
    
    if (!/^\d{4,20}$/.test(id)) {
      alert("工号必须是4-20位数字");
      return;
    }

    ghApiGet(function (err, result) {
      if (err) {
        alert("读取失败：" + err.message);
        return;
      }
      
      var users = result.data.users || [];
      if (users.indexOf(id) >= 0) {
        alert("工号已存在");
        return;
      }
      
      users.push(id);
      ghApiPut({ users: users }, result.sha, function (err2) {
        if (err2) {
          alert(err2.message);
        } else {
          alert("新增成功");
          input.value = "";
          renderList();
        }
      });
    });
  }

  function deleteUser(id) {
    ghApiGet(function (err, result) {
      if (err) {
        alert("读取失败：" + err.message);
        return;
      }
      
      var users = result.data.users || [];
      var idx = users.indexOf(id);
      if (idx < 0) {
        alert("工号不存在");
        return;
      }
      
      users.splice(idx, 1);
      ghApiPut({ users: users }, result.sha, function (err2) {
        if (err2) {
          alert(err2.message);
        } else {
          alert("删除成功");
          renderList();
        }
      });
    });
  }

  function checkLogin() {
    var token = getToken();
    var pwd = localStorage.getItem(STORAGE_KEY + "_admin_pwd");
    log("checkLogin, has token:", !!token, "has pwd:", pwd === ADMIN_PWD);
    
    var loginSection = document.getElementById("login-section");
    var adminSection = document.getElementById("admin-section");
    
    if (!loginSection || !adminSection) return;
    
    if (token && pwd === ADMIN_PWD) {
      loginSection.style.display = "none";
      adminSection.style.display = "block";
      renderList();
    } else {
      loginSection.style.display = "block";
      adminSection.style.display = "none";
    }
  }

  function doLogin() {
    var pwdInput = document.getElementById("admin-pwd");
    var tokenInput = document.getElementById("admin-token");
    
    if (!pwdInput || !tokenInput) {
      log("ERROR: login inputs not found!");
      return;
    }
    
    var pwd = pwdInput.value.trim();
    var token = tokenInput.value.trim();
    
    log("doLogin called, pwd correct:", pwd === ADMIN_PWD, "token length:", token.length);
    
    if (pwd !== ADMIN_PWD) {
      alert("密码错误");
      return;
    }
    
    if (!token) {
      alert("请输入 GitHub Token");
      return;
    }
    
    if (!token.startsWith("ghp_")) {
      alert("Token 格式错误，应以 ghp_ 开头");
      return;
    }
    
    saveToken(token);
    localStorage.setItem(STORAGE_KEY + "_admin_pwd", pwd);
    
    log("Token saved, redirecting to admin...");
    checkLogin();
  }

  function doLogout() {
    saveToken("");
    localStorage.removeItem(STORAGE_KEY + "_admin_pwd");
    checkLogin();
  }

  function clearAll() {
    if (!confirm("确定清空所有工号吗？此操作不可恢复！")) return;
    
    ghApiGet(function (err, result) {
      if (err) {
        alert("读取失败：" + err.message);
        return;
      }
      
      ghApiPut({ users: [] }, result.sha, function (err2) {
        if (err2) {
          alert(err2.message);
        } else {
          alert("已清空");
          renderList();
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    log("DOMContentLoaded, initializing...");
    
    var btnLogin = document.getElementById("btn-login");
    var btnLogout = document.getElementById("btn-logout");
    var btnAdd = document.getElementById("btn-add");
    var btnRefresh = document.getElementById("btn-refresh");
    var btnClear = document.getElementById("btn-clear");
    
    log("Elements found:", {
      btnLogin: !!btnLogin,
      btnLogout: !!btnLogout,
      btnAdd: !!btnAdd,
      btnRefresh: !!btnRefresh,
      btnClear: !!btnClear
    });
    
    if (btnLogin) btnLogin.addEventListener("click", doLogin);
    if (btnLogout) btnLogout.addEventListener("click", doLogout);
    if (btnAdd) btnAdd.addEventListener("click", addUser);
    if (btnRefresh) btnRefresh.addEventListener("click", renderList);
    if (btnClear) btnClear.addEventListener("click", clearAll);
    
    checkLogin();
  });
})();
