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

- 来源：[CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k)（SCIA 2019），样本 `high_quality_architectural/13451/model.svg`
- 数据集许可：**CC BY-NC-SA 4.0**（署名-非商业性使用-相同方式共享）
- 因此：**仅限个人非商业使用**，不得商用、不得移除署名；再分发需保持同协议
- 转换方式：`tools/cubicasa-to-layout.mjs`（尺度按单开门 800 mm 先验推定，9.830 mm/px）

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
