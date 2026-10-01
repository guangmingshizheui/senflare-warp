# SENFLARE WARP 项目完整分析

> 面板：`Senflare Warp/` —— `_worker.js`（单文件后端，跑在 Cloudflare Worker + D1 上）+ `js/admin.js` / `js/admin-ui.js`（管理面板前端）
> 定位：**WARP MASQUE 账号注册 + 订阅生成 + 在线优选** —— 注册 MASQUE 账号入库，按端点生成三格式订阅，用完即走。

---

## 一、项目是什么

官方 WARP 客户端**不允许选端点**，而连哪个端点直接决定隧道质量。面板做的事：

1. **一键注册 MASQUE 账号**（`POST /reg` → ECDSA P-256 → `PATCH` 切 `tunnel_type: masque`），私钥 / 端点公钥 / 双栈端点 / 端口全部入库 D1 `warpAccounts` 表
2. **生成三格式订阅**：`masque://` 链接（b64 / Shadowrocket）、mihomo Clash YAML、sing-box JSON，节点走 `network: h2/h3`
3. **在线优选测速**：网段表达式展开 + 延迟探测，挑最快的回填 `LocalIP`，订阅自动采用优选端点

**关键特性**：单文件后端（`_worker.js`）、零服务器（Cloudflare Worker + D1）、`SubKey` 订阅鉴权、账号与配置全在面板里管。

---

## 二、支持的传输（3 种形态，`MasqueTransport`）

| 形态 | network | 说明 |
|---|---|---|
| `h2`（默认） | MASQUE over TCP+TLS/HTTP2 | 同一隧道走 TCP，外部看就是普通 HTTPS，整段可优选。**过滤网络首选** |
| `h3` | MASQUE over QUIC (UDP) | 白名单地址 only（v4 仅 198.1/.2，v6 仅 103/104 的 ::1/::2），不可优选 |
| `both` | H2+H3 双形态 | 每个端点各出一对节点 |

---

## 三、优选 IP 段（核心数据）

### 3.1 MASQUE-H2（TCP）优选网段

面板「网段优选」直接粘贴（`stParseSubnet` 展开：每段随机 randomCount 个 IP）：

```text
162.159.*.0/24 # 192,197,198,199,239 # MASQUE-TCP   // 整个 /24（5 个第三段）
2606:4700:103::/48, 2606:4700:104::/48              // 完整 /48，这是 h2 的
```

- **v4**：`162.159.*.0/24` 网段表达式，第三段取 192 / 197 / 198 / 199 / 239（5 个 /24，约 1270 个候选），备注 `MASQUE-TCP`（进节点名）。
- **v6**：`2606:4700:103::/48` + `2606:4700:104::/48` 两个完整 /48；v6 端点走「自定义」直接填地址测速（网段优选仅支持 IPv4，见 [admin.js](Senflare%20Warp/js/admin.js) 注释）。
- **QUIC 只有 6 个白名单地址**（实测：198.1/.2 + 103::1/::2 + 104::1/::2）：`engage.cloudflareclient.com` 解析出的 IP 若不在其中，QUIC 握手被拒——之前没走 h2 的节点不通，根因在此。**H2 走 TCP 整段应答，不受此限制。**

### 3.2 端口与端点来源

- **端口**（API 按账号下发但全球统一）：`443 / 500 / 1701 / 4500 / 4443 / 8443 / 8095`；首端口为常用端口，余为备用端口
- **端口模式**（`MasquePortMode`）：`fixed`（常用端口）/ `random`（常用+备用全出）/ `custom`（自定义端口列表）
- **端点来源**（`MasqueIPMode`）：`CUSTOM`（`MasqueIP` 手填）/ `LOCAL`（在线优选回填的 `LocalIP`）/ `ACCOUNT`（账号自带端点）
- **端点模式**（`MasqueEndpointMode`）：`all`（v4+v6 全出）/ `v4` / `v6`

---

## 四、MASQUE 建连参数（MASQUE 配置卡片）

MASQUE 没有混淆参数，TLS 握手时外部可见的主机名就是 **SNI**——端点不校验 SNI（对端由公钥钉死），所以填 DPI 放行的就行：

| 参数 | 配置项 | 默认 |
|---|---|---|
| SNI 伪装域名 | `MasqueSni` | `www.apple.com`（下拉可换） |
| 拥塞控制 | `MasqueCc` | `bbr`（可选 cubic / reno） |
| UDP 转发 | `MasqueUdp` | 开 |
| DNS 列表 | `MasqueDns` | `1.1.1.1, 8.8.8.8, 2606:4700:4700::1111, 2001:4860:4860::8888` |
| MTU | 写死 | `1280` |

**注意**：SNI 在 QUIC 和 TCP 两种传输间**不通用**——QUIC 能过的 TCP 未必能过，反之亦然（切 `both` 时以实测为准）。

---

## 五、注册流程（面板 `registerWarpAccount()`）

面板 `_worker.js` 的 `registerWarpAccount()`（JS，跑在 Cloudflare Worker 上）三步完成 MASQUE 账号注册：

| 步骤 | 内容 |
|---|---|
| API | `https://api.cloudflareclient.com/v0a4471/reg` |
| UA | `WARP for Android` + `CF-Client-Version: a-6.35-4471` |
| 第一步 | `POST /reg` 伪装 WireGuard 注册（curve25519 占位 key，API 只查形状）|
| 第二步 | `crypto.subtle` 生成 ECDSA P-256 密钥对（私钥转 DER-base64 入库） |
| 第三步 | `PATCH /reg/{id}` 换 ECDSA 公钥 + `tunnel_type: masque` |
| 应答 | 拿 `config.peers[0].public_key`（端点公钥 PEM，订阅输出时剥头尾取单行 base64）+ `endpoint.ports`（首端口为常用、余为备用） |
| 入库 | `id / token / license / 私钥 / 端点公钥 / v4 / v6 / 常用端口 / 备用端口` 存 D1 `warpAccounts` 表 |

**注意**：`token` 是后续 PATCH/检测凭证，`license` 是账号凭证——下载 JSON 与导入都已携带，整表重写不丢（见 admin-ui.js 导入/导出映射）。

---

## 六、在线优选（测速与回填）

| 机制 | 说明 |
|---|---|
| **网段展开** | `stParseSubnet`：`a.b.*.0/24 # 第三段范围 # 备注`，仅 IPv4，每段随机 randomCount 个 IP；范围字段写了但全无效则整行丢弃，不盲扫 |
| **三来源汇总** | 网段展开 / 直链抓取 / 逐行解析，去重后超上限截断；IPv6 端点走「自定义」直填 |
| **延迟探测** | 逐个端点 `fetch` 打点（超时熔断），按延迟排序 |
| **回填** | 最优端点写入 `LocalIP`，`MasqueIPMode=LOCAL` 时订阅自动采用 |
| **节点抖动** | 同一 /24 不同地址落地可能不同，按单端点实测延迟排，不按子网推断 |

---

## 七、订阅生成（三格式，`network: h2/h3`）

| 格式 | 生成 | 要点 |
|---|---|---|
| `masque://` 链接 | `buildMasqueLinks` | `publicKey` 取单行 base64（`pubKeyBody` 剥 PEM 头尾）+ `privateKey` + `ip`；b64 / Shadowrocket 通用 |
| mihomo YAML | `buildMasqueClash` | 纯 `proxies` 段 + `SubConfig` 远端 ACL4SSR 规则叠加（剥掉其自带 proxies）；`proxy-groups` 引用节点名**带引号**；自带 DNS（fake-ip）与标准头 |
| sing-box JSON | `buildMasqueSingbox` | `outbounds` 数组，`tag` 即节点名 |

**节点命名**（`nodeName`，全局唯一、无重名）：有备注用 `备注 | 序号`，无备注用 `订阅名 | 传输 | 序号`（序号全局递增，两位补零，如 `Senflare Warp | H2 | 01`）。

**订阅鉴权**：`SubPath`（默认 `/links`）+ `SubKey`（默认 `SenflareWarp`，部署后务必改随机强值）。

---

## 八、账号管理（D1 + 面板）

- **表**：D1 `warpAccounts`（`id / name / token / license / endpointPubKey / privateKey / endpointV4 / endpointV6 / endpointPort / backupPorts / createdAt / status`）
- **注册**：面板一键调后端注册，入库即进列表
- **导入**：兼容 PascalCase / snake_case 两种 JSON；`License` / `Token` 有才写入（旧文件无此字段不覆盖已有值）
- **导出**：下载 JSON 含 `License` + `Token`，删号 / 换环境重导不丢
- **卡片 / 编辑**：卡片显示 License 行；编辑弹窗 License / Token 只读展示（点击选中复制，保存不覆盖）

---

## 九、一句话总结

MASQUE-QUIC 只有 6 个固定地址（之前不通的根因），而 **MASQUE-H2 (TCP) 整段应答——Senflare 优选网段为 `162.159.*.0/24` 第三段 192/197/198/199/239（5 个 /24）+ v6 的 103/104 完整 /48**——面板"在线优选 + 订阅生成（`network: h2`）"就建在这上面：注册拿密钥、优选挑端点、三格式订阅一次出。
