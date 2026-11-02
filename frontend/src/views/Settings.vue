<!--
  系统设置 —— IT 运维工单台账与日报自动管理系统
  门户对外地址、自助入口密钥、AI 与通知、备份等全局配置

  作者：锦轩 (JinXuan) <2686389727@qq.com>
  创建：2026-10-29　　版本：1.2.1
  版权：Copyright (c) 2026 锦轩 (JinXuan). All rights reserved.
  许可：个人自用及 ≤10 人、年营收 ≤200 万元的小团队内部使用免费；
        其余商业使用需向作者购买授权，详见根目录 LICENSE 与 NOTICE。
-->
<template>
  <div class="it-page">
    <h3 class="it-section-title">系统设置</h3>

    <!-- 设置按「个人 / 安全 / 外观 / 通知 / 推送 / 自助入口 / 巡检 / 流转 / 数据 / 关于」分区，
         每个分区一张 set-card；标签栏在移动端从左侧改为顶部横向，避免挤占内容宽度 -->
    <el-tabs :tab-position="isMobile ? 'top' : 'left'" class="set-tabs" v-model="activeTab">
      <!-- 个人信息 -->
      <el-tab-pane label="个人信息" name="profile">
        <div class="set-card">
          <h4 class="it-section-title">个人信息</h4>
          <el-form label-width="80px" style="max-width:420px">
            <el-form-item label="账号"><el-input :model-value="me.username" disabled /></el-form-item>
            <el-form-item label="角色">
              <el-tag :type="me.role === 'admin' ? 'danger' : me.role === 'service' ? 'warning' : 'info'">
                {{ me.role === 'admin' ? '管理员' : me.role === 'auditor' ? '审计员' : me.role === 'service' ? '服务台' : '运维工程师' }}
              </el-tag>
            </el-form-item>
            <!-- 账号与角色只读：角色由管理员在用户管理里分配，本人只能改显示用的姓名 -->
            <el-form-item label="姓名">
              <el-input v-model="realName" placeholder="请输入姓名 / 真实姓名" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingProfile" @click="saveProfile">保存个人信息</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <!-- 安全 -->
      <el-tab-pane label="安全 · 修改密码" name="security">
        <div class="set-card">
          <h4 class="it-section-title">修改密码</h4>
          <!-- 校验规则与后端保持一致（至少 6 位、两次输入一致）；成功后强制登出，
               避免旧 token 与已失效的密码并存导致后续接口 401 -->
          <el-form label-width="100px" style="max-width:420px">
            <el-form-item label="原密码"><el-input v-model="pwd.old_password" type="password" show-password placeholder="请输入当前密码" /></el-form-item>
            <el-form-item label="新密码"><el-input v-model="pwd.new_password" type="password" show-password placeholder="至少 6 位" /></el-form-item>
            <el-form-item label="确认新密码">
              <el-input v-model="pwd.confirm" type="password" show-password placeholder="再次输入新密码" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingPwd" @click="savePassword">修改密码</el-button>
            </el-form-item>
          </el-form>
          <p class="tip">建议定期修改密码；修改成功后需重新登录。</p>
        </div>
      </el-tab-pane>

      <!-- 外观个性化 -->
      <el-tab-pane label="外观 · 主题" name="appearance">
        <div class="set-card">
          <h4 class="it-section-title">个性化（主题配色与深浅模式）</h4>
          <!-- 主题只写本机 localStorage（utils/theme），不落库：换浏览器或换电脑需要重新选 -->
          <p class="tip">主色将应用到整个系统（按钮、菜单高亮、卡片标题、标签、进度条等），并记忆到本机；可一键切换深 / 浅色模式。</p>

          <!-- 预设色板 + 取色器自定义；当前主色用对勾和描边标出 -->
          <div class="sub-label">主题主色</div>
          <div class="theme-row">
            <div
              v-for="c in presets"
              :key="c.value"
              class="theme-chip"
              :class="{ active: currentPrimary === c.value }"
              :style="{ background: c.value }"
              :title="c.label"
              @click="pickTheme(c.value)"
            >
              <el-icon v-if="currentPrimary === c.value"><Check /></el-icon>
            </div>
            <el-color-picker v-model="customColor" @change="pickTheme" />
            <span class="custom-label">自定义主色</span>
          </div>

          <div class="sub-label" style="margin-top:18px">显示模式</div>
          <el-switch v-model="darkMode" active-text="深色模式" inactive-text="浅色模式" @change="applyMode" />

          <div style="margin-top:18px">
            <el-button @click="resetTheme">恢复默认</el-button>
          </div>

          <div class="preview">
            <el-button type="primary">主按钮</el-button>
            <el-button>默认按钮</el-button>
            <el-tag type="success">成功</el-tag>
            <el-tag type="warning">警告</el-tag>
            <el-progress :percentage="60" style="width:160px" />
            <span class="bar"></span>
          </div>
        </div>
      </el-tab-pane>

      <!-- 通知与提醒 -->
      <el-tab-pane label="通知与提醒" name="notify">
        <div class="set-card">
          <h4 class="it-section-title">通知与提醒</h4>
          <!-- 两项都只影响本机浏览器展示，不进数据库；关掉待办浮窗不会影响待办数据本身 -->
          <p class="tip">设置在数据看板中是否展示以下提醒（仅本机生效）。</p>
          <el-form label-width="160px" style="max-width:520px">
            <el-form-item label="看板显示项目到期提醒">
              <el-switch v-model="showDue" @change="saveNotify" />
            </el-form-item>
            <el-form-item label="桌面待办浮窗提醒">
              <el-switch v-model="showTodoFloat" @change="saveNotify" />
              <span class="inline-tip">（右侧浮动待办面板是否显示）</span>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <!-- 消息推送（群机器人） -->
      <el-tab-pane label="消息推送" name="push">
        <div class="set-card">
          <h4 class="it-section-title">群机器人推送</h4>
          <p class="tip">
            把「超期工单提醒、今日小结、故障通知」推送到企业微信 / 钉钉 / 飞书群，不用天天盯着系统。
            <br />在企业微信群里「添加群机器人」复制 Webhook 地址填到这里即可（仅管理员可配置）。
          </p>
          <!-- 订阅事件在库里存成逗号串（overdue,report,incident），这里用 eventsArr 数组承接多选框，
               保存时再 join 回字符串 -->
          <el-form label-width="120px" style="max-width:620px">
            <el-form-item label="推送渠道">
              <el-radio-group v-model="notify.channel">
                <el-radio-button value="wecom">企业微信</el-radio-button>
                <el-radio-button value="dingtalk">钉钉</el-radio-button>
                <el-radio-button value="feishu">飞书</el-radio-button>
                <el-radio-button value="webhook">自定义</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="Webhook 地址">
              <el-input v-model="notify.webhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." clearable />
            </el-form-item>
            <el-form-item label="订阅事件">
              <el-checkbox-group v-model="notify.eventsArr">
                <el-checkbox value="overdue">每日待跟进（09:00）</el-checkbox>
                <el-checkbox value="report">今日小结（18:00）</el-checkbox>
                <el-checkbox value="incident">严重故障（P1/P2）</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="启用推送">
              <el-switch v-model="notify.is_enable" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="notifySaving" @click="saveNotifyCfg">保存配置</el-button>
              <el-button :loading="notifyTesting" @click="testNotifyCfg">发送测试消息</el-button>
            </el-form-item>
          </el-form>
          <el-alert v-if="!userStore.isAdmin" type="info" :closable="false" show-icon title="仅管理员可以修改推送配置。" />
        </div>
      </el-tab-pane>

      <!-- 自助服务入口 -->
      <el-tab-pane label="自助服务入口" name="selfservice">
        <div class="set-card">
          <h4 class="it-section-title">员工自助报障 · 常见问题门户</h4>
          <p class="tip">
            员工自助门户已从管理端拆分成<strong>独立公网入口</strong>，与管理后台分端口运行：
            管理端只在内网访问，门户端口对外开放。把下面二维码打印贴到工位、打印机、会议室，员工扫码即可报障，无需登录账号。
          </p>
          <!-- 这一整块配置的是「员工端」：开关、公网地址、值班电话、入口密钥、二维码 -->
          <el-form label-width="150px" style="max-width:620px">
            <el-form-item label="开启扫码报障">
              <el-switch v-model="ss.report_enable" :disabled="!userStore.isAdmin" @change="saveSs" />
            </el-form-item>
            <el-form-item label="开启常见问题门户">
              <el-switch v-model="ss.faq_enable" :disabled="!userStore.isAdmin" @change="saveSs" />
            </el-form-item>
            <!-- 公网门户地址必须指向员工端端口（默认 8081），不能填管理端端口：
                 填错时员工扫码打开的是后台登录页，看起来「样式不对 / 打不开」，见下面两条 alert 的拦截 -->
            <el-form-item label="公网门户地址">
              <div style="display:flex;gap:8px;width:100%;max-width:560px">
                <el-input v-model="ss.public_base_url" placeholder="如 http://it-report.example.com:8081"
                  :disabled="!userStore.isAdmin" clearable @keyup.enter="saveBase" />
                <el-button v-if="userStore.isAdmin" type="primary" :loading="ssSaving" @click="saveBase">保存</el-button>
              </div>
              <div class="tip" style="margin-top:6px;line-height:1.6">
                员工在外网访问自助门户的地址，填<strong>域名或公网 IP</strong>都可以，端口填员工门户端口（默认 8081）。
                <br />只填 <code>协议://域名或IP:端口</code>，<strong>不要带路径</strong>。
              </div>
              <!-- 命中管理端端口：红色报错，并给出 suggestedBase 可直接抄的正确地址 -->
              <el-alert v-if="portIsAdmin" type="error" :closable="false" show-icon style="margin-top:10px"
                title="端口填错了：这是管理端端口，扫码会打开后台登录页">
                <div style="font-size:12.5px;line-height:1.7">
                  管理端 <code>{{ ss.admin_port }}</code>（要登录才能用，员工打不开），员工门户是 <code>{{ ss.public_port }}</code>。
                  <br />请改成 <code>{{ suggestedBase }}</code>，保存后重新打印二维码。
                </div>
              </el-alert>
              <!-- 没写端口时浏览器按 80/443 访问，而门户默认映射在 8081，只有走 nginx 反代才是对的，
                   所以这里给黄色提示而不是错误，避免误伤已做反代的用户 -->
              <el-alert v-if="ss.public_base_url && !baseHasPort && !portIsAdmin" type="warning" :closable="false" show-icon style="margin-top:10px"
                title="地址里没有写端口，浏览器会按 80 端口访问">
                <div style="font-size:12.5px;line-height:1.7">
                  员工门户默认映射在 <code>{{ ss.public_port }}</code>，请写成 <code>http://公网IP:{{ ss.public_port }}</code>。
                  <br />如果你已经用宝塔 / nginx 把域名反代到 {{ ss.public_port }}，填 <code>http://your-domain.com</code> 就是对的。
                  <br />打开下面链接看到「IT 报障服务台」页面才算配置正确。
                </div>
              </el-alert>
            </el-form-item>
          </el-form>

          <h4 class="it-section-title" style="margin-top:20px">值班 IT 联系方式</h4>
          <!-- 最多 2 条，电话为空的行在 saveDuty 时会被过滤掉；门户上点击即唤起拨号盘 -->
          <p class="tip" style="margin-bottom:10px">
            填 1~2 个值班同事的电话，员工在自助门户上可以直接点击拨打（手机自动唤起拨号盘）；留空则门户不显示。
          </p>
          <div class="duty-list">
            <div class="duty-row" v-for="(c, i) in ss.duty_contacts" :key="i">
              <el-input v-model="c.name" placeholder="姓名/岗位，如 张伟（值班）" :disabled="!userStore.isAdmin" style="width:220px" />
              <el-input v-model="c.phone" placeholder="电话，如 13800001234" :disabled="!userStore.isAdmin" style="width:200px" />
              <el-input v-model="c.note" placeholder="备注，如 8:30-18:00" :disabled="!userStore.isAdmin" style="width:160px" />
              <el-button v-if="userStore.isAdmin" text type="danger" @click="removeDuty(i)">删除</el-button>
            </div>
            <div v-if="!ss.duty_contacts.length" class="tip">还没有填写值班电话</div>
          </div>
          <div v-if="userStore.isAdmin" style="margin:10px 0 4px">
            <el-button size="small" plain :disabled="ss.duty_contacts.length >= 2" @click="addDuty">+ 添加联系方式</el-button>
            <el-button size="small" type="primary" :loading="ssSaving" @click="saveDuty">保存联系方式</el-button>
          </div>

          <el-alert v-if="!isPublicBase" type="warning" :closable="false" show-icon style="margin:14px 0"
            title="尚未配置公网门户地址，二维码暂时指向当前内网地址，外网/分公司员工扫码打不开。">
            <div style="font-size:12.5px;line-height:1.6">
              在上面填好地址（如 <code>http://公网IP:8081</code>）后点「保存」，二维码会立即改指向公网门户；内网访问不受影响。
            </div>
          </el-alert>

          <!-- 二维码内容 = 公网地址 + 入口密钥 k；改地址或重置密钥后必须重新 genQr，
               否则打印出去的还是旧码，扫码会打开失败页 -->
          <div class="qr-wrap" v-if="ss.report_enable">
            <div class="qr-box">
              <img v-if="qrData" :src="qrData" class="qr-img" alt="报障二维码" />
              <div v-else class="qr-loading">{{ qrErr || '二维码生成中…' }}</div>
              <div class="qr-cap">扫码报障</div>
            </div>
            <div class="qr-info">
              <div class="qr-line"><span>报障链接</span></div>
              <el-input v-if="reportUrl" :model-value="reportUrl" readonly size="small">
                <template #append>
                  <el-button @click="copy(reportUrl)">复制</el-button>
                  <el-button @click="openUrl(reportUrl)">打开测试</el-button>
                </template>
              </el-input>
              <div v-else class="tip">入口密钥缺失，无法生成链接</div>
              <div class="qr-line" style="margin-top:12px"><span>常见问题链接</span></div>
              <el-input v-if="faqUrl" :model-value="faqUrl" readonly size="small">
                <template #append>
                  <el-button @click="copy(faqUrl)">复制</el-button>
                  <el-button @click="openUrl(faqUrl)">打开测试</el-button>
                </template>
              </el-input>
              <div v-else class="tip">入口密钥缺失，无法生成链接</div>
              <!-- 门户版本号用于排查缓存：与页脚显示的版本不一致，说明浏览器缓存旧页面或服务器门户未更新 -->
              <div class="qr-tip">
                入口密钥：<code>{{ ss.report_key || '—' }}</code>，泄露后可在下方重置，旧二维码立即失效。<br>
                门户端口只开放「报障 / 查进度 / 满意度 / 常见问题」，不包含任何管理接口。
                <br v-if="ss.portal_version">门户版本：<code>v{{ ss.portal_version }}</code>
                <span class="tip">（页脚显示的版本号应与此一致；不一致说明浏览器还在用旧缓存，或服务器上的门户没更新）</span>
              </div>
              <el-button v-if="userStore.isAdmin" size="small" type="danger" plain @click="rotateKey">重置入口密钥</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 数据管理 -->
      <!-- 巡检设置 -->
      <el-tab-pane label="巡检设置" name="inspection">
        <div class="set-card">
          <h4 class="it-section-title">机房巡检区域与巡检项</h4>
          <!-- 区域供巡检页下拉选择；巡检项是每次巡检的默认清单，「需拍照」的项在手机上会强制现场拍照留底 -->
          <p class="tip">
            这里的区域会出现在巡检页的「巡检区域」下拉里，巡检项会作为每次巡检的默认清单。
            <br />勾选「需拍照」的项（如温湿度读数）在手机上会提示现场拍照留底。
          </p>

          <el-form label-width="90px" style="max-width:640px">
            <el-form-item label="巡检区域">
              <div class="area-box">
                <el-tag v-for="(a, i) in inspCfg.areas" :key="a + i" closable :disable-transitions="false"
                  @close="inspCfg.areas.splice(i, 1)">{{ a }}</el-tag>
                <div class="area-add">
                  <el-input v-model="newArea" size="small" placeholder="新增区域，如：四楼机房" style="width:180px"
                    @keyup.enter="addArea" />
                  <el-button size="small" @click="addArea">添加</el-button>
                </div>
              </div>
            </el-form-item>

            <el-form-item label="巡检项">
              <div class="item-box">
                <div v-for="(it, i) in inspCfg.items" :key="i" class="cfg-item">
                  <el-input v-model="it.name" size="small" placeholder="巡检项名称" />
                  <el-checkbox v-model="it.need_photo" size="small">需拍照</el-checkbox>
                  <el-button size="small" text type="danger" :icon="Delete" @click="inspCfg.items.splice(i, 1)" />
                </div>
                <el-button size="small" @click="addInspItem"><el-icon><Plus /></el-icon> 添加巡检项</el-button>
              </div>
            </el-form-item>

            <el-form-item>
              <el-button v-if="userStore.isAdmin" type="primary" :loading="inspSaving" @click="saveInspCfg">保存巡检设置</el-button>
              <el-button @click="loadInspCfg">恢复已保存</el-button>
            </el-form-item>
          </el-form>
          <el-alert v-if="!userStore.isAdmin" type="info" :closable="false" show-icon title="仅管理员可以修改巡检设置。" />
        </div>
      </el-tab-pane>

      <!-- 工单流转（接单方式 / 服务台） -->
      <el-tab-pane label="工单流转" name="workflow">
        <div class="set-card">
          <h4 class="it-section-title">接单方式与服务台</h4>
          <!-- 开关只影响「新工单通知谁」：关闭=全员抢单，开启=只通知服务台+管理员由服务台派单；
               已在处理中的工单不受影响 -->
          <p class="tip">
            员工扫码报障后，系统会自动给运维生成待办，并在浏览器右下角弹出「新工单待接取」提醒；
            谁先点「接取」谁负责，其他人立即无法再接（实时同步），接完还可以转单给同事。
            <br />公司如果有服务台（专人派单），打开下面的开关即可改为「服务台派单」模式。
          </p>
          <el-form label-width="150px" style="max-width:680px">
            <el-form-item label="启用服务台派单">
              <el-switch v-model="wf.service_desk_enable" :disabled="!userStore.isAdmin" :loading="wfSaving" @change="saveWf" />
              <span class="inline-tip">
                {{ wf.service_desk_enable ? '新工单只通知服务台 + 管理员，由服务台指派工程师' : '新工单通知全部运维，抢单制（默认，无需服务台）' }}
              </span>
            </el-form-item>
          </el-form>
          <el-alert type="info" :closable="false" show-icon
            title="服务台是可选角色：不需要服务台时保持关闭，运维在右下角接单提示里点「接取」就能开始处理；需要在账号管理里把派单人员设为「服务台」角色。" />
          <div class="flow-steps">
            <div class="fs-item"><span class="fs-n">1</span>员工扫码报障 → 工单进入「待接单」池</div>
            <div class="fs-item"><span class="fs-n">2</span>运维账号收到待办 + 右下角弹窗提醒</div>
            <div class="fs-item"><span class="fs-n">3</span>点击「接取」→ 状态转为处理中，只有一人能接走</div>
            <div class="fs-item"><span class="fs-n">4</span>忙不过来可「转单」给同事，或「退回待接单池」</div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="数据管理" name="data">
        <div class="set-card">
          <h4 class="it-section-title">数据与导出</h4>
          <!-- 快捷入口：审计员看不到项目管理与 AI 设置（只读角色） -->
          <p class="tip">快速进入数据相关模块。</p>
          <div class="entry-grid">
            <div class="entry" @click="go('/report-export')">
              <el-icon><Download /></el-icon>
              <div><div class="entry-title">报表导出</div><div class="entry-sub">导出工单 / 历史台账</div></div>
            </div>
            <div class="entry" @click="go('/knowledge')">
              <el-icon><Reading /></el-icon>
              <div><div class="entry-title">个人运维知识库</div><div class="entry-sub">沉淀与检索处理方案</div></div>
            </div>
            <div v-if="!userStore.isAuditor" class="entry" @click="go('/projects')">
              <el-icon><FolderOpened /></el-icon>
              <div><div class="entry-title">项目管理</div><div class="entry-sub">进度与到期跟进</div></div>
            </div>
            <div v-if="!userStore.isAuditor" class="entry" @click="go('/ai-assistant')">
              <el-icon><MagicStick /></el-icon>
              <div><div class="entry-title">AI 接入设置</div><div class="entry-sub">配置本人的 AI 供应商</div></div>
            </div>
          </div>

          <div v-if="userStore.isAdmin" class="backup-box">
            <h4 class="it-section-title" style="margin-top:22px">系统备份与恢复（压缩包）</h4>
            <p class="tip">
              备份会打成一个 <b>.zip 压缩包</b>，里面包含<strong>整个系统的数据和设置</strong>：全部业务数据（工单、故障、巡检、台账、知识库、项目、日报/月报、待办、目标）、
              系统设置与字典、账号及密码、每人的 AI 配置，以及巡检/工单里上传的图片附件。恢复时上传压缩包即可<strong>自动解包、自动还原</strong>，恢复前系统会自动留一份快照，恢复错了可以退回。
              <br /><span class="bk-warn">压缩包含账号密码与 AI 密钥，请只存放在可信位置。</span>
            </p>
            <div class="bk-row">
              <el-button type="primary" :loading="exporting" @click="onBackupCreate">
                <el-icon><Download /></el-icon> 立即备份（生成并下载 .zip）
              </el-button>
              <!-- 借用 el-upload 的文件选择能力：恢复逻辑全在 onBackupRestore 里走备份接口，
                   该函数最后返回 false，阻止 el-upload 自己再发一次默认上传请求 -->
              <el-upload :show-file-list="false" :before-upload="onBackupRestore" accept=".zip">
                <el-button type="warning" plain :loading="restoring">上传备份包恢复</el-button>
              </el-upload>
              <el-button plain :loading="listing" @click="loadBackupList">
                <el-icon><Refresh /></el-icon> 刷新备份列表
              </el-button>
            </div>

            <!-- 当前库体积与各表条数，用于判断备份是否「包含全部数据」 -->
            <div v-if="dbInfo" class="bk-info">
              数据库 {{ dbInfo.db_size_mb }} MB　·　数据表 {{ Object.keys(dbInfo.tables || {}).length }} 张　·　
              工单 {{ dbInfo.tables.ticket }} 条　·　故障 {{ dbInfo.tables.incident }} 条　·　
              知识库 {{ dbInfo.tables.knowledge }} 条　·　附件 {{ dbInfo.uploads_files }} 个（{{ dbInfo.uploads_mb }} MB）
            </div>

            <div class="bk-list">
              <div class="sub-label" style="margin-top:14px">
                服务器上的备份包
                <span class="inline-tip">保留最近 {{ backupKeep }} 个 · 服务器备份目录 {{ backupDir || '—' }}</span>
              </div>
              <el-table :data="backups" size="small" empty-text="还没有备份包，点「立即备份」生成" max-height="260">
                <el-table-column prop="name" label="备份包" min-width="230" show-overflow-tooltip />
                <el-table-column label="大小" width="92">
                  <template #default="{ row }">{{ row.size_mb }} MB</template>
                </el-table-column>
                <el-table-column label="生成时间" width="150">
                  <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="180" class-name="col-ops">
                  <template #default="{ row }">
                    <el-button size="small" text type="primary" @click="onBackupDownload(row)">下载</el-button>
                    <el-button size="small" text type="warning" @click="onBackupRestoreLocal(row)">恢复</el-button>
                    <el-button size="small" text type="danger" @click="onBackupDelete(row)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 关于 -->
      <el-tab-pane label="关于" name="about">
        <div class="set-card">
          <h4 class="it-section-title">关于本系统</h4>
          <el-descriptions :column="1" border style="max-width:560px">
            <el-descriptions-item label="系统名称">IT 运维工单台账与日报自动管理系统</el-descriptions-item>
            <el-descriptions-item label="版本">v1.0.0</el-descriptions-item>
            <el-descriptions-item label="技术栈">Vue3 + Element Plus / Node + Express + MySQL / Docker</el-descriptions-item>
            <el-descriptions-item label="说明">工单即知识库：历史处理方式可自动推荐；AI 日报 / 月报 / 知识库整理均按每用户独立配置。</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { Check, Download, Reading, FolderOpened, MagicStick, Plus, Delete, Refresh } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import { ElMessage, ElMessageBox } from 'element-plus'
import R from '../api'
import { useUserStore } from '../store/user'
import { saveTheme, getTheme } from '../utils/theme'
import { workflow } from '../utils/workflow'

const router = useRouter()
const userStore = useUserStore()

// 移动端把左侧标签栏改为顶部横向
const isMobile = ref(window.innerWidth <= 820)
function onResize() { isMobile.value = window.innerWidth <= 820 }
// 当前选中的设置分区，默认落在「个人信息」
const activeTab = ref('profile')

// 个人信息
// me 只读：账号与角色来自 /me，角色由管理员分配，本人不能改
const me = reactive({ username: '', role: '' })
// 可编辑的显示姓名，保存成功后要同步回 userStore，否则右上角仍是旧名字
const realName = ref('')
const savingProfile = ref(false)

// 密码
// confirm 只在前端做一致性校验，不进请求体
const pwd = reactive({ old_password: '', new_password: '', confirm: '' })
const savingPwd = ref(false)

// 主题
// 预设色板；主色会写到 CSS 变量 --it-primary，全站按钮/高亮/图表都跟着变
const presets = [
  { label: '科技蓝（默认）', value: '#2f6fed' },
  { label: '活力橙', value: '#f0682f' },
  { label: '森林绿', value: '#18a058' },
  { label: '紫罗兰', value: '#7c5cff' },
  { label: '玫瑰红', value: '#e54545' },
  { label: '青碧', value: '#0fb5d6' }
]
const customColor = ref('')
// 当前生效的主色与深浅模式：初值先给默认值，onMounted 时用 loadTheme 覆盖成本机记忆
const currentPrimary = ref('#2f6fed')
const darkMode = ref(false)

// 通知
// 看板到期提醒 / 右侧待办浮窗是否显示，只存本机 localStorage
const showDue = ref(true)
const showTodoFloat = ref(true)

// 读取本机提醒开关：没有存过（null）时按「显示」处理，只有明确存 '0' 才关闭
function loadNotify() {
  showDue.value = localStorage.getItem('itops_show_due') !== '0'
  showTodoFloat.value = localStorage.getItem('itops_show_todo_float') !== '0'
}
// 保存后广播事件：布局组件监听后立即隐藏/显示待办浮窗，不必刷新页面
function saveNotify() {
  localStorage.setItem('itops_show_due', showDue.value ? '1' : '0')
  localStorage.setItem('itops_show_todo_float', showTodoFloat.value ? '1' : '0')
  window.dispatchEvent(new CustomEvent('itops:settings-changed', { detail: { key: 'itops_show_todo_float' } }))
  ElMessage.success('提醒设置已保存')
}

async function loadMe() {
  try {
    const data = await R.getMe()
    if (data) { me.username = data.username; me.role = data.role; realName.value = data.real_name || '' }
  } catch (e) {}
}

async function saveProfile() {
  savingProfile.value = true
  try {
    const data = await R.updateMe({ real_name: realName.value })
    // 同步写回 localStorage，否则刷新后右上角又变回旧姓名
    userStore.patchUser({ real_name: data.real_name })
    ElMessage.success('个人信息已更新')
  } catch (e) { ElMessage.error(e.__message || e.message) } finally { savingProfile.value = false }
}

// 改密：先做三项本地校验（必填、长度、两次一致），成功即登出并整页刷新，
// 让路由守卫和 axios 里的旧 token 一起失效，避免残留的旧凭据继续访问接口
async function savePassword() {
  if (!pwd.old_password || !pwd.new_password) { ElMessage.warning('请填写原密码和新密码'); return }
  if (pwd.new_password.length < 6) { ElMessage.warning('新密码至少 6 位'); return }
  if (pwd.new_password !== pwd.confirm) { ElMessage.warning('两次输入的新密码不一致'); return }
  savingPwd.value = true
  try {
    const res = await R.changePassword({ old_password: pwd.old_password, new_password: pwd.new_password })
    ElMessage.success(res || '密码已修改，请重新登录')
    userStore.logout()
    setTimeout(() => location.reload(), 800)
  } catch (e) { ElMessage.error(e.__message || e.message) } finally { savingPwd.value = false }
}

// 主题切换统一走 saveTheme（写 localStorage + 立刻改 CSS 变量），不做接口调用
function pickTheme(color) {
  if (!color) return
  currentPrimary.value = color
  customColor.value = color
  saveTheme(color, darkMode.value ? 'dark' : 'light')
  ElMessage.success('已应用新主题')
}
// 深/浅色切换只换 mode，主色沿用当前值
function applyMode(val) {
  saveTheme(currentPrimary.value, val ? 'dark' : 'light')
}
// 恢复默认：主色回到科技蓝 + 浅色模式，同时把取色器一起复位
function resetTheme() {
  currentPrimary.value = '#2f6fed'
  customColor.value = '#2f6fed'
  darkMode.value = false
  saveTheme('#2f6fed', 'light')
}

// 打开页面时回填本机记住的主题，保证刷新后配色不闪回默认
function loadTheme() {
  const t = getTheme()
  currentPrimary.value = (t && t.primary) || '#2f6fed'
  darkMode.value = !!(t && t.mode === 'dark')
  customColor.value = currentPrimary.value
}

function go(p) { router.push(p) }

/* ---------- 群机器人推送 ---------- */
// eventsArr 是给多选框用的数组，提交时 join 成 'overdue,report,incident' 再入库
const notify = reactive({ channel: 'wecom', webhook: '', eventsArr: ['overdue', 'report', 'incident'], is_enable: 1 })
const notifySaving = ref(false)
const notifyTesting = ref(false)

// 读取推送配置：非管理员接口会 403，这里静默忽略，页面保持默认值只读展示
async function loadPushCfg() {
  try {
    const c = await R.getNotifyConfig()
    notify.channel = c.channel || 'wecom'
    notify.webhook = c.webhook || ''
    notify.is_enable = c.is_enable === 0 ? 0 : 1
    notify.eventsArr = String(c.events || 'overdue,report,incident').split(',').filter(Boolean)
  } catch { /* 非管理员等情况下忽略 */ }
}

// 保存推送配置：数组 join 成逗号串；webhook 为空直接拦下，避免存一份永远发不出去的配置
async function saveNotifyCfg() {
  if (!notify.webhook) return ElMessage.warning('请填写 Webhook 地址')
  notifySaving.value = true
  try {
    await R.saveNotifyConfig({
      channel: notify.channel,
      webhook: notify.webhook,
      events: notify.eventsArr.join(','),
      is_enable: notify.is_enable
    })
    ElMessage.success('推送配置已保存')
  } catch (e) { ElMessage.error(e.__message || e.message) } finally { notifySaving.value = false }
}

// 发测试消息：用当前输入框里的 channel/webhook 直接发，不必先保存，
// 方便一边改格式一边验证群机器人是否收到了
async function testNotifyCfg() {
  if (!notify.webhook) return ElMessage.warning('请先填写 Webhook 地址')
  notifyTesting.value = true
  try {
    await R.testNotify({ channel: notify.channel, webhook: notify.webhook })
    ElMessage.success('测试消息已发送，请查看群消息')
  } catch (e) { ElMessage.error(e.__message || e.message) } finally { notifyTesting.value = false }
}

/* ---------- 巡检设置 ---------- */
// 巡检配置：areas 是区域名数组，items 是 {name, need_photo} 清单，保存时整体覆盖
const inspCfg = reactive({ areas: [], items: [] })
const newArea = ref('')
const inspSaving = ref(false)

// 读取巡检配置时把 items 重新映射成只有 name/need_photo 的干净对象，
// 避免把后端返回的 id、时间戳等字段回传造成覆盖
async function loadInspCfg() {
  try {
    const c = await R.getInspectionConfig()
    inspCfg.areas = (c.areas || []).slice()
    inspCfg.items = (c.items || []).map(x => ({ name: x.name, need_photo: !!x.need_photo }))
    newArea.value = ''
  } catch (e) { /* 非管理员或接口异常时忽略 */ }
}
// 区域要去重：同名区域会让巡检页下拉出现两个一样的选项
function addArea() {
  const v = (newArea.value || '').trim()
  if (!v) return
  if (inspCfg.areas.includes(v)) return ElMessage.warning('该区域已存在')
  inspCfg.areas.push(v)
  newArea.value = ''
}
function addInspItem() {
  inspCfg.items.push({ name: '', need_photo: false })
}
// 保存前过滤掉名字为空的行（只是点了「添加巡检项」还没填的情况），并要求区域/巡检项各至少一个
async function saveInspCfg() {
  const items = inspCfg.items.filter(x => (x.name || '').trim())
  if (!inspCfg.areas.length) return ElMessage.warning('请至少保留一个巡检区域')
  if (!items.length) return ElMessage.warning('请至少保留一个巡检项')
  inspSaving.value = true
  try {
    const c = await R.saveInspectionConfig({ areas: inspCfg.areas, items })
    inspCfg.areas = c.areas; inspCfg.items = c.items
    ElMessage.success('巡检设置已保存')
  } catch (e) { ElMessage.error(e.__message || e.message) } finally { inspSaving.value = false }
}

/* ---------- 自助服务入口 ---------- */
// 门户配置：report_key 是免登录入口密钥（k 参数），admin_port/public_port 由后端下发用于校验地址
const ss = reactive({ report_enable: true, faq_enable: true, report_key: '', public_base_url: '', duty_contacts: [], portal_version: '', admin_port: '8080', public_port: '8081' })
// 二维码 dataURL 与其失败原因，两者互斥展示
const qrData = ref('')
const qrErr = ref('')
const ssSaving = ref(false)
// 员工自助门户与管理端已分离：二维码必须指向**公网门户地址**，
// 未配置时退回当前访问地址（仅内网可用，适合还没开放公网时的内部试用）
const pubBase = computed(() => (ss.public_base_url || location.origin).replace(/\/+$/, ''))
const isPublicBase = computed(() => !!ss.public_base_url)
const reportUrl = computed(() => (ss.report_key ? `${pubBase.value}/report?k=${ss.report_key}` : ''))
const faqUrl = computed(() => (ss.report_key ? `${pubBase.value}/faq?k=${ss.report_key}` : ''))
// 地址里有没有写端口：没写端口浏览器按 80/443 访问，而员工门户默认映射在 8081，
// 这是「填了地址却打开另一个页面 / 打不开」最常见的原因
const baseHasPort = computed(() => {
  const raw = String(ss.public_base_url || '').trim()
  if (!raw) return true
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw)
    return !!u.port
  } catch { return false }
})
// 地址里实际生效的端口（没写时按协议取 80/443）
const basePort = computed(() => {
  const raw = String(ss.public_base_url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw)
    if (u.port) return u.port
    return u.protocol === 'https:' ? '443' : '80'
  } catch { return '' }
})
// 填成管理端端口：员工扫码会打开后台登录页，这是「页面样式不对」的头号原因
const portIsAdmin = computed(() => !!ss.public_base_url && basePort.value === String(ss.admin_port))
// 端口填错时给出一键可抄的正确写法
const suggestedBase = computed(() => {
  const host = String(ss.public_base_url || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[:/].*$/, '')
  return `http://${host || '你的公网IP'}:${ss.public_port}`
})

// 二维码交给 qrcode 在浏览器本地生成，不经过后端，也不依赖外网图片服务
async function genQr() {
  qrData.value = ''
  qrErr.value = ''
  if (!ss.report_key) {
    qrErr.value = '缺少入口密钥，点下方「重置入口密钥」重新生成'
    return
  }
  try {
    qrData.value = await QRCode.toDataURL(reportUrl.value, {
      width: 260, margin: 1, color: { dark: '#1f2a44', light: '#ffffff' }
    })
  } catch (e) {
    qrErr.value = '二维码生成失败：' + (e.message || e)
  }
}

// 读取门户配置（含后端下发的两个端口），读完立即重画二维码：
// 地址或密钥任意一个变了，码就必须跟着变
async function loadSs() {
  try {
    const c = await R.getPublicSettings()
    ss.report_enable = !!c.report_enable
    ss.faq_enable = !!c.faq_enable
    ss.report_key = c.report_key || ''
    ss.public_base_url = c.public_base_url || ''
    ss.portal_version = c.portal_version || ''
    ss.admin_port = c.admin_port || '8080'
    ss.public_port = c.public_port || '8081'
    ss.duty_contacts = Array.isArray(c.duty_contacts) ? c.duty_contacts.map(x => ({ name: x.name || '', phone: x.phone || '', note: x.note || '' })) : []
    genQr()
  } catch (e) { ElMessage.error('读取自助入口配置失败：' + (e.__message || e.message)) }
}

// 只提交传入的字段，避免「正在输入公网地址时点开关」把半截地址存进去
async function submitSs(patch) {
  if (!userStore.isAdmin) return
  ssSaving.value = true
  try {
    const c = await R.savePublicSettings(patch)
    Object.assign(ss, c)
    genQr()
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error(e.__message || e.message)
    loadSs()
  } finally {
    ssSaving.value = false
  }
}

// 开关类改动只提交两个 enable 字段，不动正在编辑的公网地址
function saveSs() {
  return submitSs({ report_enable: ss.report_enable, faq_enable: ss.faq_enable })
}

// 保存公网地址：先拦管理端端口。填成 ADMIN_PORT 时员工扫码进的是后台登录页，
// 表现为「扫出来样式不对 / 还要登录」，不拦下来用户很难自己发现，
// 所以这里直接报错并提示改成员工门户端口，不提交
function saveBase() {
  if (portIsAdmin.value) {
    ElMessage.error(`这个地址用的是管理端端口 ${ss.admin_port}，员工扫码会打开后台登录页。请改成 :${ss.public_port}`)
    return
  }
  return submitSs({ public_base_url: ss.public_base_url })
}

// 值班联系方式：最多 2 个，电话必填
function addDuty() {
  if (ss.duty_contacts.length >= 2) return
  ss.duty_contacts.push({ name: '', phone: '', note: '' })
}
function removeDuty(i) {
  ss.duty_contacts.splice(i, 1)
}
// 只提交 name/phone/note 并丢掉没填电话的空行：门户上电话为空点不动，留着只会占位
function saveDuty() {
  const list = ss.duty_contacts
    .map(c => ({ name: (c.name || '').trim(), phone: (c.phone || '').trim(), note: (c.note || '').trim() }))
    .filter(c => c.phone)
  return submitSs({ duty_contacts: list })
}

// 重置入口密钥（rotate=1 由后端换新 k）：已发出去的二维码和链接立即失效，
// 属于破坏性操作，所以先 confirm 再提交
async function rotateKey() {
  try {
    await ElMessageBox.confirm('重置后，已打印的二维码全部失效，需要重新打印。确认继续？', '重置入口密钥', { type: 'warning' })
  } catch { return }
  try {
    const c = await R.savePublicSettings({ rotate: 1 })
    Object.assign(ss, c)
    genQr()
    ElMessage.success('已重置入口密钥')
  } catch (e) { ElMessage.error(e.__message || e.message) }
}

function copy(text) {
  if (!text) return
  navigator.clipboard?.writeText(text).then(
    () => ElMessage.success('已复制'),
    () => ElMessage.warning('复制失败，请手动选中复制')
  )
}

// 当场打开门户验证：能看到「IT 报障服务台」并带值班电话，才算地址配对了
function openUrl(url) {
  if (!url) return
  window.open(url, '_blank', 'noopener')
}

/* ---------- 备份与恢复（zip 压缩包） ---------- */
const exporting = ref(false)
const restoring = ref(false)
const listing = ref(false)
// dbInfo 是数据库体积/条数概览，backups 是服务器备份目录里的压缩包列表
const dbInfo = ref(null)
const backups = ref([])
// backupDir / backupKeep 都来自后端，只做展示：备份目录在容器里通常是宿主机挂载卷
const backupDir = ref('')
const backupKeep = ref(20)

// 非管理员不请求，减少一次必然 403 的调用
async function loadBackupInfo() {
  if (!userStore.isAdmin) return
  try { dbInfo.value = await R.backupInfo() } catch { /* ignore */ }
}

async function loadBackupList() {
  if (!userStore.isAdmin) return
  listing.value = true
  try {
    const r = await R.backupList()
    backups.value = r.files || []
    backupDir.value = r.dir || ''
    backupKeep.value = r.keep || 20
    // 后端能读目录但目录不可用时会给 warn（例如宿主机目录权限不对），提示但不影响页面
    if (r.warn) ElMessage.warning(r.warn)
  } catch (e) {
    backups.value = []
    // 用后端返回的 message，避免只显示 "Request failed with status code 500"
    ElMessage.error('读取备份列表失败：' + (e.__message || e.message))
  } finally { listing.value = false }
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 统一用 a[download] 触发下载并立刻 revoke：blob URL 不释放会一直占内存
async function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 立即备份：服务端生成 zip（留在服务器备份目录 + 立即下载一份）
async function onBackupCreate() {
  exporting.value = true
  try {
    const r = await R.backupCreate()
    ElMessage.success(`备份包已生成（${r.size_mb} MB）`)
    const blob = await R.backupDownload(r.name)
    await saveBlob(blob, r.name)
    loadBackupInfo(); loadBackupList()
  } catch (e) { ElMessage.error('备份失败：' + (e.__message || e.message)) } finally { exporting.value = false }
}

async function onBackupDownload(row) {
  try {
    const blob = await R.backupDownload(row.name)
    await saveBlob(blob, row.name)
  } catch (e) { ElMessage.error('下载失败：' + e.message) }
}

// 恢复结果提示：先报还原了多少条数据/附件，再提示恢复前快照的位置，
// 让用户知道「万一恢复错了」还能从哪退回
function restoreResult(r) {
  const total = r.total_rows != null ? r.total_rows : Object.values(r.tables || {}).reduce((a, b) => a + b, 0)
  ElMessage.success(`恢复完成：${total} 条数据、${r.files || 0} 个附件已还原`)
  if (r.snapshot) ElMessage.info(`恢复前的快照已保存：${r.snapshot}（如需回退可在这里选它再恢复）`)
  loadBackupInfo(); loadBackupList()
  // 账号/设置可能被替换，重新拉一遍当前用户信息
  window.dispatchEvent(new Event('itops:settings-changed'))
}

// 上传 zip 恢复：后端自动解包 + 自动还原
async function onBackupRestore(file) {
  try {
    await ElMessageBox.confirm(
      `确认用「${file.name}」恢复整个系统？\n\n现有全部数据（工单、故障、巡检、知识库、项目、日报月报、待办、目标）以及系统设置、字典、账号、附件都会被备份包里的内容整体替换。\n\n系统会在恢复前自动生成一份当前快照，恢复错了可以选择快照退回。`,
      '恢复整个系统',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消', customClass: 'restore-confirm' }
    )
  } catch { return false }
  restoring.value = true
  try {
    const r = await R.backupRestoreFile(file)
    restoreResult(r)
  } catch (e) {
    ElMessage.error('恢复失败：' + e.message)
  } finally {
    restoring.value = false
  }
  return false
}

async function onBackupRestoreLocal(row) {
  try {
    await ElMessageBox.confirm(
      `确认用服务器上的「${row.name}」恢复整个系统？现有数据与设置会被整体替换（恢复前会自动留一份快照）。`,
      '恢复整个系统',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' }
    )
  } catch { return }
  restoring.value = true
  try {
    const r = await R.backupRestoreLocal(row.name)
    restoreResult(r)
  } catch (e) {
    ElMessage.error('恢复失败：' + e.message)
  } finally {
    restoring.value = false
  }
}

async function onBackupDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除备份包「${row.name}」？`, '删除备份', { type: 'warning' })
  } catch { return }
  try {
    await R.backupDelete(row.name)
    ElMessage.success('已删除')
    loadBackupList()
  } catch (e) { ElMessage.error(e.__message || e.message) }
}

/* ---------- 工单流转（服务台开关） ---------- */
// service_desk_enable：false=全员抢单，true=新工单只通知服务台与管理员
const wf = reactive({ service_desk_enable: false })
const wfSaving = ref(false)

async function loadWf() {
  try { Object.assign(wf, await R.getWorkflowSettings()) } catch { /* ignore */ }
}
// 保存后同步 utils/workflow 里的内存标记，本页切完立即生效，不用等下次 loadWf
async function saveWf() {
  if (!userStore.isAdmin) return
  wfSaving.value = true
  try {
    const r = await R.saveWorkflowSettings({ service_desk_enable: wf.service_desk_enable })
    Object.assign(wf, r)
    workflow.service_desk_enable = !!r.service_desk_enable
    ElMessage.success('已保存，新工单将按新方式通知')
  } catch (e) {
    ElMessage.error(e.__message || e.message)
    loadWf()
  } finally { wfSaving.value = false }
}

// 各分区配置并行拉取，单个接口失败不影响其他分区渲染
onMounted(() => {
  window.addEventListener('resize', onResize)
  loadInspCfg()
  loadMe(); loadTheme(); loadNotify()
  loadPushCfg(); loadSs(); loadBackupInfo(); loadBackupList()
  loadWf()
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<style scoped>
.qr-wrap { display: flex; gap: 24px; margin-top: 18px; flex-wrap: wrap; }
/* 值班联系方式 */
.duty-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.qr-box { text-align: center; border: 1px solid var(--it-border); border-radius: 12px; padding: 12px; }
.qr-img { width: 180px; height: 180px; display: block; border-radius: 6px; }
.qr-loading { width: 180px; height: 180px; display: flex; align-items: center; justify-content: center; color: var(--it-text-sub); font-size: 13px; }
.qr-cap { font-size: 12px; color: var(--it-text-sub); margin-top: 8px; }
.qr-info { flex: 1; min-width: 280px; }
.qr-line { font-size: 12px; color: var(--it-text-sub); margin-bottom: 6px; }
.qr-tip { font-size: 12px; color: var(--it-text-sub); margin: 12px 0 8px; line-height: 1.7; }
.qr-tip code { background: var(--it-bg); padding: 2px 6px; border-radius: 4px; }
.backup-box { border-top: 1px dashed var(--it-border); margin-top: 20px; }
.bk-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 10px 0; align-items: center; }
.bk-info { font-size: 12px; color: var(--it-text-sub); line-height: 1.9; }
.bk-list { border-top: 1px dashed var(--it-border); margin-top: 14px; padding-top: 4px; }
.bk-warn { color: #d97706; }
.set-tabs :deep(.el-tabs__header) { background: var(--it-card); border-radius: 10px; padding: 8px; }
.set-tabs :deep(.el-tabs__item) { height: 40px; line-height: 40px; white-space: nowrap; }
/* 链接输入框后面的「复制 / 打开测试」两个按钮要紧贴输入框但彼此留缝 */
.set-tabs :deep(.el-input-group__append) { padding: 0 0 0 1px; }
.set-tabs :deep(.el-input-group__append .el-button) { padding: 0 10px; margin: 0; }
.set-tabs :deep(.el-input-group__append .el-button + .el-button) { margin-left: 6px; }
.set-card {
  background: var(--it-card); border: 1px solid var(--it-border);
  border-radius: 10px; padding: 18px 20px;
}
.set-card h4 { margin-bottom: 14px; }
.tip { font-size: 13px; color: var(--it-text-sub); margin: -6px 0 14px; }
.sub-label { font-size: 13px; font-weight: 600; color: var(--it-text); margin-bottom: 10px; }
.inline-tip { font-size: 12px; color: var(--it-text-sub); margin-left: 8px; }
.theme-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.theme-chip {
  width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; color: #fff;
  border: 2px solid transparent; transition: transform 0.12s;
}
.theme-chip:hover { transform: scale(1.08); }
.theme-chip.active { border-color: var(--it-text); box-shadow: 0 0 0 2px var(--it-primary); }
.custom-label { font-size: 13px; color: var(--it-text-sub); }
.preview { margin-top: 18px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.preview .bar { display: inline-block; width: 60px; height: 8px; border-radius: 4px; background: var(--it-primary); margin-left: 8px; }
.entry-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.entry {
  display: flex; align-items: center; gap: 12px; padding: 14px;
  border: 1px solid var(--it-border); border-radius: 10px; cursor: pointer;
  background: var(--it-bg); transition: border-color 0.15s, transform 0.1s;
}
.entry:hover { border-color: var(--it-primary); transform: translateY(-2px); }
.entry .el-icon { font-size: 22px; color: var(--it-primary); }
.entry-title { font-weight: 600; }
.entry-sub { font-size: 12px; color: var(--it-text-sub); }

/* 巡检设置 */
.area-box { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }.area-add { display: flex; align-items: center; gap: 6px; }
.item-box { width: 100%; }
.cfg-item { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.cfg-item .el-input { flex: 1; max-width: 320px; }

/* 工单流转：流程示意 */
.flow-steps { margin-top: 16px; display: grid; gap: 8px; }
.fs-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--it-text); background: var(--it-bg); border-radius: 8px; padding: 9px 12px; }
.fs-n {
  width: 20px; height: 20px; border-radius: 50%; flex: 0 0 auto;
  background: var(--it-primary); color: #fff; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
</style>
