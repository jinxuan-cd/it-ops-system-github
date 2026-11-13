/* ==========================================================================
   IT 报障服务台（员工自助门户）前端逻辑 —— IT 运维工单台账与日报自动管理系统
   --------------------------------------------------------------------------
   · 只调用 /api/public/*（公网进程白名单内接口），不涉及任何管理接口
   · 不使用框架、不使用 CDN、不写 Cookie，弱网/老旧手机也能正常使用
   · 所有插入页面的文本都经过 esc() 转义，避免知识库内容里带 HTML 被解释
   --------------------------------------------------------------------------
   作者：锦轩 (JinXuan) <2686389727@qq.com>   创建：2026-10-29   版本：1.4.2
   Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
   许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
         其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
   ========================================================================== */
(function () {
  'use strict'

  // 入口密钥：员工扫码后链接形如 /report?k=xxxx，后端用它判断是不是内部员工。
  // 前端只负责原样带上，不做任何校验（校验逻辑必须留在后端，否则等于没有）
  var KEY = new URLSearchParams(location.search).get('k') || ''
  // 门户只允许调用这一组白名单接口（服务端在公网进程上单独注册），
  // 管理接口一律不带出来，避免门户被当成越权入口
  var API = '/api/public'
  // 上次报障单号：下次进来自动回填，员工不用翻记录
  var LAST_NO = 'itops_last_report_no'
  // 版本号：改版时与 index.html 的资源版本串、后端 PORTAL_VERSION 一起改，
  // 页脚会显示出来，方便一眼判断员工打开的是新版还是旧缓存
  // 具体三处：public-portal/index.html 里 style.css / app.js 的 ?v=、本文件的 PORTAL_VER、
  // 后端 backend/src/utils/portalVersion.js 的 PORTAL_VERSION——漏改一处就会出现「旧缓存」误报
  var PORTAL_VER = '20261112b'

  // 页面级状态集中放一处：所有渲染函数都只读它，避免散落的全局变量
  var state = {
    // 当前 Tab：report / track / faq
    tab: 'report',
    priority: 'normal',
    reportKey: KEY,
    options: { dept: [], app_system: [], problem_type: [] },
    // 当前查询到的工单，提交满意度时要用它的 report_no
    current: null,
    score: 0,
    // 已上传成功的故障截图地址（最多 3 张）
    attachments: [],
    // 正在上传的数量：和 attachments 一起算「还能传几张」，也用来阻止上传中途提交
    uploading: 0
  }

  // ---------------- 工具 ----------------
  // 这里是原生 JS，没有框架的模板转义，所以所有要拼进 innerHTML 的值必须手动过一遍
  function $(sel, root) { return (root || document).querySelector(sel) }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }

  // HTML 转义：知识库标题、员工填的描述、后端返回的错误文案都可能含 < > "，
  // 不转义就会被当成标签解析（轻则排版错乱，重则 XSS）。
  // 规则：拼接进 innerHTML 的每一处都必须包 esc()，纯 textContent 赋值的地方则不需要
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  // 轻提示：同一时间只留一条，新消息覆盖旧消息并重置计时
  var toastTimer = null
  function toast(msg, isErr) {
    var el = $('#toast')
    el.textContent = msg
    el.className = 'toast' + (isErr ? ' err' : '')
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { el.hidden = true }, 3200)
  }

  // 统一请求封装：门户所有接口都走这里，方便集中处理「后端返回非 JSON」「HTTP 500」这类异常。
  // 只拼接 API 前缀（/api/public），所以即使有人改了调用参数也跳不出白名单
  function request(path, opt) {
    opt = opt || {}
    var cfg = { method: opt.method || 'GET', headers: {} }
    if (opt.body) {
      cfg.headers['Content-Type'] = 'application/json'
      cfg.body = JSON.stringify(opt.body)
    }
    return fetch(API + path, cfg)
      .then(function (r) {
        // 网关/后端崩溃时响应体不是 JSON，这里兜一个带状态码的错误，避免抛 SyntaxError 到用户脸上
        return r.json().catch(function () { return { code: 1, message: '服务返回异常（HTTP ' + r.status + '）' } })
      })
      .then(function (j) {
        // 业务失败统一抛 Error，调用方只需要一个 catch 分支
        if (j.code !== 0) throw new Error(j.message || '请求失败')
        return j
      })
  }

  // 工单状态翻译：门户只区分三种对外可见状态，不暴露内部流转细节
  function statusText(s) {
    return s === 'done' ? '已完成' : s === 'pending' ? '待接单' : '处理中'
  }
  function statusClass(s) {
    return s === 'done' ? 'done' : s === 'pending' ? 'pending' : 'processing'
  }

  // ---------------- Tab 切换 ----------------
  // 三个面板都在同一个页面里，用 hidden 切换而不是路由，避免员工点一次就刷新整页
  function switchTab(name) {
    state.tab = name
    $$('#tabs .tab').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === name)
    })
    $$('.panel').forEach(function (p) {
      p.hidden = p.dataset.panel !== name
    })
    // 常见问题首次进入才拉列表（dataset.loaded 做标记），省掉门户打开就白发一次请求
    if (name === 'faq' && !$('#faqList').dataset.loaded) loadFaq('')
    // 切 Tab 后回到顶部，否则从长表单切过来会停在页面中间
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------------- 初始化 ----------------
  // 启动只做一件事：先问后端「这个入口现在能不能用」，再决定渲染哪一块。
  // 所有开关（报障/常见问题/密钥）都由后端下发，前端不写死，避免改配置要重新发布门户
  function boot() {
    request('/config?k=' + encodeURIComponent(KEY))
      .then(function (j) {
        var c = j.data || {}
        $('#loading').hidden = true

        // 入口密钥不对：明确告知，避免员工反复重试
        if (c.has_key && !c.key_ok) {
          showBlocked('报障入口校验失败', '请重新扫描二维码，或联系 IT 获取新的入口链接。')
          return
        }
        if (!c.report_enable && !c.faq_enable) {
          showBlocked('自助服务暂未开放', '请联系 IT 同事直接报障。')
          return
        }

        $('#tabs').hidden = false
        renderDuty(c.duty_contacts || [])
        // 页脚展示版本；页面是自己缓存下来的旧版时给出明确提示
        // 比对的是「后端当前部署版本」和「本文件里的 PORTAL_VER」：
        // 两者不一致说明浏览器还在用旧的 app.js，功能可能对不上，让员工主动刷新
        var ver = $('#ver')
        if (ver) ver.textContent = 'v' + PORTAL_VER
        if (c.portal_version && c.portal_version !== PORTAL_VER) {
          toast('页面是旧缓存，请下拉刷新或清除缓存后重试', true)
        }
        // 关掉某个入口时隐藏对应 Tab
        if (!c.report_enable) {
          $('[data-tab="report"]').hidden = true
          $('[data-tab="track"]').hidden = true
        }
        if (!c.faq_enable) $('[data-tab="faq"]').hidden = true

        if (c.report_enable) {
          loadOptions()
          var last = localStorage.getItem(LAST_NO)
          if (last) $('#tNo').value = last
          // 二维码可能指向 /faq?k=xxx，此时直接打开常见问题
          switchTab(/^\/faq/.test(location.pathname) && c.faq_enable ? 'faq' : 'report')
        } else {
          switchTab('faq')
        }
      })
      .catch(function (e) {
        $('#loading').hidden = true
        showBlocked('暂时无法连接服务', e.message || '请稍后重试。')
      })
  }

  // ---------------- 值班 IT 联系方式（可点击拨打） ----------------
  // 图标直接内联：门户不引外部图标库/CDN，断网或内网隔离时也不会缺图
  var PHONE_ICO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9">' +
    '<path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6.1 6.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" stroke-linejoin="round"/></svg>'

  // 电话号码可能写成「138-0000-0000」，tel: 链接里只留数字和 +，否则部分安卓机点不动
  function telHref(phone) {
    return 'tel:' + String(phone || '').replace(/[^\d+]/g, '')
  }

  // 值班条最多显示两人：多了会把首屏挤下去，员工真正要看的是报障表单
  function renderDuty(list) {
    var bar = $('#duty')
    if (!bar) return
    if (!list || !list.length) { bar.hidden = true; return }
    bar.innerHTML = ''
    list.slice(0, 2).forEach(function (c) {
      var a = document.createElement('a')
      a.className = 'duty-item'
      a.href = telHref(c.phone)
      // 值班人姓名/备注来自后台配置，同样按不可信内容处理，逐个 esc
      a.innerHTML = '<span class="d-ico">' + PHONE_ICO + '</span>' +
        '<span class="d-txt"><b>' + esc(c.name || 'IT 值班') + '</b>' +
        '<i>' + esc(c.phone) + (c.note ? ' · ' + esc(c.note) : '') + '</i></span>' +
        '<span class="d-call">拨打</span>'
      bar.appendChild(a)
    })
    bar.hidden = false

    var foot = $('#footDuty')
    if (foot) {
      var first = list[0]
      foot.innerHTML = '如遇紧急故障，请直接电话联系 IT 值班：'
      var fa = document.createElement('a')
      fa.className = 'foot-tel'
      fa.href = telHref(first.phone)
      // 这里用 textContent 而不是拼 HTML，天然免疫标签注入
      fa.textContent = (first.name ? first.name + ' ' : '') + first.phone
      foot.appendChild(fa)
    }
  }

  // 整页拦截：入口密钥错、功能全关、服务不可达时都走这里，替代「白屏 + 空表单」
  function showBlocked(title, desc) {
    $('#blocked').hidden = false
    $('#blockedTitle').textContent = title
    $('#blockedDesc').textContent = desc
  }

  // 下拉选项：部门/系统清单由后台字典下发，失败也不能挡住报障（员工可手填描述）
  function loadOptions() {
    request('/options')
      .then(function (j) {
        var o = j.data || {}
        state.options = {
          dept: o.dept || [],
          app_system: o.app_system || [],
          problem_type: o.problem_type || []
        }
        fillSelect($('#fDept'), state.options.dept, '请选择（可留空）')
        fillSelect($('#fSystem'), state.options.app_system, '不确定可不选')
      })
      .catch(function () { /* 选项拉取失败不阻塞报障，员工仍可手填描述 */ })
  }

  // 重建 select 选项：value 在属性里，同样必须 esc，否则字典项带引号会把属性截断
  function fillSelect(sel, list, placeholder) {
    var html = '<option value="">' + esc(placeholder) + '</option>'
    list.forEach(function (v) { html += '<option value="' + esc(v) + '">' + esc(v) + '</option>' })
    sel.innerHTML = html
  }

  // ---------------- 报障 ----------------
  function bindReport() {
    var content = $('#fContent')
    // 实时字数：门户限制描述长度，先让员工看到还差多少
    content.addEventListener('input', function () {
      $('#cnt').textContent = content.value.length
    })

    // 优先级用一组按钮当单选：原生 select 在手机上点开体验差，按钮一按即中
    $('#priRow').addEventListener('click', function (e) {
      var b = e.target.closest('.pri-item')
      if (!b) return
      state.priority = b.dataset.p
      $$('#priRow .pri-item').forEach(function (x) { x.classList.toggle('on', x === b) })
    })

    $('#reportForm').addEventListener('submit', function (e) {
      e.preventDefault()
      var contact = $('#fContact').value.trim()
      var text = content.value.trim()
      // 只做「不空 + 够长」的最低校验：门户面对的是普通员工，规则太严会直接放弃报障
      if (!contact) { toast('请填写您的姓名', true); $('#fContact').focus(); return }
      if (text.length < 4) { toast('请简单描述遇到的问题', true); content.focus(); return }

      // 还有图片在上传时不允许提交，否则后端拿到的附件列表会缺图
      if (state.uploading > 0) { toast('图片还在上传，请稍等两秒', true); return }

      // 提交期间禁用按钮：弱网下员工容易连点，会重复建单
      var btn = $('#btnSubmit')
      btn.disabled = true
      btn.textContent = '提交中…'

      request('/report', {
        method: 'POST',
        body: {
          // 每次提交都带上入口密钥，后端据此判断来源是否合法
          k: state.reportKey,
          contact: contact,
          dept: $('#fDept').value || '',
          phone: $('#fPhone').value.trim(),
          app_system: $('#fSystem').value || '',
          priority: state.priority,
          content: text,
          // 最多 3 张，与上传处的上限保持一致
          attachment: state.attachments.slice(0, 3)
        }
      })
        .then(function (j) {
          var no = (j.data && j.data.report_no) || ''
          // 记住单号，下次打开门户自动回填到查询框（localStorage 可能被隐私模式禁用，包 try）
          try { localStorage.setItem(LAST_NO, no) } catch (err) {}
          $('#doneNo').textContent = no
          // 提交成功不跳页，直接把表单换成「成功 + 单号」，员工抄号最方便
          $('#reportForm').hidden = true
          $('#reportDone').hidden = false
          $('#tNo').value = no
          window.scrollTo({ top: 0, behavior: 'smooth' })
        })
        .catch(function (err) { toast(err.message, true) })
        // 用 then 而不是 finally：这里要兼容老浏览器（finally 在旧安卓 WebView 上不一定有）
        .then(function () {
          btn.disabled = false
          btn.textContent = '提交报障'
        })
    })

    // 「查看进度」：把单号和手机尾号自动填好再查，省掉员工手动输入
    $('#btnGoTrack').addEventListener('click', function () {
      $('#tNo').value = $('#doneNo').textContent
      $('#tPhone').value = ($('#fPhone').value || '').replace(/\D/g, '').slice(-4)
      switchTab('track')
      doTrack()
    })

    // 「再报一单」：只清临时输入，联系人和部门保留（同一台电脑大概率是同一个人）
    $('#btnAgain').addEventListener('click', function () {
      $('#reportDone').hidden = true
      $('#reportForm').hidden = false
      content.value = ''
      $('#cnt').textContent = '0'
      $('#fPhone').value = ''
      $('#fSystem').value = ''
      state.priority = 'normal'
      clearShots()
      $$('#priRow .pri-item').forEach(function (x) { x.classList.toggle('on', x.dataset.p === 'normal') })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  // ---------------- 故障截图（可选，最多 3 张） ----------------
  // 手机原图动辄 3~8MB，外网/分公司上传很慢，先在本地压到长边 1600px 再传
  // 换来的是流量省一个数量级，代价只是截图上的小字略微变糊，对排障足够
  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve) {
      // 非图片 / GIF 直接放行：GIF 走 canvas 会只剩第一帧，宁可不压
      if (!file || !/^image\//.test(file.type) || /gif/i.test(file.type)) return resolve(file)
      var img = new Image()
      var url = URL.createObjectURL(file)
      img.onload = function () {
        // objectURL 用完必须释放，否则图片占的内存会一直留在页面里
        URL.revokeObjectURL(url)
        var w = img.naturalWidth || 0
        var h = img.naturalHeight || 0
        if (!w || !h) return resolve(file)
        var scale = Math.min(1, maxSide / Math.max(w, h))
        // 本来就不大（短边没超限且小于 900KB）就别重新编码，避免二次压缩损失画质
        if (scale >= 1 && file.size < 900 * 1024) return resolve(file)
        var cv = document.createElement('canvas')
        cv.width = Math.round(w * scale)
        cv.height = Math.round(h * scale)
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
        // 极老的浏览器没有 toBlob，退回原文件，宁可传大图也不能传不上去
        if (!cv.toBlob) return resolve(file)
        cv.toBlob(function (blob) { resolve(blob || file) }, 'image/jpeg', quality)
      }
      // 图片解码失败（损坏或格式不支持）也放行原文件，让后端去判断
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file) }
      img.src = url
    })
  }

  // 刷新截图区状态：提示文案、按钮可用性、空态隐藏都集中在这里，避免各处改漏
  function refreshShotUI() {
    var box = $('#shots')
    if (box) box.hidden = state.attachments.length + state.uploading === 0
    var hint = $('#shotHint')
    if (hint) {
      // 剩余额度要把「正在上传中的」也算进去，否则上传途中还能继续选，会超 3 张
      var left = 3 - state.attachments.length - state.uploading
      hint.textContent = state.uploading > 0
        ? '正在上传图片…'
        : (left > 0 ? '还可 ' + left + ' 张 · 截图后可直接 Ctrl+V 粘贴' : '已达 3 张上限')
    }
    var pick = $('#btnPick')
    var shot = $('#btnShot')
    var full = state.attachments.length + state.uploading >= 3
    if (pick) pick.disabled = full
    if (shot) shot.disabled = full
  }

  // 先在本地插一张预览图（带 uploading 遮罩），上传成功后再把远端地址记到 dataset.url。
  // 这样弱网下员工也能立刻看到「图进来了」，不会以为没选上又点一次
  function addShotItem(localUrl) {
    var box = $('#shots')
    var item = document.createElement('div')
    item.className = 'shot uploading'
    item.innerHTML = '<img alt="故障截图"><button type="button" class="shot-del" aria-label="删除">×</button>'
    item.querySelector('img').src = localUrl
    // 删除分两种状态：还在上传的要减掉 uploading 计数；已完成的要从 attachments 里摘掉地址，
    // 否则提交时会把「已经删掉的那张」也带给后端
    item.querySelector('.shot-del').addEventListener('click', function () {
      if (item.dataset.url) {
        state.attachments = state.attachments.filter(function (u) { return u !== item.dataset.url })
      }
      if (item.dataset.uploading === '1') state.uploading = Math.max(0, state.uploading - 1)
      item.remove()
      // 预览图用的是 blob URL，删掉节点后要主动回收
      if (item.dataset.local) URL.revokeObjectURL(item.dataset.local)
      refreshShotUI()
    })
    box.appendChild(item)
    box.hidden = false
    return item
  }

  function uploadShots(files) {
    var list = Array.prototype.slice.call(files || [])
    if (!list.length) return
    // 一次可能拖进来十几张，只取剩余额度内的，多出来的静默丢弃并提示
    var room = 3 - state.attachments.length - state.uploading
    if (room <= 0) { toast('最多上传 3 张图片', true); return }
    list.slice(0, room).forEach(function (f) {
      if (!/^image\//.test(f.type)) { toast('只能上传图片', true); return }
      state.uploading += 1
      var localUrl = URL.createObjectURL(f)
      var item = addShotItem(localUrl)
      item.dataset.local = localUrl
      item.dataset.uploading = '1'
      refreshShotUI()
      compressImage(f, 1600, 0.82).then(function (blob) {
        var fd = new FormData()
        // 统一改成 .jpg：压缩后是 JPEG，沿用原扩展名会让后端校验类型时对不上
        var name = (f.name || 'shot').replace(/\.[^.]+$/, '') + '.jpg'
        // 字段名必须是 files（后端 multer 按这个名字收），且要带入口密钥 k
        fd.append('files', blob, name)
        return fetch(API + '/upload?k=' + encodeURIComponent(KEY), { method: 'POST', body: fd })
          .then(function (r) { return r.json() })
      }).then(function (j) {
        if (!j || j.code !== 0) throw new Error((j && j.message) || '上传失败')
        var url = (j.data && j.data[0]) || ''
        if (!url) throw new Error('上传失败')
        state.attachments.push(url)
        item.dataset.url = url
        item.dataset.uploading = ''
        item.classList.remove('uploading')
      }).catch(function (e) {
        // 上传失败就把这张预览删掉：留着会让员工以为图已经带上了
        item.remove()
        toast(e.message || '图片上传失败，可先不传图片直接提交', true)
      }).then(function () {
        state.uploading = Math.max(0, state.uploading - 1)
        refreshShotUI()
      })
    })
  }

  // 「再报一单」时清空：地址数组和预览节点一起清，避免旧图被误带给新单
  function clearShots() {
    state.attachments = []
    state.uploading = 0
    var box = $('#shots')
    if (box) box.innerHTML = ''
    refreshShotUI()
  }

  // 选图两个入口：相册/文件（filePick）和拍照（fileShot，带 capture），
  // 都用隐藏 input 承接，按钮只负责触发 click，保证手机端能唤起相机
  function bindShots() {
    var pick = $('#filePick')
    var shot = $('#fileShot')
    $('#btnPick').addEventListener('click', function () { pick.click() })
    $('#btnShot').addEventListener('click', function () { shot.click() })
    ;[pick, shot].forEach(function (input) {
      if (!input) return
      input.addEventListener('change', function () {
        uploadShots(input.files)
        // 清空 value：否则再选同一个文件不会触发 change，员工会以为按钮失灵
        input.value = ''
      })
    })
    // 直接粘贴截图（电脑 Ctrl+V、手机长按粘贴），不用先存相册再选文件
    document.addEventListener('paste', onPasteImage)
    refreshShotUI()
  }

  // 从剪贴板取图片。若剪贴板里同时有文字，保留文字的正常粘贴（不拦截默认行为）
  // 原因：截图工具常把「图片 + 说明文字」一起放进剪贴板，一旦 preventDefault，
  // 员工粘进描述框的文字就没了，比多一张图麻烦得多
  function onPasteImage(e) {
    // 只在报障页且表单还开着时接管：查询/FAQ 页粘贴图片不该触发上传
    if (state.tab !== 'report') return
    var form = $('#reportForm')
    if (!form || form.hidden) return
    var items = (e.clipboardData && e.clipboardData.items) || []
    var files = []
    var hasText = false
    for (var i = 0; i < items.length; i++) {
      var it = items[i]
      // 记录是否同时有纯文本；有文本时下面就不阻止默认粘贴
      if (it.kind === 'string' && /^text\//.test(it.type || '')) hasText = true
      if (it.kind === 'file' && /^image\//.test(it.type || '')) {
        var f = it.getAsFile()
        if (f) files.push(f)
      }
    }
    if (!files.length) return
    // 纯图片才拦默认行为（避免浏览器把图片粘成 <img> 或空白）；图片+文字则放行
    if (!hasText) e.preventDefault()
    toast('已粘贴 ' + files.length + ' 张图片，正在上传…')
    uploadShots(files)
  }

  // ---------------- 查进度 ----------------
  function bindTrack() {
    $('#trackForm').addEventListener('submit', function (e) {
      e.preventDefault()
      doTrack()
    })

    // 星星用事件委托：5 颗按钮共用一套逻辑，也方便键盘/触摸统一处理
    $('#stars').addEventListener('click', function (e) {
      var b = e.target.closest('button')
      if (!b) return
      state.score = Number(b.dataset.s)
      paintStars(state.score)
    })

    // 提交满意度：必须先查到工单（state.current），否则不知道给哪一单评分
    $('#btnRate').addEventListener('click', function () {
      if (!state.current) return
      if (!state.score) { toast('请先选择评分', true); return }
      var btn = $('#btnRate')
      btn.disabled = true
      request('/satisfy', {
        method: 'POST',
        body: {
          report_no: state.current.report_no,
          // 手机号只作为「是不是本人」的弱校验，后端按尾号比对
          phone: $('#tPhone').value.trim(),
          score: state.score,
          comment: $('#rateComment').value.trim()
        }
      })
        .then(function () {
          toast('感谢您的评价！')
          // 重新查一次：让页面切成「已评价」态，防止重复提交
          doTrack()
        })
        .catch(function (err) { toast(err.message, true) })
        .then(function () { btn.disabled = false })
    })
  }

  // 点亮前 n 颗星并显示对应文案
  function paintStars(n) {
    $$('#stars button').forEach(function (b) {
      b.classList.toggle('on', Number(b.dataset.s) <= n)
    })
    var texts = ['', '很不满意', '不满意', '一般', '满意', '非常满意']
    $('#rateText').textContent = n ? texts[n] : '请选择评分'
  }

  function doTrack() {
    var no = $('#tNo').value.trim()
    if (!no) { toast('请填写报障单号', true); return }
    var btn = $('#btnTrack')
    // 查询期间禁用，避免连点发出一串相同请求
    btn.disabled = true
    request('/track', { method: 'POST', body: { report_no: no, phone: $('#tPhone').value.trim() } })
      .then(function (j) {
        var d = j.data || {}
        state.current = d
        // 查成功就把单号记下来，下次打开页面直接回填
        try { localStorage.setItem(LAST_NO, d.report_no || no) } catch (err) {}

        $('#trackResult').hidden = false
        var tag = $('#rStatus')
        tag.textContent = statusText(d.status)
        tag.className = 'tag ' + statusClass(d.status)
        // 下面一律用 textContent：工单内容是运维填的，可能带尖括号，拼 HTML 会被解析
        $('#rNo').textContent = d.report_no || ''
        $('#rContent').textContent = d.service_content || '—'
        $('#rSystem').textContent = d.app_system || '—'
        $('#rHappen').textContent = d.happen_time || '—'

        // 未完成时没有 finish_time，整行隐藏，避免出现「完成时间：—」让人误解
        if (d.finish_time) {
          $('#rFinishLine').hidden = false
          $('#rFinish').textContent = d.finish_time
        } else {
          $('#rFinishLine').hidden = true
        }

        // 处理结果同理：没填就不显示空框
        if (d.result) {
          $('#rResultBox').hidden = false
          $('#rResult').textContent = d.result
        } else {
          $('#rResultBox').hidden = true
        }

        // 可评价 / 已评价 / 不可评价三态互斥，由后端用 can_satisfy 判定（如未完成不能评）
        if (d.can_satisfy) {
          state.score = 0
          paintStars(0)
          $('#rateComment').value = ''
          $('#rateBox').hidden = false
          $('#ratedBox').hidden = true
        } else {
          $('#rateBox').hidden = true
          if (d.satisfy_score) {
            $('#ratedBox').hidden = false
            // 用实心/空心星拼出 5 格，无需额外图标资源
            $('#ratedStars').textContent = '★★★★★'.slice(0, d.satisfy_score) + '☆☆☆☆☆'.slice(0, 5 - d.satisfy_score)
          } else {
            $('#ratedBox').hidden = true
          }
        }
      })
      .catch(function (err) {
        // 单号错或手机尾号不匹配：清掉上次的结果，别让人误以为查到的是新单
        $('#trackResult').hidden = true
        toast(err.message, true)
      })
      .then(function () { btn.disabled = false })
  }

  // ---------------- 常见问题 ----------------
  function bindFaq() {
    $('#btnFaqSearch').addEventListener('click', function () {
      loadFaq($('#faqKw').value.trim())
    })
    $('#faqKw').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); loadFaq(this.value.trim()) }
    })
    // 边输边搜（300ms 防抖），不用每次点按钮
    var faqTimer = null
    $('#faqKw').addEventListener('input', function () {
      var v = this.value.trim()
      clearTimeout(faqTimer)
      faqTimer = setTimeout(function () { loadFaq(v) }, 300)
    })
    $('#faqList').addEventListener('click', function (e) {
      var item = e.target.closest('.faq-item')
      if (!item) return
      toggleFaq(item)
    })
  }

  function loadFaq(kw) {
    var box = $('#faqList')
    box.innerHTML = '<div class="empty">正在加载…</div>'
    // 关键词走 encodeURIComponent：中文关键词直接拼进 URL 会被截断
    request('/faq?k=' + encodeURIComponent(KEY) + (kw ? '&keyword=' + encodeURIComponent(kw) : ''))
      .then(function (j) {
        var d = j.data || {}
        // 标记已加载过：切回 FAQ Tab 时不再重复请求（switchTab 里有判断）
        box.dataset.loaded = '1'
        // 没带密钥：说明链接被转发到了外部，不暴露任何条目
        if (d.need_key) {
          box.innerHTML = '<div class="empty">请通过二维码或内部链接访问本页面</div>'
          return
        }
        if (!d.enable) {
          box.innerHTML = '<div class="empty">常见问题暂未开放</div>'
          return
        }
        var list = d.list || []
        $('#faqHint').textContent = list.length
          ? '共 ' + list.length + ' 条，点击展开解决方案'
          : (kw ? '没有找到相关问题，可换个关键词试试' : '暂无已公开的常见问题')
        if (!list.length) {
          box.innerHTML = '<div class="empty">' + (kw ? '没有找到相关问题' : '暂无内容') + '</div>'
          return
        }
        // 列表一次性拼字符串渲染（条目不多，比逐个 createElement 快且代码短）；
        // 标题/所属系统来自知识库，属于后台可编辑内容，每一处都过 esc 再拼
        box.innerHTML = list.map(function (f) {
          var meta = [f.app_system, f.problem_type].filter(Boolean).join(' · ')
          return '' +
            '<div class="faq-item" data-id="' + esc(f.kb_id) + '">' +
              '<div class="faq-q"><span>' + esc(f.problem_summary || '（无标题）') + '</span>' +
                '<svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                  '<path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
              '</div>' +
              (meta ? '<div class="faq-meta">' + esc(meta) + '</div>' : '') +
              '<div class="faq-a" hidden></div>' +
            '</div>'
        }).join('')
      })
      .catch(function (err) {
        // 错误文案也可能带上后端返回的参数，同样要 esc
        box.innerHTML = '<div class="empty">加载失败：' + esc(err.message) + '</div>'
      })
  }

  // 展开/收起：展开才去拉详情（列表接口只给标题，方案正文按需取，省首屏流量）
  function toggleFaq(item) {
    var ans = $('.faq-a', item)
    if (!ans) return
    if (item.classList.contains('open')) {
      item.classList.remove('open')
      ans.hidden = true
      return
    }
    // 已经拉过就直接展示，避免反复收起展开时重复请求
    if (ans.dataset.loaded) {
      item.classList.add('open')
      ans.hidden = false
      return
    }
    ans.hidden = false
    ans.textContent = '正在加载…'
    request('/faq/' + encodeURIComponent(item.dataset.id) + '?k=' + encodeURIComponent(KEY))
      .then(function (j) {
        var d = j.data || {}
        // 用 textContent 赋值：方案正文常含代码片段和命令，拼 HTML 会把内容吃掉
        ans.textContent = d.solution || '该问题暂未填写解决方案'
        ans.dataset.loaded = '1'
        item.classList.add('open')
      })
      .catch(function (err) {
        ans.textContent = '加载失败：' + err.message
      })
  }

  // ---------------- 启动 ----------------
  // 脚本以 defer/置于 body 末尾的方式引入，此时 DOM 已就绪，可以直接绑定；
  // 先绑事件再 boot()，保证即使 config 请求很慢，页面上的按钮也不会是死的
  $$('#tabs .tab').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab) })
  })
  bindReport()
  bindShots()
  bindTrack()
  bindFaq()
  boot()
})()
