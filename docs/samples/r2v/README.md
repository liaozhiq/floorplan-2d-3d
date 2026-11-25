# R2V 样本数据（测试用）

来源：[art-programmer/FloorplanTransformation](https://github.com/art-programmer/FloorplanTransformation)
（Raster-to-Vector, ICCV 2017），路径 `data/floorplan_representation/`。

- 许可证：**MIT**（Copyright © 2018 art-programmer），可自由使用、修改、再分发，需保留版权声明。
- 说明：原仓库中的栅格图像因 LIFULL 授权限制**不能分发**，这里只有矢量标注。
- 本目录两个文件是从上述仓库**逐字段复制**的真实样本；仅把列分隔的制表符替换成单个空格（解析器按空白切分，语义不变）。

格式（每行：`x0 y0 x1 y1 category d1 d2`）：

| 类别 | 含义 | 几何 |
|---|---|---|
| `wall` | 墙 | 一条**中心线**（两个端点） |
| `door` | 门 | 一条线段，长度 = 门洞宽 |
| `bedroom` / `living_room` / `kitchen` … | 房间 | 房间内部的一个**种子矩形**，不是房间多边形 |
| `toilet` / `bathtub` / `sofa` … | 家具图标 | 图标包围盒 |

`d1 d2` 原论文里是"墙两侧的房间 id"，本样本中为占位整数，转换时不使用。

| 文件 | 规模 |
|---|---|
| `plan-a.txt` | 1LDK 级别，7 个房间种子 + 6 樘门 + 若干图标 |
| `plan-b.txt` | 2LDK 级别，11 个房间种子 + 16 樘门 + 若干图标 |
