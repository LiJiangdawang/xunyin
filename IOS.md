# 寻音 iOS 版：怎么变成你手机上的 App

## 先说清楚一件事

**IPA 只能在 macOS 上编译。** 这不是我偷懒——

IPA 里面的可执行文件是 arm64 的 Mach-O 二进制，必须用 Apple 的 `clang` + iOS SDK + `xcodebuild` 编译，签名还要 `codesign`。
这些工具**只有 macOS 上有**，苹果没有发布 Windows 版，也没有合法的第三方移植。

我这台机器是纯 Windows，`xcodebuild`、`clang`、`codesign`、`ldid` 全都没有。所以我给不了你一个"我这边直接编译好"的 IPA —— 硬编出来的也不是真能跑的东西。

**但 iOS 工程我已经完整搭好了**，你有两条路把它变成手机上的 App。

---

## 路线 A：立刻能用（30 秒，推荐先试这个）

这条不需要 IPA，不需要签名，不会 7 天过期。

1. 把 `www/` 目录拖到 <https://app.netlify.com/drop>（或任何 HTTPS 静态托管）
2. 拿到形如 `https://xxx.netlify.app` 的网址
3. iPhone 用 **Safari** 打开它
4. 点底部 **分享** → **添加到主屏幕**

桌面上就会出现「寻音」图标，点开是**全屏无地址栏**的，和装了 App 一模一样：

- 有图标、有自己的启动画面
- 离线能用（Service Worker 缓存了整个界面）
- 下载的歌存在手机本地，飞行模式照样听
- 不占签名名额，不会 7 天失效

> 这条已经全部做好了：`manifest.webmanifest`、`sw.js`、192/512 图标、启动页都在。

---

## 路线 B：要真 IPA → 用 GitHub 免费编译

工程已经写好，包括 CI 流水线。

### 步骤

1. 把整个项目文件夹推到你的 GitHub 仓库（公开仓库，免费）
2. 打开仓库的 **Actions** 页面
3. 左侧选 **构建寻音 iOS IPA** → 右侧 **Run workflow**
4. 等 8~15 分钟
5. 在该次运行页面底部下载 `xunyin-ios-ipa.zip`，解压得到 **`xunyin-unsigned.ipa`**（未签名）

### 然后用 NB助手装

1. 把 `xunyin-unsigned.ipa` 传到 iPhone（微信/QQ 发给自己，或用「文件」App）
2. 在「文件」里长按这个 ipa → **分享** → 选 **NB助手**
3. NB助手右上角 **+** → **导入 Apple ID**（你自己的 Apple ID，免费账号就行）
4. 回到 ipa 列表，点它 → **签名安装** → 选刚导入的证书
5. 装完在「设置 → 通用 → VPN与设备管理」里信任一下开发者

### 必须知道的限制

| 事项 | 说明 |
|---|---|
| 有效期 | 免费 Apple ID 签名的 App **7 天过期**，到期要在 NB助手重新签名一次 |
| 数量 | 一个免费 Apple ID 同时最多 3 个自签 App |
| 掉签 | 换个 Apple ID 签名 = 数据不通用（Bundle ID 相同才通用） |
| 数据 | 自签 App 卸载会清数据，签名续期（覆盖安装）不会 |

**7 天这个限制是苹果的规则，任何侧载工具（NB助手、爱思、AltStore）都绕不过去。** 想永久签名只能买开发者证书（99 美元/年）或企业证书。

---

## 工程里已经改好的东西

| 项目 | 值 |
|---|---|
| 显示名称 | 寻音 |
| Bundle ID | `com.xunyin.music` |
| 版本 | 1.3.0 |
| 最低系统 | iOS 14.0 |
| 图标 | 1024×1024 耳机图，无 alpha（符合 App Store 要求） |
| 启动图 | 深色底 + 居中图标，2732×2732 三份 |
| 横竖屏 | 仅竖屏（和 Android 一致） |
| 后台播放 | 已开启 `UIBackgroundModes: audio` |
| 网络 | 已允许 HTTP 明文（本地音源接口需要） |
| 安全区 | 已开启 `contentInset: always`（刘海屏适配） |

## 目录结构

```
ios/
├─ App/
│  ├─ App.xcodeproj/          Xcode 工程（可直接用 Xcode 打开）
│  ├─ App/
│  │  ├─ AppDelegate.swift
│  │  ├─ Info.plist
│  │  ├─ Assets.xcassets/     图标 + 启动图
│  │  └─ public/              网页资源（由 npx cap sync 同步）
│  ├─ App.xcworkspace/        CocoaPods 工作区
│  └─ Podfile
└─ capacitor-cordova-ios-plugins/
```

## 如果你有 Mac

```bash
npm install
npx cap sync ios
cd ios/App && pod install
npx cap open ios        # 用 Xcode 打开，选自己手机运行即可
```

在 Xcode 里填上你的开发者账号，连上 iPhone 就能真机跑。

---

## 常见问题

**Q：CI 里 `pod install` 失败怎么办？**
删掉 `ios/App/Podfile.lock` 再跑一次；或者把 workflow 里 `pod install --repo-update` 改成 `pod install`。

**Q：编译报 `Signing for "App" requires a development team`？**
workflow 里已经带了 `CODE_SIGNING_ALLOWED=NO`，正常不会报。如果报，说明 Xcode 版本差异，在命令后面再加 `PROVISIONING_PROFILE_SPECIFIER=""`。

**Q：NB助手签名时提示"证书无效"？**
换一个 Apple ID。新注册的免费账号有时要等一两小时才能签名。

**Q：装好后打开白屏？**
检查 iOS 14 以下是否用了新版 WebView 特性。工程最低设的是 iOS 14，更老的系统没测过。
