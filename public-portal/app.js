/* ==========================================================================
   IT 报障服务台（员工自助门户）前端逻辑
   --------------------------------------------------------------------------
   · 只调用 /api/public/*（公网进程白名单内接口），不涉及任何管理接口
   · 不使用框架、不使用 CDN、不写 Cookie，弱网/老旧手机也能正常使用
   · 所有插入页面的文本都经过 esc() 转义，避免知识库内容里带 HTML 被解释
   ========================================================================== */
(function () {
  'use strict'

  var KEY = new URLSearchParams(location.search).get('k') || ''
  var API = '/api/public'
  var LAST_NO = 'itops_last_report_no'

  var state = {
    tab: 'report',
    priority: 'normal',
    reportKey: KEY,
    options: { dept: [], app_system: [], problem_type: [] },
    current: null,
    score: 0,
    // 已上传成功的故障截图地址（最多 3 张）
    attachments: [],
    uploading: 0
  }

  // ---------------- 工具 ----------------
  function $(sel, root) { return (root || document).querySelector(sel) }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  var toastTimer = null
  function toast(msg, isErr) {
    var el = $('#toast')
    el.textContent = msg
    el.className = 'toast' + (isErr ? ' err' : '')
    el.hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { el.hidden = true }, 3200)
  }

  function request(path, opt) {
    opt = opt || {}
    var cfg = { method: opt.method || 'GET', headers: {} }
    if (opt.body) {
      cfg.headers['Content-Type'] = 'application/json'
      cfg.body = JSON.stringify(opt.body)
    }
    return fetch(API + path, cfg)
      .then(function (r) {
        return r.json().catch(function () { return { code: 1, message: '服务返回异常（HTTP ' + r.status + '）' } })
      })
      .then(function (j) {
        if (j.code !== 0) throw new Error(j.message || '请求失败')
        return j
      })
  }

  function statusText(s) {
    return s === 'done' ? '已完成' : s === 'pending' ? '待接单' : '处理中'
  }
  function statusClass(s) {
    return s === 'done' ? 'done' : s === 'pending' ? 'pending' : 'processing'
  }

  // ---------------- Tab 切换 ----------------
  function switchTab(name) {
    state.tab = name
    $$('#tabs .tab').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === name)
    })
    $$('.panel').forEach(function (p) {
      p.hidden = p.dataset.panel !== name
    })
    if (name === 'faq' && !$('#faqList').dataset.loaded) loadFaq('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------------- 初始化 ----------------
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
  var PHONE_ICO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9">' +
    '<path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6.1 6.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" stroke-linejoin="round"/></svg>'

  function telHref(phone) {
    return 'tel:' + String(phone || '').replace(/[^\d+]/g, '')
  }

  function renderDuty(list) {
    var bar = $('#duty')
    if (!bar) return
    if (!list || !list.length) { bar.hidden = true; return }
    bar.innerHTML = ''
    list.slice(0, 2).forEach(function (c) {
      var a = document.createElement('a')
      a.className = 'duty-item'
      a.href = telHref(c.phone)
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
      fa.textContent = (first.name ? first.name + ' ' : '') + first.phone
      foot.appendChild(fa)
    }
  }

  function showBlocked(title, desc) {
    $('#blocked').hidden = false
    $('#blockedTitle').textContent = title
    $('#blockedDesc').textContent = desc
  }

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

  function fillSelect(sel, list, placeholder) {
    var html = '<option value="">' + esc(placeholder) + '</option>'
    list.forEach(function (v) { html += '<option value="' + esc(v) + '">' + esc(v) + '</option>' })
    sel.innerHTML = html
  }

  // ---------------- 报障 ----------------
  function bindReport() {
    var content = $('#fContent')
    content.addEventListener('input', function () {
      $('#cnt').textContent = content.value.length
    })

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
      if (!contact) { toast('请填写您的姓名', true); $('#fContact').focus(); return }
      if (text.length < 4) { toast('请简单描述遇到的问题', true); content.focus(); return }

      if (state.uploading > 0) { toast('图片还在上传，请稍等两秒', true); return }

      var btn = $('#btnSubmit')
      btn.disabled = true
      btn.textContent = '提交中…'

      request('/report', {
        method: 'POST',
        body: {
          k: state.reportKey,
          contact: contact,
          dept: $('#fDept').value || '',
          phone: $('#fPhone').value.trim(),
          app_system: $('#fSystem').value || '',
          priority: state.priority,
          content: text,
          attachment: state.attachments.slice(0, 3)
        }
      })
        .then(function (j) {
          var no = (j.data && j.data.report_no) || ''
          try { localStorage.setItem(LAST_NO, no) } catch (err) {}
          $('#doneNo').textContent = no
          $('#reportForm').hidden = true
          $('#reportDone').hidden = false
          $('#tNo').value = no
          window.scrollTo({ top: 0, behavior: 'smooth' })
        })
        .catch(function (err) { toast(err.message, true) })
        .then(function () {
          btn.disabled = false
          btn.textContent = '提交报障'
        })
    })

    $('#btnGoTrack').addEventListener('click', function () {
      $('#tNo').value = $('#doneNo').textContent
      $('#tPhone').value = ($('#fPhone').value || '').replace(/\D/g, '').slice(-4)
      switchTab('track')
      doTrack()
    })

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
  function compressImage(file, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type) || /gif/i.test(file.type)) return resolve(file)
      var img = new Image()
      var url = URL.createObjectURL(file)
      img.onload = function () {
        URL.revokeObjectURL(url)
        var w = img.naturalWidth || 0
        var h = img.naturalHeight || 0
        if (!w || !h) return resolve(file)
        var scale = Math.min(1, maxSide / Math.max(w, h))
        if (scale >= 1 && file.size < 900 * 1024) return resolve(file)
        var cv = document.createElement('canvas')
        cv.width = Math.round(w * scale)
        cv.height = Math.round(h * scale)
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
        if (!cv.toBlob) return resolve(file)
        cv.toBlob(function (blob) { resolve(blob || file) }, 'image/jpeg', quality)
      }
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file) }
      img.src = url
    })
  }

  function refreshShotUI() {
    var box = $('#shots')
    if (box) box.hidden = state.attachments.length + state.uploading === 0
    var hint = $('#shotHint')
    if (hint) {
      var left = 3 - state.attachments.length - state.uploading
      hint.textContent = state.uploading > 0
        ? '正在上传图片…'
        : (left > 0 ? '还可以上传 ' + left + ' 张，拍下报错弹窗更清楚' : '已达 3 张上限')
    }
    var pick = $('#btnPick')
    var shot = $('#btnShot')
    var full = state.attachments.length + state.uploading >= 3
    if (pick) pick.disabled = full
    if (shot) shot.disabled = full
  }

  function addShotItem(localUrl) {
    var box = $('#shots')
    var item = document.createElement('div')
    item.className = 'shot uploading'
    item.innerHTML = '<img alt="故障截图"><button type="button" class="shot-del" aria-label="删除">×</button>'
    item.querySelector('img').src = localUrl
    item.querySelector('.shot-del').addEventListener('click', function () {
      if (item.dataset.url) {
        state.attachments = state.attachments.filter(function (u) { return u !== item.dataset.url })
      }
      if (item.dataset.uploading === '1') state.uploading = Math.max(0, state.uploading - 1)
      item.remove()
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
        var name = (f.name || 'shot').replace(/\.[^.]+$/, '') + '.jpg'
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
        item.remove()
        toast(e.message || '图片上传失败，可先不传图片直接提交', true)
      }).then(function () {
        state.uploading = Math.max(0, state.uploading - 1)
        refreshShotUI()
      })
    })
  }

  function clearShots() {
    state.attachments = []
    state.uploading = 0
    var box = $('#shots')
    if (box) box.innerHTML = ''
    refreshShotUI()
  }

  function bindShots() {
    var pick = $('#filePick')
    var shot = $('#fileShot')
    $('#btnPick').addEventListener('click', function () { pick.click() })
    $('#btnShot').addEventListener('click', function () { shot.click() })
    ;[pick, shot].forEach(function (input) {
      if (!input) return
      input.addEventListener('change', function () {
        uploadShots(input.files)
        input.value = ''
      })
    })
    refreshShotUI()
  }

  // ---------------- 查进度 ----------------
  function bindTrack() {
    $('#trackForm').addEventListener('submit', function (e) {
      e.preventDefault()
      doTrack()
    })

    $('#stars').addEventListener('click', function (e) {
      var b = e.target.closest('button')
      if (!b) return
      state.score = Number(b.dataset.s)
      paintStars(state.score)
    })

    $('#btnRate').addEventListener('click', function () {
      if (!state.current) return
      if (!state.score) { toast('请先选择评分', true); return }
      var btn = $('#btnRate')
      btn.disabled = true
      request('/satisfy', {
        method: 'POST',
        body: {
          report_no: state.current.report_no,
          phone: $('#tPhone').value.trim(),
          score: state.score,
          comment: $('#rateComment').value.trim()
        }
      })
        .then(function () {
          toast('感谢您的评价！')
          doTrack()
        })
        .catch(function (err) { toast(err.message, true) })
        .then(function () { btn.disabled = false })
    })
  }

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
    btn.disabled = true
    request('/track', { method: 'POST', body: { report_no: no, phone: $('#tPhone').value.trim() } })
      .then(function (j) {
        var d = j.data || {}
        state.current = d
        try { localStorage.setItem(LAST_NO, d.report_no || no) } catch (err) {}

        $('#trackResult').hidden = false
        var tag = $('#rStatus')
        tag.textContent = statusText(d.status)
        tag.className = 'tag ' + statusClass(d.status)
        $('#rNo').textContent = d.report_no || ''
        $('#rContent').textContent = d.service_content || '—'
        $('#rSystem').textContent = d.app_system || '—'
        $('#rHappen').textContent = d.happen_time || '—'

        if (d.finish_time) {
          $('#rFinishLine').hidden = false
          $('#rFinish').textContent = d.finish_time
        } else {
          $('#rFinishLine').hidden = true
        }

        if (d.result) {
          $('#rResultBox').hidden = false
          $('#rResult').textContent = d.result
        } else {
          $('#rResultBox').hidden = true
        }

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
            $('#ratedStars').textContent = '★★★★★'.slice(0, d.satisfy_score) + '☆☆☆☆☆'.slice(0, 5 - d.satisfy_score)
          } else {
            $('#ratedBox').hidden = true
          }
        }
      })
      .catch(function (err) {
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
    request('/faq?k=' + encodeURIComponent(KEY) + (kw ? '&keyword=' + encodeURIComponent(kw) : ''))
      .then(function (j) {
        var d = j.data || {}
        box.dataset.loaded = '1'
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
        box.innerHTML = '<div class="empty">加载失败：' + esc(err.message) + '</div>'
      })
  }

  function toggleFaq(item) {
    var ans = $('.faq-a', item)
    if (!ans) return
    if (item.classList.contains('open')) {
      item.classList.remove('open')
      ans.hidden = true
      return
    }
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
        ans.textContent = d.solution || '该问题暂未填写解决方案'
        ans.dataset.loaded = '1'
        item.classList.add('open')
      })
      .catch(function (err) {
        ans.textContent = '加载失败：' + err.message
      })
  }

  // ---------------- 启动 ----------------
  $$('#tabs .tab').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.dataset.tab) })
  })
  bindReport()
  bindShots()
  bindTrack()
  bindFaq()
  boot()
})()
