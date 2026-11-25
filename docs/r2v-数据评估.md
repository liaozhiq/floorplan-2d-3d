# R2V 数据可用性评估

> 结论：**能用，而且是目前三个候选数据源里最实用的一个**（MIT 许可、真矢量几何）。
> 但它给的**只有几何**，不给尺度、不给窗；且需要经过一次转换才能变成本项目能吃的 layout JSON。

相关文件：

- [samples/r2v/](samples/r2v/) —— 格式说明与自建样本的方法（**样本数据本身不随仓库分发**，原因见该文）
- [tools/r2v-to-layout.mjs](../tools/r2v-to-layout.mjs) —— 单文件转换器（也可作为模块 import）
- [tools/r2v-find.mjs](../tools/r2v-find.mjs) —— 批量转换 + 按卧室数筛选
- [tools/validate-layout.mjs](../tools/validate-layout.mjs) —— 校验器（`--polygons` 支持 L 形房间）
- [tools/render-layout.mjs](../tools/render-layout.mjs) —— 把 layout JSON 画成 PNG

---

## 1. 数据实况（已核实）

| 项 | 内容 |
|---|---|
| 仓库 | [art-programmer/FloorplanTransformation](https://github.com/art-programmer/FloorplanTransformation)（ICCV 2017） |
| 标注路径 | `data/floorplan_representation/00..ff/<hash>/<n>.txt` |
| 许可证 | **MIT**（Copyright © 2018 art-programmer）—— 可商用、可修改、可再分发，需保留声明 |
| 栅格图 | **拿不到**。README 明确：受 LIFULL 授权限制，只发布矢量标注 |
| 官方指标 | 论文自述 ~90% precision / recall |
| 额外资源 | README 另给一份「**10 万+** 算法生成的矢量表示」下载（Google Drive），不含人工标注 |

格式（每行 `x0 y0 x1 y1 category d1 d2`）：

| 类别 | 几何含义 |
|---|---|
| `wall` | 一条**中心线**（两端点），**在门处不断开** |
| `door` | 门洞线段（叠在连续墙上），长度 = 门洞宽 |
| `bedroom` / `living_room` / `kitchen` … | 房间内部的**种子矩形**，不是房间多边形 |
| `toilet` / `bathtub` / `sofa` … | 家具图标包围盒 |
| `PS` | 管道井（日式图纸常见） |

---

## 2. 五处硬伤与处理方式

| # | 硬伤 | 处理 |
|---|---|---|
| 1 | **坐标没有任何单位** | 用「单开门宽 800mm」先验反推：取门长的 **25 分位**（避开 1.5–3m 的宽洞口），`mmPerUnit = 800 / q25` |
| 2 | 墙是**中心线**，不是矩形 | 按墙厚膨胀成 1-unit 网格，再做「行内游程 + 跨行合并」得到互不重叠的矩形 |
| 3 | 墙在门处**连续**（门叠在墙上） | 房间分割用连续墙；输出墙体用**扣掉门洞**的副本 —— 否则门会被墙压住，且房间轮廓会漏 |
| 4 | 房间只是**种子点** | 对非墙格做 4 连通域，再把边界有向边串成环 → 正交多边形，可得到 L 形房间 |
| 5 | **完全没有窗** | 无解，只能后续人工补。输出的 `wins` 恒为空数组 |

补充：没有种子的**封闭**连通域会留白（平面图出现空洞）。转换器把这类区域保守保留为「未知空间」，标 `counted:false`，既不污染面积统计，也不让平面图破洞。接触画布边界的连通域视为「室外」，直接丢弃。

---

## 3. 实测结果（2 份真实样本）

| | plan-a | plan-b |
|---|---|---|
| 原始记录 | wall 15 / door 8 / seed 8 | wall 42 / door 16 / seed 11 |
| 推定比例 | 18.605 mm/unit | 30.769 mm/unit |
| 外包络 | 4688 × 11274 mm | 11477 × 7385 mm |
| 输出 | 墙 38 / 门 8 / 房间 8 | 墙 51 / 门 16 / 房间 10 |
| 卧室数 | 1 | 2 |
| 套内面积 | **37.14 m²** | **63.49 m²** |
| 校验 | 0 error / 0 warning | 0 error / 0 warning |

**尺度先验的合理性**：日本 1LDK 通常 35–45 m²、2LDK 通常 50–70 m²，推定值都落在区间内 —— 说明「门宽先验」这条路是成立的。但它只有 ±5~10% 精度，**面积不能当结算依据**。

渲染核对（本地验证，图片不随仓库分发）：墙体闭合、门洞落在墙上、房间分区正确，两份样本校验均为 0 error。

> ⚠️ 样本数据不在仓库里 —— R2V 的 MIT 只覆盖代码，标注派生自真实图纸，版权归属不清。
> 需要重跑请按 [samples/r2v/README.md](samples/r2v/README.md) 的两条命令在本地生成。

---

## 4. 怎么用

```bash
# 1) 单文件转换
node tools/r2v-to-layout.mjs plan.txt --out=plan.json

# 2) 校验（L 形房间必须加 --polygons）
node tools/validate-layout.mjs plan.json --polygons

# 3) 出图肉眼核对
node tools/render-layout.mjs plan.json --out=plan.png

# 4) 想要四室：先拿全量数据，再批量筛
git clone --depth 1 https://github.com/art-programmer/FloorplanTransformation r2v
node tools/r2v-find.mjs r2v/data/floorplan_representation --bedrooms=4 --convert=out/4br --top=10
```

`--bedrooms=4` 就是按「卧室种子数」筛四室。`--convert` 会把命中项写成 layout JSON，可直接进校验器和渲染器。

---

## 5. 与另外两个数据源对比

| | **R2V（本文件）** | CubiCasa5K | FloorPlanCAD |
|---|---|---|---|
| 许可证 | **MIT** ✅ 可商用 | CC BY-NC-SA 4.0 ❌ 非商用 | CC BY-NC 4.0，且不拥有图纸版权 ❌ |
| 几何格式 | 中心线 + 种子 + 图标（文本） | SVG 多边形（含墙/门/窗类别） | **真矢量 CAD/SVG** |
| 有窗 | ❌ | ✅ | ✅ |
| 有尺度 | ❌ | ❌ | 部分（CAD 单位） |
| 规模 | 数千（另有 10 万+ 生成版） | 5000 | 15663 |
| 体量 | 几十 MB | 5.5 GB | 数 GB |
| 结论 | **拿来练手/自用最合适** | 要窗就得选它，但只能非商用 | 版权风险最高 |

---

## 6. 还没解决 / 需要你确认

1. **本环境无法批量下载**：git 与 PowerShell 的 TLS 都被拦（`SEC_E_NO_CREDENTIALS`），只有网页抓取通道可用，所以我只验证了 2 个样本，**没能确认数据集中有多少四室户型**。`r2v-find.mjs` 就是为你在本地一次性回答这个问题准备的。
2. **窗**：R2V 没有窗标注。要么人工补，要么按「外墙 + 房间朝外」启发式生成（精度不可靠，建议人工点）。
3. **房型语义**：日式 `LDK`/`PS`/`盥洗室` 与中式「两厅两卫」不是一一对应。转换器给了中文映射表，但「两厅」在日式图纸里通常是 LDK 一体，不会单独出现"餐厅"。
4. **家具**：图标类别（`toilet`/`sofa`/`cooking_counter`…）与本项目 `LIB` 的 45 个 `type` 没有一一对应，暂未转换。
