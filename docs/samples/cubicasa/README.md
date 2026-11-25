# CubiCasa5K 转换样本

这里的文件是**从 CubiCasa5K 数据集转换出来的派生数据**，用于在应用里预览效果。

| 文件 | 说明 |
|---|---|
| `cubi-13451.json` | 单层四室两厅两卫户型（15 间房、98 段墙、26 窗、11 门、**26 件固定家具**、套内 **117.69 m²**） |
| `cubi-13451-iso.png` | 该户型的等轴测 3D 预览 |

这份 JSON 由 `tools/cubicasa-to-layout.mjs` 的**当前版本**生成，特征：

- `estimated: false` —— 尺度来自本套 SVG 里 15 个房间尺寸标注实测（9.994 mm/单位，9.95–10.03）
- `bearingAnnotated: false` —— 数据集没有承重墙标注，需在应用里用「承重墙」工具（`B`）人工标
- `furniture.items` 有 26 件 —— 只含**固定家具**（衣柜/橱柜/水槽/马桶/淋浴/冰箱/洗衣机/烘干机），不含床/沙发/餐桌
- 墙体类型只有 `e`（外墙）和 `n`（内墙），不臆造 `b`（承重）

## 在应用里打开

```
index.html → 文件 ▾ → 导入户型 JSON → 选这个 cubi-13451.json → 按 T 进 3D
```

⚠️ 载入会**清空当前家具、测量线和拆改记录，并清空撤销栈**（换户型 = 换项目）。
想保留原三室户型的设计，先用「导出方案 JSON」备份；刷新页面即可恢复内置户型。

## 来源与许可

### 署名

- 原始数据集：**[CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k)** （CubiCasa，SCIA 2019）
- 原始文件：`cubicasa5k/high_quality_architectural/13451/model.svg`
- 数据集许可：**[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**（署名 — 非商业性使用 — 相同方式共享）

### 本目录文件的许可

`cubi-13451.json` 与 `cubi-13451-iso.png` 是对上述标注数据的**衍生作品**，同样按
**CC BY-NC-SA 4.0** 提供：

| 你可以 | 你必须 |
|---|---|
| 自由使用、修改、再分发（非商业） | 保留上方署名与原始链接 |
| 用于学习 / 研究 / 个人项目 | 标明做了哪些修改（见下） |
| — | 衍生作品沿用 CC BY-NC-SA 4.0 |

**不得**用于商业用途，**不得**移除署名，**不得**把衍生作品改授其它协议。

### 修改说明（CC BY-NC-SA 4.0 要求的 "indicate changes"）

本目录文件是**格式转换**的结果，由 `tools/cubicasa-to-layout.mjs` 生成，具体改动：

1. **尺度**：由 SVG 内嵌的房间尺寸标注（`DimensionMeasureLabel`）反解为 9.994 mm/单位，
   全图坐标按此缩放；原 SVG 无显式单位。
2. **墙体**：`Wall` / `Panel` / `Railing` 多边形 → 取值 0/90 的矩形段（200 mm 栅格），
   并区分外墙 / 内墙。
3. **门窗**：`Door` / `Window` / `Glass` 多边形 → 矩形洞口，归为门 / 推拉门 / 窗三类。
4. **房间**：保留 `Space` 多边形的**几何与拓扑不变**，仅翻译房间名。
5. **家具**：`FixedFurniture` 标注 → 家具条目，位置与尺寸取自原标注（坐标按祖先 transform 复合）。
6. **新增的推导内容**：分段尺寸链、外墙/内墙标记 —— 这两项原数据中**没有**，属本项目几何推导。

**未做**：没有增删房间、没有移动墙体、没有添加原数据中不存在的信息（如承重墙、活动家具）。

### 原始数据怎么来的

```powershell
node tools/remote-unzip.mjs "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1" `
  .cache/cubicasa5k --match='model\.svg$' --skip-existing
node tools/cubicasa-to-layout.mjs .cache/cubicasa5k/cubicasa5k/high_quality_architectural/13451 `
  --out=docs/samples/cubicasa/cubi-13451.json
```

## 转换时的已知处理

| 情况 | 处理 |
|---|---|
| 多层住宅 | SVG 里用 `<g id="Floor-N">` 分组，只取房间最多的一层（本例是单层 `Floor-1`） |
| 墙不止叫 `Wall` | `Panel`（墙板）、`Railing`（栏杆）也算墙体 |
| 采光面不止叫 `Window` | `Glass` 也算窗 |
| 斜墙上的门 | 包围盒收窄到 300 mm，避免压住相邻阶梯墙体 |
| 标注本身重叠 / 开放通道 | 校验时用 `--open-edges=warn --overlaps=warn` 降级（18 段开放通道共 34.7 m） |

校验结果：**0 error**。

```bash
node tools/validate-layout.mjs docs/samples/cubicasa/cubi-13451.json --polygons --open-edges=warn --overlaps=warn
node tools/render-layout.mjs  docs/samples/cubicasa/cubi-13451.json --out=x.png --iso
```
