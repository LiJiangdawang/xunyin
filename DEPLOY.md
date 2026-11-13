# 公网访问 & 变现：能做什么、做不到什么

先把结论摆出来，别绕弯子。

| 你的目标 | 能不能做 | 代价 | 备注 |
|---|---|---|---|
| 不在家也能打开 | **能** | 免费 | 三条路见下，都不用改代码 |
| 电脑关机也能打开 | **能** | 免费 | 必须放云端托管，不能靠自家电脑 |
| 挂广告赚钱 | **技术上能，实际上很难赚到** | 免费 | 审核过不了 / 流量太小，见第五节 |
| 1 元永久使用权 | **能，但拦不住懂技术的人** | 需要收款渠道 | 见第六节 |

---

## 一、三条路，按"省事程度"排序

### 路线 A：Netlify Drop —— 最快的，5 分钟，不用注册命令行

1. 打开 <https://app.netlify.com/drop>
2. 把 `F:\Deepseak\whalemusic\www` **整个文件夹**拖进去
3. 等十几秒，它会给你一个网址，类似 `https://xxx-yyy-123.netlify.app`

这个网址就是公网地址，自带 HTTPS、自带 CDN，**手机在任何网络下都能打开**，也能"添加到主屏幕"变成 App 图标。

更新版本：再拖一次，或者用 Netlify CLI。

> 免费额度：100GB 流量/月、300 分钟构建。这个 App 全部静态文件加起来 300KB 左右，一个用户打开一次约耗 0.3MB，100GB ≈ 33 万次访问，用不完。

### 路线 B：Vercel —— 适合想绑自己域名的

仓库根目录已经放好了 `vercel.json`，直接：

```bash
npm i -g vercel
cd F:\Deepseak\whalemusic
vercel --prod
```

或者把仓库推到 GitHub，在 <https://vercel.com/new> 里导入，Framework 选 **Other**，Output Directory 填 `www`，一键部署。

### 路线 C：Cloudflare Tunnel —— 用自己电脑当服务器，但**电脑必须开着**

适合你想让域名指向家里这台机器、并且不介意它一直开机：

```bash
# 1. 装 cloudflared（Windows 直接下 exe）
# 2. 临时公网地址（关掉就失效，适合试水）
cloudflared tunnel --url http://127.0.0.1:8899

# 3. 固定域名（需要自己的域名托管在 Cloudflare）
cloudflared tunnel login
cloudflared tunnel create whale
cloudflared tunnel route dns whale music.你的域名.com
cloudflared tunnel run --url http://127.0.0.1:8899 whale
```

好处：不用部署，改完代码刷新就生效。
坏处：**电脑关机 = 网站下线**，家庭宽带上传带宽也有限。

---

## 二、国内访问的实话

上面三条路都是国外服务，**在国内访问速度和稳定性都不保证**：

- Netlify / Vercel 的域名在国内时通时不通，电信/联通/移动表现还不一样
- Cloudflare 的 `*.pages.dev`、`*.workers.dev` 有被墙记录；走自己域名 + CF 代理通常能通，但速度一般

想稳定，只有两条：

1. **买国内云服务器 + 域名 + ICP 备案**（阿里云/腾讯云轻量，几十到一百多一年，备案要 1~3 周）
2. 继续用国外免费托管，接受"有时候要刷两次才打开"

**但注意**：这个 App 的前端是纯静态的，真正吃带宽的是音乐文件，而那些文件走的是音源 CDN，**不经过你的服务器**。所以哪怕用最便宜的 1 核 1G 服务器，也完全扛得住。

---

## 三、部署后要改的一个地方（可选）

`www/sw.js` 里的 Service Worker 缓存会让老用户短时间内还看到旧版本。
每次发新版，把文件第一行的缓存名改一下就能强制更新：

```js
const CACHE = 'whale-shell-v2';   // v1 → v2
```

---

## 四、要不要给 APK 也换个思路

如果你打算长期运营，**Android 直接用 APK 分发比网页版体验好**（能后台播放、能离线打开、没有浏览器地址栏）。

但 APK 有个硬门槛：**上不了应用商店**（应用宝/华为/小米都要软著 + 备案，且这类音乐聚合应用基本过不了审）。
所以只能在自己网站上放个下载链接，靠用户自己装 —— 这条路能走，但拿不到商店的自然流量。

---

## 五、广告：技术上十分钟能加上，收益上基本别抱期待

### 先说残酷的部分

1. **Google AdSense 审核大概率不通过**。它对"聚合第三方版权内容"的站点非常敏感，音乐播放器 + 无原创内容，拒信模板都差不多。
2. **国内广告联盟（百度联盟等）要 ICP 备案 + 流量门槛**，个人小站进不去。
3. **收益量级**：假设日活 200 人、人均 3 次访问 = 600 PV，国内流量 eCPM 大概 1~3 元/千次展示，**一天 1~2 块钱**。而且广告会明显破坏你现在这套 UI 的质感。

### 如果还是要加，最省事的接法

`www/index.html` 里，在 `<div id="mini"></div>` 前面插一个广告位：

```html
<div id="ad-slot" style="display:none;position:absolute;left:10px;right:10px;
     bottom:calc(var(--tabbar-h) + var(--safe-b) + 70px);height:60px;
     border-radius:14px;overflow:hidden;z-index:44;background:#171c27"></div>
```

然后在 `www/js/app.js` 的 `App.init()` 末尾加：

```js
/* 广告位：只在配置了代码时显示 */
const adCode = Storage.get('adCode', '');
if (adCode) {
  const slot = $('#ad-slot');
  slot.style.display = 'block';
  slot.innerHTML = adCode;                       // 粘贴联盟给你的 <script>/<ins>
  slot.querySelectorAll('script').forEach(old => {
    const s = document.createElement('script');
    [...old.attributes].forEach(a => s.setAttribute(a.name, a.value));
    s.textContent = old.textContent;
    old.replaceWith(s);
  });
}
```

再在「我 → 关于」里加个小开关，用 `Storage.set('adCode', '...')` 存你自己的广告代码，就能随时开关，不用改代码。

**注意**：AdSense 的自动广告（Auto ads）只要你在 `<head>` 里放那段 `adsbygoogle.js`，它会自己找位置插，不需要上面这些。但审核不过的话，这段脚本是白放的。

---

## 六、1 元永久使用权：能做，但要接受三个现实

### 现实 1：前端校验拦不住任何人

这个 App 是纯前端，所有校验逻辑都在用户浏览器里。
按 F12 打开控制台，`localStorage.setItem('whale:license','任意值')` 就解锁了。
**任何"纯前端收费"都只是防君子不防小人**，这不是实现问题，是架构决定的。

### 现实 2：1 块钱收不上来

- 微信支付/支付宝的**个人收款码不能自动发货**，你得手动一个个发码
- 想自动化，必须接商户号（需要营业执照）或第三方平台
- 靠谱的替代：**爱发电 / 面包多 / Lemon Squeezy / Gumroad**，它们支持"付款后自动发放兑换码"，你只需要在自己的页面上做"输入兑换码解锁"

### 现实 3：1 元的定价基本等于白送

扣除平台手续费（通常 5%~10% + 固定费），1 元到手几毛。除非走量（几千单），否则不如直接做"捐赠"。

### 技术上怎么实现（如果你还是要做）

**第一步：生成兑换码**（`tools/gen-license.js`，我还没创建，需要的话说一声）

思路是用一个只有你知道的密钥做 HMAC：

```js
const crypto = require('crypto');
const SECRET = '你的随机长密钥-不要写进前端';
const code = 'WHALE' + crypto.createHmac('sha256', SECRET).update('v1').digest('hex').slice(0, 12).toUpperCase();
```

**第二步：前端校验**（同样的问题：密钥在前端就等于公开，所以只能用"非对称"或"服务端校验"才安全；纯前端只能用哈希比对，能被绕过）

**第三步：拦截入口** —— 在 `app.js` 里判断未解锁时降低体验（比如限制同时下载数量、隐藏无损选项），而不是完全锁死。这样即使被绕过，损失也可控。

### 我的建议

把这个 App 当**作品 / 个人工具**，收益走这两条更现实的路：

1. **打赏/赞助**：页面上放个"请我喝咖啡"，用爱发电或微信赞赏码。零技术成本，愿意给的人会给。
2. **卖"打包服务"**：帮别人定制一套（换皮、换音源、出 APK），一单 50~200 元，比 1 元 × 几千单现实得多。
3. 真要做订阅制，那就得把这套东西搬到有后端的产品形态（用户体系、授权校验、防盗链），成本和复杂度是另一个量级。

---

## 七、下一步

- 只想自己用/给朋友用 → 走**路线 A（Netlify Drop）**，5 分钟搞定，别再折腾
- 想长期挂个域名 → **路线 B + 买个域名**，注意国内访问情况
- 想靠它赚钱 → 先想清楚第五节和第六节那几条，再决定要不要投入
