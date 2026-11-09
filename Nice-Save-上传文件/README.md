# 每日记账 · PWA

一个可以装到手机桌面的记账 App：手动记账、分类统计、月预算钱罐、月底结算，以及（可选的）扫小票自动拆账。

```
index.html             整个 App（界面 + 逻辑）
manifest.webmanifest   App 名字、图标、全屏显示
sw.js                  离线缓存，没网也能打开
icons/                 小猪图标
scan-worker/           扫小票服务（Cloudflare Worker），可选
```

数据只存在你的手机上，不会上传到任何地方。**记得定期在「预算」页底部点「导出备份」。**

---

## 第一步：发布 App（约 10 分钟，免费）

用 GitHub Pages 免费托管，网址是 `https://你的用户名.github.io/仓库名/`。

1. 去 [github.com](https://github.com) 注册账号（记住你的用户名）。
2. 右上角 **+** → **New repository**：
   - Repository name 填 `jizhang`（随意，英文）
   - 选 **Public**（免费账号的 Pages 需要公开仓库；仓库里没有任何密码和数据，公开没关系）
   - 点 **Create repository**
3. 在新仓库页面点 **uploading an existing file**，把这个文件夹里的**所有内容**（`index.html`、`manifest.webmanifest`、`sw.js`、`README.md`、`icons` 文件夹、`scan-worker` 文件夹）一起拖进去 → 点 **Commit changes**。
4. 仓库的 **Settings** → 左边 **Pages** → Source 选 **Deploy from a branch** → Branch 选 `main`、文件夹 `/ (root)` → **Save**。
5. 等 1–2 分钟，刷新这一页，顶部会出现网址：`https://你的用户名.github.io/jizhang/`。

### 装到手机桌面

- **iPhone**：用 **Safari** 打开上面的网址 → 点底部的分享按钮 → **添加到主屏幕**。
- **安卓**：用 **Chrome** 打开 → 会弹出「安装」提示；没有的话点右上角 ⋮ → **安装应用**。

之后从桌面的小猪图标打开，全屏显示，没网也能用。

> 第一次打开是空的。想先看看效果：「预算」页底部 → 「加载示例数据」（点两次确认）。正式开始记账前点「清空全部数据」。

---

## 第二步：开通扫小票（可选，约 15 分钟）

扫小票需要调用 Claude，所以要用你自己的 Anthropic API Key。为了不把 Key 放进手机网页里（别人能看到），中间加一个很小的服务：Cloudflare Worker（免费额度对个人用绰绰有余）。

**费用**：每张小票大约 **US$0.02–0.05**（几毛钱人民币），从你的 Anthropic 账户扣。建议在 Anthropic 后台设一个每月上限。

### 2.1 拿到 Anthropic API Key

1. 去 [console.anthropic.com](https://console.anthropic.com) 注册。
2. **Billing** → 充值（最低 5 美元）。可以在 **Limits** 里设每月花费上限，比如 5 美元。
3. **API Keys** → **Create Key** → 复制保存好（只显示一次）。

### 2.2 准备一个访问口令

随便想一串**长的**随机字符，比如用密码管理器生成 32 位。App 每次请求都会带上它，没有口令的人用不了你的服务。

### 2.3 改一个配置

在 GitHub 仓库里打开 `scan-worker/wrangler.toml` → 点铅笔图标编辑，把

```
ALLOWED_ORIGIN = "https://YOUR-GITHUB-NAME.github.io"
```

里的 `YOUR-GITHUB-NAME` 换成你的 GitHub 用户名（只写到 `.github.io`，**不要**加 `/jizhang`）→ **Commit changes**。

### 2.4 部署到 Cloudflare

1. 去 [dash.cloudflare.com](https://dash.cloudflare.com) 注册。
2. 左边 **Workers & Pages** → **Create** → **Import a repository** → 连接 GitHub，选你的 `jizhang` 仓库。
3. 设置里把 **Root directory**（根目录）改成 `scan-worker`，其他保持默认 → **Deploy**。
4. 部署完成后，进这个 Worker 的 **Settings** → **Variables and Secrets** → **Add**，类型选 **Secret**，添加两个：
   - `ANTHROPIC_API_KEY` = 2.1 拿到的 Key
   - `APP_TOKEN` = 2.2 的口令
5. 在 Worker 概览页找到它的网址，类似 `https://ledger-scan.xxxx.workers.dev`。

> 会用命令行的话也可以：进 `scan-worker` 文件夹，依次运行 `npm install`、`npx wrangler login`、`npx wrangler secret put ANTHROPIC_API_KEY`、`npx wrangler secret put APP_TOKEN`、`npx wrangler deploy`。

### 2.5 在 App 里填上

App →「预算」页 →「扫小票设置」→ 填 Worker 网址和访问口令 → **保存** → **测试连接**，显示「✓ 连接正常」就好了。

之后在「小票」页拍照或选一张截图，等 10–30 秒，确认一下分类就能保存。

**如果口令泄露了**：在 Cloudflare 里把 `APP_TOKEN` 改成新的，App 里也改成新的。

---

## 更新 App

在 GitHub 上直接编辑文件（或重新上传覆盖）。**每次改完，把 `sw.js` 第一行附近的 `VERSION` 改一下**（比如 `ledger-v1` → `ledger-v2`），手机才会拿到新版本。手机上把 App 关掉再打开两次即可更新。

## 数据安全

- 记录只存在这台手机的 App 里。删除 App、清理 Safari 网站数据、换手机都会丢失。
- 「预算」页底部 →「导出备份」会生成一个 `.json` 文件，iPhone 上可以存到「文件」或发给自己；换手机后用「从备份恢复」导回来。
- 超过 14 天没备份，「数据和备份」卡片会提醒你。

## 已知限制

- 不能在多台设备之间自动同步（需要的话以后可以接一个云数据库）。
- 分类目前写死在 `index.html` 的 `CATS` 里，还不能在界面里增删。
- 只有浅色模式。
