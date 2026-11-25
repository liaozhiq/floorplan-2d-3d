# FloorPlanCAD 能不能补上"尺度"和"承重墙"？

> ## ✅ 结论：**不采用，本文仅作存档**
>
> 评估下来，FloorPlanCAD 对本项目**没有任何实际收益**：
>
> | 可能的价值 | 实际情况 |
> |---|---|
> | 毫米尺度 | 已由 CubiCasa 自带的 `DimensionMeasureLabel` 解决（10mm/单位），不再需要 |
> | 承重墙 | 30 类标注里没有结构/承重类，补不了 |
> | 家具（床/沙发/餐桌） | 有，但属于**别的公寓**，不能跨房源搬过来 |
> | 门窗细分 | 同样只描述它自己的图纸 |
> | 标注精度 | 镜像里是区域级掩码，当不了图元几何 |
> | 许可 | 官方 NC + 不拥有图纸版权 vs 镜像声称 CC-BY-SA，**两处矛盾** |
>
> 唯一的残余用途是"当作第二种户型来源"，但需要手动下大文件 + 重写 CAD 图元解析 + 承担许可风险，
> **不划算**。除非将来真的需要更多异国户型素材，否则不必再碰。
>
> 下面保留完整的验证过程，供以后复核这个判断。

**一句话：两个都补不上。**

- **承重墙**：类别表里根本没有这一类 —— 数据层面就没有，无法推导。
- **毫米尺度**：无法用现有可获取的数据**验证**，因此按原则不作为事实采用。

下面是证据。

---

## 一、承重墙：类别里不存在

从 HF 镜像 `Voxel51/FloorPlanCAD` 的 `samples.json` 里实测解析出 **31 个标签**（与官方"30 类"一致）：

```
stair, double_door, single_door, sliding_door, window, bay_window, blind_window,
opening_symbol, wall, railing, parking, elevator, escalator,
bed, bedside_cupboard, wardrobe, sofa, chair, table, tv_cabinet, half_height_cabinet,
high_cabinet, bath, bath_tub, sink, toilet, squat_toilet, urinal, washing_machine,
refrigerator, gas_stove
```

官方描述是「28 个 thing 类（可数实例：门窗、家具、家电、设备）+ 2 个 stuff 类（**wall**、parking）」。

**没有 structural / load-bearing / 承重墙 / 剪力墙 之类的类别**，墙体只有一个 `wall`。

→ 结论：FloorPlanCAD **不能**补承重墙，和我从 CubiCasa5K 得到的结论一样。

---

## 二、毫米尺度：文档声称有，但我无法验证

### 支持有尺度的一方

数据集卡片声称：

> Cropped into **20m × 20m** blocks, 50% retention rate, sensitive text removed

镜像里的 PNG 实测为 **1000 × 1000** px。若"每块 20m×20m"成立，则 **20 mm/px**，尺度就是有出处的（不再是先验假设）。

### 但实测核验失败

我用三类几何探针去反推 mm/px（门扇≈850mm、墙厚≈200mm）：

| 探针 | n | 中位像素 | 按常识反推 mm/px |
|---|---|---|---|
| 细长墙段短边（当墙厚） | 169 | 79.4 px | **2.52** |
| 窗短边（当墙厚） | 436 | 6.9 px | **28.99** |
| 单开门 bbox 平均边长（当门长） | 150 | 509.4 px | **1.67** |

三者差一个数量级，**不可能同时成立**。最可能的原因：镜像里的掩码是**区域级掩码**（单开门掩码 bbox 约 500×500 px ≈ 10m×10m，明显是房间/功能区级别），不是按图元给的几何量 —— 不能拿来测尺寸。

所以：**"20mm/px" 目前只是文档声称，无法用我能拿到的数据证实**。按"不能把未证实的东西当事实"的原则，**不采用**。

### 唯一可能证实的路径（还缺一样东西）

原始数据集给的是 **SVG（CAD 矢量）**。CAD 导出通常保留真实单位，如果 SVG 头部是

```xml
<svg width="20000" height="20000" viewBox="0 0 20000 20000">
```

那就等于明说"这张图 20m、坐标单位是 mm"，尺度立刻成为 A 档事实。

**但这需要一份原始 SVG**：

- 官方下载走 Google Drive（三个分享链接），需要浏览器手动下；
- HF 镜像 `Voxel51/FloorPlanCAD` **只镜像了 PNG + 检测掩码，没有 SVG**；
- 我这边无法下 Google Drive 大文件。

→ 只要给一份 `model.svg`（任意一套），我 1 分钟就能确认单位，并据此决定 FloorPlanCAD 能不能当"尺度来源"。

---

## 三、它真正能补的缺口：**家具**

这是 FloorPlanCAD 相对 CubiCasa5K 的真正优势 —— 它有大量**家具家电符号类**：

| 类别 | 可映射到项目 `LIB` 的类型 |
|---|---|
| `bed` / `bedside_cupboard` | `bed` / `nightstand` |
| `sofa` / `chair` / `table` | `sofa` / `chair` / `table` |
| `wardrobe` / `high_cabinet` / `tv_cabinet` | `wardrobe` / `cabinet` / `tvstand` |
| `bath_tub` / `toilet` / `sink` / `urinal` / `squat_toilet` | `bathtub` / `toilet` / `ksink` |
| `washing_machine` / `refrigerator` / `gas_stove` | `washer` / `fridge` / `stove` |
| `stair` / `elevator` / `escalator` / `parking` | 项目里没有对应 3D 模型 |
| `bay_window` / `blind_window` / `sliding_door` / `double_door` | 可以细化门窗类型 |

也就是说：**家具这个"缺失"项，理论上有数据可以补**。但需要做一张人工映射表（CAD 符号 → `LIB` 的 45 种 `type`），而且要先解决尺度问题才能真正摆到正确位置。

---

## 四、许可上还有一处冲突（需要留意）

| 来源 | 声明的许可 |
|---|---|
| 官方站点 | 注解 **CC BY-NC 4.0**，且**明确说不拥有图纸版权**（"We do not own the copyright of the drawings"） |
| HF 镜像卡 | `license: cc-by-sa-4.0` |

两处说法不一致。加上"不拥有图纸版权"这一条，**自用做技术验证可以，商用要非常谨慎**。

---

## 五、对当前项目的影响（不变）

> **后记**：这个"尺度"问题后来在不依赖 FloorPlanCAD 的情况下解决了 —— CubiCasa5K 的 SVG 里本来就印着房间真实尺寸
> （`DimensionMeasureLabel`），反解得到 **10 mm/单位**，313 套 / 706+ 标注实测，离群 0。
> 详见 [数据来源与可靠性.md](数据来源与可靠性.md) 的「A 档补充」。
> 所以 FloorPlanCAD 的"尺度"这一项**不需要了**；它唯一还剩的价值是**家具符号**。

| 缺口 | FloorPlanCAD 能补吗 |
|---|---|
| 承重墙 | ❌ 类别里没有 |
| 毫米尺度 | ❌ 无法验证（需原始 SVG 才能定论）—— **已用 CubiCasa 自带标注解决，不再需要** |
| 家具 | ⚠️ 有数据，但需人工映射表（尺度问题已不挡路了） |
| 门窗细分（飘窗/盲窗/推拉门/双开门） | ✅ 比 CubiCasa5K 更细 |

所以现在 CubiCasa5K 那套数据的标注是：尺度已确定（`estimated: false`）、承重墙缺失（`bearingAnnotated: false`）。
**承重墙这条警告要一直显示到有人提供结构图为止。**

---

## 六、自查命令

```powershell
# 重新拉一遍 FloorPlanCAD 的类别表（不下载整库）
node tools/fpcad-probe.mjs
```
