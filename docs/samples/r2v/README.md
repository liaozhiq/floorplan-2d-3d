# R2V 样本数据

来源：[art-programmer/FloorplanTransformation](https://github.com/art-programmer/FloorplanTransformation)
（Raster-to-Vector, ICCV 2017），路径 `data/floorplan_representation/`。

## ⚠️ 本目录不包含数据文件

这里**只保留说明文档**，不随仓库分发任何样本数据或转换结果。

原因：R2V 仓库的 **MIT 许可只覆盖代码**，标注数据派生自真实户型图纸，而
**图纸著作权在 LIFULL（原数据提供方）手里**，不在 R2V 作者手里。
在这个归属不清晰的部分上，本项目选择不分发。

需要样本时，按下面两步自己在本地生成（数据不会进 git —— `.gitignore` 已排除相关目录）。

## 自己生成

```powershell
# 1) 克隆 R2V 仓库（约 100 MB，只需 data/floorplan_representation/ 下的标注文本）
git clone --depth 1 https://github.com/art-programmer/FloorplanTransformation.git D:\hy\r2v

# 2) 单份转换（txt → layout JSON）
node tools/r2v-to-layout.mjs D:\hy\r2v\data\floorplan_representation\<某个>.txt --out=demo.json

# 或批量：按卧室数筛出 N 套
node tools/r2v-find.mjs D:\hy\r2v\data\floorplan_representation --beds=4 --convert=out\r2v-4br
```

## 标注格式（每行：`x0 y0 x1 y1 category d1 d2`）

| 类别 | 含义 | 几何 |
|---|---|---|
| `wall` | 墙 | 一条**中心线**（两个端点） |
| `door` | 门 | 一条线段，长度 = 门洞宽 |
| `bedroom` / `living_room` / `kitchen` … | 房间 | 房间内部的一个**种子矩形**，不是房间多边形 |
| `toilet` / `bathtub` / `sofa` … | 家具图标 | 图标包围盒 |

`d1 d2` 在原论文里是「墙两侧的房间 id」，部分文件的该字段为占位整数，转换时不使用。

## 这套数据的已知限制

| 限制 | 影响 |
|---|---|
| **没有窗** | 转换结果 `wins` 为空数组 |
| **没有尺度** | 只能按门宽先验推定，`estimated: true`，面积误差不可控 |
| **墙只有中心线** | 转换时按 200 mm 厚度对称膨胀，墙厚是假设值 |
| **房间只有种子点** | 多边形靠连通域恢复，L 形房间可能有锯齿 |

对比 CubiCasa5K（有真实尺度、有窗、有固定家具），R2V 现在只作为**备选路线**保留，
评估过程见 [../../r2v-数据评估.md](../../r2v-数据评估.md)。
