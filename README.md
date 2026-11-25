# 户型装修设计

中文 | [English](README.en.md)

纯前端的户型装修设计工具：在 2D 平面图上摆放家具、拆改墙体、测量尺寸，一键切换到 Three.js 3D 场景，可以鸟瞰，也可以第一人称漫游。整个应用就是一个 `index.html`，无需构建，打开即用。

## 数据来源与许可

> **一句话**：项目代码是 MIT，可自由使用；但**户型数据来自第三方数据集，受非商业许可约束** —— 请勿商用，也建议保持仓库私有。

| 内容 | 来源 | 许可 | 说明 |
|---|---|---|---|
| 应用代码（`index.html` / `tools/` / `docs/`） | 本项目 | **MIT** | 自由使用、修改、再分发 |
| 内置示例户型（三室两厅两卫） | 本项目手写 | MIT | 46 件家具、承重墙标注均为人工录入 |
| `layouts/` 户型库（172–660 套） | 由 [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k) 转换 | **CC BY-NC-SA 4.0** | 仅非商业用途；需署名；再分发需同协议 |
| `docs/samples/cubicasa/*` | 同上（单套样本） | CC BY-NC-SA 4.0 | 同上 |
| `docs/samples/r2v/*` | [R2V（ICCV 2017）](https://github.com/art-programmer/FloorplanTransformation) | 代码 MIT；**原图版权归原作者** | 仅作格式示例 |
| `.cache/cubicasa5k/`（5000 套原始标注，360 MB） | CubiCasa5K | CC BY-NC-SA 4.0 | **不进仓库**（`.gitignore` 已排除） |
| `layouts*/`（生成物，约 32 MB） | 本项目转换产物 | 随上游数据集 | **不进仓库**，可由命令重建 |

### 这意味着

- **个人自用 / 学习 / 研究**：允许，这正是数据集许可涵盖的范围。
- **商业使用**：需自行向 CubiCasa5K 与图纸著作权人取得授权，本项目**不提供任何转授权**。
- **公开仓库**：把 `docs/samples/` 或 `layouts/` 推到公开仓库等于再分发 CC BY-NC-SA 内容，必须保留署名与同协议 —— 建议保持**私有**。
- 本项目**不拥有**任何第三方户型图纸的著作权，只做格式转换与可视化。

### 重建数据

```powershell
# 1. 取原始标注（只下 model.svg，约 42 MiB）
node tools/remote-unzip.mjs "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1" `
  .cache/cubicasa5k --match='model\.svg$' --skip-existing

# 2. 生成户型库（含缩略图与示意家具）
node tools/layouts-build.mjs 4 --clean --suggest
```

细节见 [cubicasa5k-数据集说明](docs/cubicasa5k-数据集说明.md) 与 [数据来源与可靠性](docs/数据来源与可靠性.md)。

## 功能

**2D 平面布置**
- 按原始户型 1:60 / 1:100 比例显示，尺寸单位 mm
- 从左侧家具库拖入 60 余种家具家电（卧室、客厅、餐厨、卫浴、家电、书房休闲）
- 拖动移动、旋转（Shift 自由角度）、调整尺寸，贴墙自动吸附
- 测量工具（靠近墙面自动吸附，Shift 锁定水平 / 垂直）
- 拆改非承重墙，承重墙单独标示；数据源没有承重墙标注时，可用「承重墙」工具（`B`）人工标记，标记会随方案保存
- 图层开关：尺寸标注、房间名、家具、网格、承重墙

**3D 场景**
- 鸟瞰、斜视、俯视多种视角，点击房间列表可飞到对应房间
- 漫游模式：桌面端 WASD + 鼠标，触屏设备用虚拟摇杆，可以点门开关
- 全高墙 / 剖切墙切换，日照时间滑块，夜景灯光
- 精细家具模型：柜门分缝与拉手、软包床头、带环境反射的金属与陶瓷材质等
- 在 3D 中也能选中、拖动家具，与 2D 方案实时同步

**方案与统计**
- 房间面积与套内使用面积自动统计
- 为每个房间更换地面材料（木地板、地砖、大理石、水磨石、地毯等），按面积加 5% 损耗估算造价
- 撤销 / 重做，方案自动保存在浏览器本地
- 中文 / English 界面切换（顶栏右侧按钮，默认中文，选择会记住）
- 导出 PNG 图片，导出 / 导入方案 JSON

## 快速开始

```bash
git clone <仓库地址>
cd <仓库目录>
```

然后直接用浏览器打开 `index.html`。也可以起一个本地静态服务器：

```bash
python3 -m http.server 8000
# 访问 http://localhost:8000
```

> Three.js 通过 jsDelivr CDN 加载，首次打开 3D 场景需要联网。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `T` | 切换 2D / 3D |
| `V` / `M` / `X` / `B` | 选择 / 测量 / 拆改墙体 / 标记承重墙 |
| `R` / `Shift+R` | 选中家具顺时针 / 逆时针旋转 90° |
| `Delete` / `Backspace` | 删除选中家具 |
| `Ctrl/⌘ + D` | 复制选中家具 |
| `Ctrl/⌘ + Z`，`Ctrl/⌘ + Shift + Z` | 撤销，重做 |
| `F` | 适应窗口 |
| `+` / `-` | 放大 / 缩小 |
| `[` / `]` | 展开 / 收起左侧家具库、右侧面板 |
| `Shift + F` | 全屏 |
| `Esc` | 取消当前操作 |
| 漫游：`WASD` / 方向键，`Shift`，`E` | 移动，快走，开关门 |

## 技术栈

- 原生 HTML / CSS / JavaScript，无框架、无构建步骤
- 2D 平面图用 SVG 绘制
- 3D 场景用 [Three.js](https://threejs.org/) r160（OrbitControls、PointerLockControls、RoundedBoxGeometry、RoomEnvironment、CSS2DRenderer）
- 数据保存在 `localStorage`

## 自定义户型

户型数据写在 `index.html` 里：

- `ROOMS`：房间多边形、名称、默认地面材料
- `WALLS` / `WINS`：墙体与窗洞
- `MATS`：地面材料名称与单价
- `LIB`：家具库（类型、名称、默认尺寸、颜色）
- `buildFurniture()`：各类家具的 3D 模型

改这些数据就能换成自己的户型。

## 文档

- **[文档索引](docs/README.md)** —— 所有说明文档的总目录，不知道看哪篇就从这里进
- [数据来源与可靠性](docs/数据来源与可靠性.md) —— **哪些是原始标注、哪些是推算、哪些是缺失**（推荐先看）
- [cubicasa5k-数据集说明](docs/cubicasa5k-数据集说明.md) —— 数据集磁盘结构、获取命令、校验、能不能删
- [户型库-按需生成](docs/户型库-按需生成.md) —— **启动说明在这里**：怎么起本地服务器、按几室生成户型库
- [源码导读](docs/源码导读.md) —— 代码结构、数据流、相机与渲染管线、82 项函数索引
- [layout-spec](docs/layout-spec.md) —— 户型 JSON 的字段说明与填写流程
- [底图与定标](docs/底图与定标.md) —— 把户型图照片垫在平面图下并标定真实比例
- [r2v-数据评估](docs/r2v-数据评估.md) —— ICCV 2017 R2V 数据集的可用性评估
- [floorplancad评估](docs/floorplancad评估.md) —— FloorPlanCAD 能否补上"尺度 / 承重墙"（结论：**不采用**，仅存档）

## 社交媒体

- X（Twitter）：[@akokoi1](https://x.com/akokoi1)

## 许可协议

- **代码**：[MIT](LICENSE)
- **户型数据**：CC BY-NC-SA 4.0（非商业），详见上方 [数据来源与许可](#数据来源与许可)
