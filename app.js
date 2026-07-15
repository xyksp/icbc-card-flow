(function () {
  "use strict";

  var STORAGE_KEY = "icbc_card_flow_v1";
  function defaultState() { return { users: {}, currentUser: null }; }
  function loadState() {
    try { var s = JSON.parse(localStorage.getItem(STORAGE_KEY)); return s || defaultState(); }
    catch (e) { return defaultState(); }
  }
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  var state = loadState();
  function getCurrentUser() { return state.currentUser ? state.users[state.currentUser] : null; }

  var CARD_TYPES = {
    standard: { name: "工商银行国航牡丹卡", sub: "100元/年，消费5笔免次年年费", tier: "普卡", minLimit: 3000, maxLimit: 8000 },
    gold:     { name: "工商银行国航牡丹卡", sub: "500元/年，消费7笔免次年年费", tier: "金卡", minLimit: 15000, maxLimit: 30000 },
    platinum: { name: "工商银行国航牡丹卡", sub: "1000元/年，消费12笔免次年年费", tier: "白金卡", minLimit: 35000, maxLimit: 60000 },
    diamond:  { name: "工商银行国航牡丹卡", sub: "2000元/年，消费20笔免次年年费", tier: "钻石卡", minLimit: 65000, maxLimit: 100000 }
  };

  function rollLimit(type) {
    var cfg = CARD_TYPES[type] || CARD_TYPES.standard;
    var lo = Math.ceil(cfg.minLimit / 1000);
    var hi = Math.floor(cfg.maxLimit / 1000);
    var k = lo + Math.floor(Math.random() * (hi - lo + 1));
    return (k * 1000) + ".00";
  }

  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var reviewTimer = null;
  var pendingApplyNo = null;
  var pendingUser = null;
  var toastTimer = null;
  var isNavigating = false; // 防止重复导航

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  var STEP_ORDER = ["auth", "card", "capture", "info", "other", "review", "done", "fee", "success"];
  function getStepIndex(step) { return STEP_ORDER.indexOf(step); }
  
  function goStep(step) {
    if (isNavigating) return;
    isNavigating = true;
    setTimeout(function () { isNavigating = false; }, 300);
    
    if (step !== "review") {
      if (reviewTimer) { clearTimeout(reviewTimer); reviewTimer = null; }
    }
    
    var pages = document.querySelectorAll(".page");
    pages.forEach(function (p) { 
      p.classList.add("hidden"); 
      p.style.display = "none";
    });
    
    var el = document.getElementById("page-" + step);
    if (!el) { isNavigating = false; return; }
    el.classList.remove("hidden");
    el.style.display = "";
    app.scrollTop = 0;
    var sc = $(".scroll", el);
    if (sc) sc.scrollTop = 0;
    if (location.hash !== "#" + step) history.replaceState(null, "", "#" + step);
    updateNavButtons(step);
    onEnterStep(step);
  }

  function updateNavButtons(step) {
    var idx = getStepIndex(step);
    $all("[data-nav-prev]").forEach(function (btn) {
      btn.disabled = idx <= 1;
      btn.classList.toggle("is-disabled", idx <= 1);
    });
    $all("[data-nav-next]").forEach(function (btn) {
      if (step === "auth") {
        btn.disabled = true; btn.classList.add("is-disabled");
      } else if (step === "card") {
        var agree = document.getElementById("agree-box");
        btn.disabled = !agree.checked;
        btn.classList.toggle("is-disabled", !agree.checked);
      } else if (step === "capture") {
        btn.disabled = !(frontShot && backShot);
        btn.classList.toggle("is-disabled", !(frontShot && backShot));
      } else if (step === "review" || step === "done") {
        btn.disabled = true; btn.classList.add("is-disabled");
      } else {
        btn.disabled = false; btn.classList.remove("is-disabled");
      }
    });
  }

  $all("[data-nav-prev]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      var current = ($all(".page").find(function (p) { return !p.classList.contains("hidden"); }) || {}).dataset?.step || "auth";
      var idx = getStepIndex(current);
      if (idx > 1) goStep(STEP_ORDER[idx - 1]);
    });
  });
  $all("[data-nav-next]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      var current = ($all(".page").find(function (p) { return !p.classList.contains("hidden"); }) || {}).dataset?.step || "auth";
      var idx = getStepIndex(current);
      if (idx < STEP_ORDER.length - 1 && idx >= 1) goStep(STEP_ORDER[idx + 1]);
    });
  });

  function onEnterStep(step) {
    if (step === "card") {
      if (!gateApproved()) return;
      var u = getCurrentUser();
      applyCardType((u && u.selectedCard) || "standard");
    } else if (step === "info") {
      if (!gateApproved()) return;
      var u = getCurrentUser();
      if (!u || !u.idInfo) { toast("请先扫描身份证"); goStep("capture"); return; }
    } else if (step === "review") {
      if (!gateApproved()) return;
      startReviewCountdown();
    } else if (step === "done") {
      if (!gateApproved()) return;
      fillDoneInfo();
    }
  }

  function gateApproved() {
    var u = getCurrentUser();
    if (!u) { toast("请先登录"); goStep("auth"); return false; }
    return true;
  }

  function startReviewCountdown() {
    reviewTimer = setTimeout(function () {
      reviewTimer = null;
      goStep("done");
    }, 120000);
  }

  function fillDoneInfo() {
    var u = pendingUser || getCurrentUser();
    var cardKey = (u && u.selectedCard) || "standard";
    var cfg = CARD_TYPES[cardKey] || CARD_TYPES.standard;
    var cardEl = document.getElementById("done-card-name");
    if (cardEl) cardEl.textContent = cfg.name + "（" + cfg.tier + "）";
    var limitEl = document.getElementById("done-limit");
    if (limitEl) limitEl.textContent = rollLimit(cardKey) + " 元";
    var noEl = document.getElementById("apply-no");
    if (noEl) noEl.textContent = pendingApplyNo || ("ICBC" + Date.now().toString().slice(-10));
    var nameEl = document.getElementById("done-user-name");
    var idnoEl = document.getElementById("done-user-idno");
    var phoneEl = document.getElementById("done-user-phone");
    if (nameEl) nameEl.textContent = (u && u.idInfo && u.idInfo.name) || "—";
    if (idnoEl) idnoEl.textContent = (u && u.idInfo && u.idInfo.idNo) || "—";
    if (phoneEl) phoneEl.textContent = (u && u.idInfo && u.idInfo.phone) || "—";
  }

  function fillFeeInfo() {
    var u = pendingUser || getCurrentUser();
    var cardKey = (u && u.selectedCard) || "standard";
    var cfg = CARD_TYPES[cardKey] || CARD_TYPES.standard;
    var nameEl = document.getElementById("fee-card-name");
    var descEl = document.getElementById("fee-desc");
    if (nameEl) nameEl.textContent = cfg.name + "（" + cfg.tier + "）";
    if (descEl) descEl.textContent = cfg.sub;
  }

  function applyCardType(type) {
    var cfg = CARD_TYPES[type] || CARD_TYPES.standard;
    var name = $("#card-name"), sub = $("#card-sub"), tier = $("#card-tier-name"), card = $("#credit-card");
    if (name) name.textContent = cfg.name;
    if (sub) sub.textContent = cfg.sub;
    if (tier) tier.textContent = cfg.tier;
    if (card) card.setAttribute("data-tier", type);
    $all(".card-tab").forEach(function (t) { t.classList.toggle("is-on", t.dataset.card === type); });
  }

  // 登录
  var USERS_JSON_URL = "https://xyksp.github.io/icbc-card-flow/data/users.json";
  var usersCache = null;
  function fetchUsers(callback) {
    if (usersCache) { callback(usersCache); return; }
    var xhr = new XMLHttpRequest();
    xhr.open("GET", USERS_JSON_URL + "?t=" + Date.now(), true);
    xhr.onload = function () {
      try { usersCache = JSON.parse(xhr.responseText).users || []; } catch (e) { usersCache = []; }
      callback(usersCache);
    };
    xhr.onerror = function () { usersCache = []; callback(usersCache); };
    xhr.send();
  }
  document.getElementById("btn-login").addEventListener("click", function () {
    var phone = $("#login-phone").value.trim();
    if (!/^\d{4,20}$/.test(phone)) { toast("请输入正确的工号"); return; }
    fetchUsers(function (list) {
      if (list.indexOf(phone) === -1) { toast("工号未授权，请联系管理员"); return; }
      state.currentUser = phone;
      if (!state.users[phone]) {
        state.users[phone] = { phone: phone, createdAt: Date.now(), idInfo: null, selectedCard: "standard" };
      }
      saveState();
      toast("登录成功");
      goStep("card");
    });
  });

  // 卡种切换
  $all(".card-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var type = tab.dataset.card;
      var u = getCurrentUser();
      if (u) { u.selectedCard = type; saveState(); }
      applyCardType(type);
    });
  });

  // 同意勾选
  var agree = document.getElementById("agree-box");
  var btnStart = document.getElementById("btn-start");
  agree.addEventListener("change", function () {
    btnStart.disabled = !agree.checked;
    btnStart.classList.toggle("is-disabled", !agree.checked);
    updateNavButtons("card");
  });

  // 拍照 + OCR
  var frontShot = false, backShot = false;
  var frontDataUrl = null, backDataUrl = null;
  var btnCaptured = document.getElementById("btn-captured");
  var ocrStatus = document.getElementById("ocr-status");
  var confirmBox = document.getElementById("capture-confirm");

  function refreshCaptureBtn() {
    var ok = frontShot && backShot;
    btnCaptured.disabled = !ok;
    btnCaptured.classList.toggle("is-disabled", !ok);
    updateNavButtons("capture");
    if (ok && confirmBox) confirmBox.style.display = "block";
  }

  $all(".id-cam-input").forEach(function (input) {
    input.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var side = input.dataset.cam;
      var card = input.closest(".id-card");
      var reader = new FileReader();
      reader.onload = function (evt) {
        var dataUrl = evt.target.result;
        card.classList.remove("placeholder");
        card.classList.add("captured");
        card.innerHTML = '<img src="' + dataUrl + '" alt="身份证" /><div class="id-label">' + (side === "front" ? "身份证头像页" : "身份证国徽页") + "</div>";
        
        if (side === "front") {
          frontShot = true;
          frontDataUrl = dataUrl;
          ocrIdCardFront(dataUrl);
        } else {
          backShot = true;
          backDataUrl = dataUrl;
        }
        refreshCaptureBtn();
      };
      reader.readAsDataURL(file);
    });
  });

  function ocrIdCardFront(dataUrl) {
    // 每次拍照前清空旧数据，避免残留历史信息
    var _u = getCurrentUser();
    if (_u && _u.idInfo) { _u.idInfo.name = ""; _u.idInfo.idNo = ""; saveState(); }
    fillIdInfoToForm();

    ocrStatus.textContent = "识别中...";
    if (typeof Tesseract === "undefined") {
      ocrStatus.textContent = "";
      return;
    }
    Tesseract.recognize(dataUrl, "chi_sim+eng", {
      logger: function (m) {
        if (m.status === "recognizing text") {
          ocrStatus.textContent = "识别中...";
        }
      }
    }).then(function (result) {
      ocrStatus.textContent = "";
      var text = result.data.text;
      var nameMatch = text.match(/姓\s*名\s*[\u4e00-\u9fa5]{1,4}/);
      var name = nameMatch ? nameMatch[0].replace(/姓\s*名\s*/, "").trim() : "";
      var idMatch = text.match(/\d{6}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]/);
      var idNo = idMatch ? idMatch[0] : "";
      var nameValid = /^[\u4e00-\u9fa5]{2,4}$/.test(name);
      var idNoValid = /^(1[1-9]|[2-9]\d)\d{4}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(idNo);

      // 只有识别成功且校验通过才填入，失败则保持空白
      var success = false;
      if (nameValid && idNoValid) {
        ensureIdInfo();
        var u2 = getCurrentUser();
        u2.idInfo.name = name;
        u2.idInfo.idNo = idNo;
        saveState();
        fillIdInfoToForm();
        success = true;
      } else {
        fillIdInfoToForm();
      }
      // 静默处理，不显示任何提示文字
    }).catch(function (err) {
      ocrStatus.textContent = "";
      fillIdInfoToForm();
    });
  }

  // 确保 idInfo 对象存在（不覆盖已有数据）
  function ensureIdInfo() {
    var u = getCurrentUser();
    if (u && !u.idInfo) {
      u.idInfo = { name: "", idNo: "", startDate: "", endDate: "", phone: "" };
      saveState();
    }
  }

  function fillIdInfoToForm() {
    var u = getCurrentUser();
    if (!u || !u.idInfo) return;
    if ($("#cf-name")) $("#cf-name").value = u.idInfo.name || "";
    if ($("#cf-idno")) $("#cf-idno").value = u.idInfo.idNo || "";
    if ($("#cf-start")) $("#cf-start").value = u.idInfo.startDate || "";
    if ($("#cf-end")) $("#cf-end").value = u.idInfo.endDate || "";
  }

  // 验证码
  var getCode = document.getElementById("get-code");
  var codeTimer = null;
  if (getCode) {
    getCode.addEventListener("click", function () {
      var phone = $("#cf-phone").value.trim();
      if (!/^1\d{10}$/.test(phone)) { toast("请先输入正确的手机号"); return; }
      var n = 60;
      getCode.disabled = true;
      getCode.textContent = n + "s";
      codeTimer = setInterval(function () {
        n--;
        if (n <= 0) { clearInterval(codeTimer); getCode.disabled = false; getCode.textContent = "获取"; }
        else getCode.textContent = n + "s";
      }, 1000);
      toast("验证码已发送");
    });
  }

  // 标签/单选/开关
  $all("[data-tags]").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var tag = e.target.closest(".tag"); if (!tag) return;
      $all(".tag", group).forEach(function (t) { t.classList.remove("is-on"); });
      tag.classList.add("is-on");
    });
  });
  $all(".radio-group").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var r = e.target.closest(".radio"); if (!r) return;
      $all(".radio", group).forEach(function (x) { x.classList.remove("is-on"); });
      r.classList.add("is-on");
    });
  });
  $all("[data-switch]").forEach(function (sw) {
    sw.addEventListener("click", function () {
      sw.classList.toggle("is-on");
      if (sw.dataset.switch === "pay") {
        var icons = $(".pay-icons", sw.closest(".pay-block"));
        if (icons) icons.classList.toggle("hide", !sw.classList.contains("is-on"));
      }
    });
  });

  // 按钮跳转
  if (btnStart) btnStart.addEventListener("click", function () { if (btnStart.disabled) return; goStep("capture"); });
  if (btnCaptured) btnCaptured.addEventListener("click", function () { if (btnCaptured.disabled) return; goStep("info"); });

  var btnToOther = document.getElementById("btn-to-other");
  if (btnToOther) btnToOther.addEventListener("click", function () { goStep("other"); });
  
  var btnSubmit = document.getElementById("btn-submit");
  if (btnSubmit) btnSubmit.addEventListener("click", function () {
    var no = "ICBC" + Date.now().toString().slice(-10);
    pendingApplyNo = no;
    pendingUser = getCurrentUser();
    goStep("review");
    toast("提交成功");
  });
  
  var btnRestart = document.getElementById("btn-restart");
  if (btnRestart) btnRestart.addEventListener("click", function () {
    var u = getCurrentUser();
    if (u) {
      if (!u.idInfo) u.idInfo = {};
      var n = $("#cf-name"); if (n) u.idInfo.name = n.value.trim();
      var i = $("#cf-idno"); if (i) u.idInfo.idNo = i.value.trim();
      var p = $("#cf-phone"); if (p) u.idInfo.phone = p.value.trim();
      saveState();
    }
    pendingUser = u;
    goStep("fee");
    fillFeeInfo();
  });
  
  var btnSubmitFee = document.getElementById("btn-submit-fee");
  if (btnSubmitFee) btnSubmitFee.addEventListener("click", function () { goStep("success"); });
  
  // 离开身份证表单时同步到 idInfo
  ["cf-name", "cf-idno", "cf-phone"].forEach(function (fid) {
    var el = document.getElementById(fid);
    if (el) {
      el.addEventListener("blur", function () {
        var u = getCurrentUser();
        if (u) {
          if (!u.idInfo) u.idInfo = {};
          if (fid === "cf-name") u.idInfo.name = el.value.trim();
          if (fid === "cf-idno") u.idInfo.idNo = el.value.trim();
          if (fid === "cf-phone") u.idInfo.phone = el.value.trim();
          saveState();
        }
      });
    }
  });

  // 地区选择器 - 绑定到 HTML 中实际存在的元素
  (function initRegionPicker() {
    var REGIONS = {
      provinces: ["北京市","上海市","天津市","重庆市","河北省","山西省","内蒙古自治区","辽宁省","吉林省","黑龙江省","江苏省","浙江省","安徽省","福建省","江西省","山东省","河南省","湖北省","湖南省","广东省","广西壮族自治区","海南省","四川省","贵州省","云南省","西藏自治区","陕西省","甘肃省","青海省","宁夏回族自治区","新疆维吾尔自治区","台湾省"],
      cities: {
        "北京市": ["东城区","西城区","朝阳区","丰台区","石景山区","海淀区","门头沟区","房山区","通州区","顺义区","昌平区","大兴区","怀柔区","平谷区","密云区","延庆区"],
        "上海市": ["黄浦区","徐汇区","长宁区","静安区","普陀区","虹口区","杨浦区","闵行区","宝山区","嘉定区","浦东新区","金山区","松江区","青浦区","奉贤区","崇明区"],
        "天津市": ["和平区","河东区","河西区","南开区","河北区","红桥区","东丽区","西青区","津南区","北辰区","武清区","宝坻区","滨海新区","宁河区","静海区","蓟州区"],
        "重庆市": ["万州区","涪陵区","渝中区","大渡口区","江北区","沙坪坝区","九龙坡区","南岸区","北碚区","渝北区","巴南区","黔江区","长寿区","江津区","合川区","永川区","南川区","璧山区","铜梁区","潼南区","荣昌区","开州区","梁平区","武隆区"],
        "河北省": ["石家庄市","唐山市","秦皇岛市","邯郸市","邢台市","保定市","张家口市","承德市","沧州市","廊坊市","衡水市","雄安新区"],
        "山西省": ["太原市","大同市","阳泉市","长治市","晋城市","朔州市","晋中市","运城市","忻州市","临汾市","吕梁市"],
        "内蒙古自治区": ["呼和浩特市","包头市","乌海市","赤峰市","通辽市","鄂尔多斯市","呼伦贝尔市","巴彦淖尔市","乌兰察布市","兴安盟","锡林郭勒盟","阿拉善盟"],
        "辽宁省": ["沈阳市","大连市","鞍山市","抚顺市","本溪市","丹东市","锦州市","营口市","阜新市","辽阳市","盘锦市","铁岭市","朝阳市","葫芦岛市"],
        "吉林省": ["长春市","吉林市","四平市","辽源市","通化市","白山市","松原市","白城市","延边朝鲜族自治州"],
        "黑龙江省": ["哈尔滨市","齐齐哈尔市","鸡西市","鹤岗市","双鸭山市","大庆市","伊春市","佳木斯市","七台河市","牡丹江市","黑河市","绥化市","大兴安岭地区"],
        "江苏省": ["南京市","无锡市","徐州市","常州市","苏州市","南通市","连云港市","淮安市","盐城市","扬州市","镇江市","泰州市","宿迁市"],
        "浙江省": ["杭州市","宁波市","温州市","嘉兴市","湖州市","绍兴市","金华市","衢州市","舟山市","台州市","丽水市"],
        "安徽省": ["合肥市","芜湖市","蚌埠市","淮南市","马鞍山市","淮北市","铜陵市","安庆市","黄山市","滁州市","阜阳市","宿州市","六安市","亳州市","池州市","宣城市"],
        "福建省": ["福州市","厦门市","莆田市","三明市","泉州市","漳州市","南平市","龙岩市","宁德市"],
        "江西省": ["南昌市","景德镇市","萍乡市","九江市","新余市","鹰潭市","赣州市","吉安市","宜春市","抚州市","上饶市"],
        "山东省": ["济南市","青岛市","淄博市","枣庄市","东营市","烟台市","潍坊市","济宁市","泰安市","威海市","日照市","临沂市","德州市","聊城市","滨州市","菏泽市"],
        "河南省": ["郑州市","开封市","洛阳市","平顶山市","安阳市","鹤壁市","新乡市","焦作市","濮阳市","许昌市","漯河市","三门峡市","南阳市","商丘市","信阳市","周口市","驻马店市","济源市"],
        "湖北省": ["武汉市","黄石市","十堰市","宜昌市","襄阳市","鄂州市","荆门市","孝感市","荆州市","黄冈市","咸宁市","随州市","恩施土家族苗族自治州","仙桃市","潜江市","天门市","神农架林区"],
        "湖南省": ["长沙市","株洲市","湘潭市","衡阳市","邵阳市","岳阳市","常德市","张家界市","益阳市","郴州市","永州市","怀化市","娄底市","湘西土家族苗族自治州"],
        "广东省": ["广州市","深圳市","珠海市","汕头市","佛山市","韶关市","湛江市","肇庆市","江门市","茂名市","惠州市","梅州市","汕尾市","河源市","阳江市","清远市","东莞市","中山市","潮州市","揭阳市","云浮市"],
        "广西壮族自治区": ["南宁市","柳州市","桂林市","梧州市","北海市","防城港市","钦州市","贵港市","玉林市","百色市","贺州市","河池市","来宾市","崇左市"],
        "海南省": ["海口市","三亚市","三沙市","儋州市"],
        "四川省": ["成都市","自贡市","攀枝花市","泸州市","德阳市","绵阳市","广元市","遂宁市","内江市","乐山市","南充市","眉山市","宜宾市","广安市","达州市","雅安市","巴中市","资阳市","阿坝藏族羌族自治州","甘孜藏族自治州","凉山彝族自治州"],
        "贵州省": ["贵阳市","六盘水市","遵义市","安顺市","毕节市","铜仁市","黔西南布依族苗族自治州","黔东南苗族侗族自治州","黔南布依族苗族自治州"],
        "云南省": ["昆明市","曲靖市","玉溪市","保山市","昭通市","丽江市","普洱市","临沧市","楚雄彝族自治州","红河哈尼族彝族自治州","文山壮族苗族自治州","西双版纳傣族自治州","大理白族自治州","德宏傣族景颇族自治州","怒江傈僳族自治州","迪庆藏族自治州"],
        "西藏自治区": ["拉萨市","日喀则市","昌都市","林芝市","山南市","那曲市","阿里地区"],
        "陕西省": ["西安市","铜川市","宝鸡市","咸阳市","渭南市","延安市","汉中市","榆林市","安康市","商洛市"],
        "甘肃省": ["兰州市","嘉峪关市","金昌市","白银市","天水市","武威市","张掖市","平凉市","酒泉市","庆阳市","定西市","陇南市","临夏回族自治州","甘南藏族自治州"],
        "青海省": ["西宁市","海东市","海北藏族自治州","黄南藏族自治州","海南藏族自治州","果洛藏族自治州","玉树藏族自治州","海西蒙古族藏族自治州"],
        "宁夏回族自治区": ["银川市","石嘴山市","吴忠市","固原市","中卫市"],
        "新疆维吾尔自治区": ["乌鲁木齐市","克拉玛依市","吐鲁番市","哈密市","昌吉回族自治州","博尔塔拉蒙古自治州","巴音郭楞蒙古自治州","阿克苏地区","克孜勒苏柯尔克孜自治州","喀什地区","和田地区","伊犁哈萨克自治州","塔城地区","阿勒泰地区"],
        "台湾省": ["台北市","新北市","桃园市","台中市","台南市","高雄市"]
      }
    };

    var modal = document.getElementById('region-modal');
    var listEl = document.getElementById('region-list');
    var closeBtn = document.getElementById('region-close');
    var tabs = document.querySelectorAll('.region-tab');
    var currentTarget = null; // 当前绑定的输入框
    var selLevel = 'province'; // 当前选择级别
    var selProv = '', selCity = '', selDist = '';

    if (!modal || !listEl) return;

    // 打开弹窗
    function openPicker(target) {
      currentTarget = target;
      selProv = ''; selCity = ''; selDist = '';
      selLevel = 'province';
      tabs.forEach(function(t) { t.classList.remove('is-on'); });
      document.querySelector('.region-tab[data-level="province"]').classList.add('is-on');
      renderList('province');
      modal.classList.add('show');
    }

    // 关闭弹窗
    function closePicker() {
      modal.classList.remove('show');
      currentTarget = null;
    }

    // 渲染列表
    function renderList(level) {
      var html = '';
      if (level === 'province') {
        REGIONS.provinces.forEach(function(p) {
          html += '<div class="region-item" data-type="province" data-val="' + p + '">' + p + '</div>';
        });
      } else if (level === 'city') {
        var cities = REGIONS.cities[selProv] || [];
        cities.forEach(function(c) {
          html += '<div class="region-item" data-type="city" data-val="' + c + '">' + c + '</div>';
        });
      } else if (level === 'county') {
        // 区县数据未提供，显示提示
        html = '<div style="padding:16px;color:#999;text-align:center;">该地区暂无详细区县数据，可直接选择</div>';
        html += '<div class="region-item" data-type="county" data-val="">' + selCity + '（区县级）</div>';
      }
      listEl.innerHTML = html;
    }

    // 点击选择项
    listEl.addEventListener('click', function(e) {
      var item = e.target.closest('.region-item');
      if (!item) return;
      var type = item.dataset.type;
      var val = item.dataset.val;
      if (type === 'province') {
        selProv = val; selCity = ''; selDist = '';
        document.querySelector('.region-tab[data-level="city"]').classList.add('is-on');
        document.querySelector('.region-tab[data-level="province"]').classList.remove('is-on');
        document.querySelector('.region-tab[data-level="county"]').classList.remove('is-on');
        selLevel = 'city';
        renderList('city');
      } else if (type === 'city') {
        selCity = val; selDist = '';
        document.querySelector('.region-tab[data-level="county"]').classList.add('is-on');
        document.querySelector('.region-tab[data-level="city"]').classList.remove('is-on');
        selLevel = 'county';
        renderList('county');
      } else if (type === 'county') {
        selDist = val || selCity;
        // 回填
        if (currentTarget) {
          var display = selProv + ' / ' + selCity;
          if (selDist) display += ' / ' + selDist;
          currentTarget.value = display;
          currentTarget.dataset.prov = selProv;
          currentTarget.dataset.city = selCity;
          currentTarget.dataset.dist = selDist;
        }
        closePicker();
      }
    });

    // 切换 Tab
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var level = this.dataset.level;
        tabs.forEach(function(t) { t.classList.remove('is-on'); });
        this.classList.add('is-on');
        selLevel = level;
        renderList(level);
      });
    });

    // 关闭按钮
    if (closeBtn) closeBtn.addEventListener('click', closePicker);

    // 点击遮罩关闭
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closePicker();
    });

    // 绑定输入框点击
    var regionPicker = document.getElementById('region-picker');
    var unitRegionPicker = document.getElementById('unit-region-picker');
    if (regionPicker) {
      regionPicker.addEventListener('click', function() { openPicker(this); });
    }
    if (unitRegionPicker) {
      unitRegionPicker.addEventListener('click', function() { openPicker(this); });
    }
  })();

  // 初始化：检查 hash 并显示对应页面
  var initStep = location.hash.slice(1) || "auth";
  if (STEP_ORDER.indexOf(initStep) >= 0) {
    goStep(initStep);
  }
})();
