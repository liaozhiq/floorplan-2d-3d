# 文档索引

这个目录里是项目的说明文档。想快速找到东西，按下面的表点进去。

## 我该看哪一篇？

| 我想… | 看这篇 |
|---|---|
| **搞清楚 `.cache/cubicasa5k` 里那 5000 个文件是什么、能不能删** | [cubicasa5k-数据集说明.md](cubicasa5k-数据集说明.md) |
| **知道哪些数据是标注、哪些是推算出来的** | [数据来源与可靠性.md](数据来源与可靠性.md) |
| **确认 FloorPlanCAD 能否补上尺度/承重墙** | [floorplancad评估.md](floorplancad评估.md)（结论：不采用，仅存档） |
| **让"户型库"能用起来**（起服务器、换几室） | [户型库-按需生成.md](户型库-按需生成.md) |
| 了解项目代码怎么组织的（2D/3D 管线、数据流） | [源码导读.md](源码导读.md) |
| 自己画一套户型、写 layout JSON | [layout-spec.md](layout-spec.md) |
| 把一张户型图照片当底图、标定比例 | [底图与定标.md](底图与定标.md) |
| 搞清楚 R2V 那个数据集能不能用 | [r2v-数据评估.md](r2v-数据评估.md) |
| 看看转换出来的真实户型长什么样 | [samples/](samples/) |

## 最常被问到的一件事：怎么启动？

「户型库」功能要读 `layouts/` 目录，浏览器在 `file://` 下不允许读本地文件，所以**必须走 http**：

```powershell
cd D:\hy\floorplan-3d
node tools\serve.mjs 8123
```

然后打开 **http://127.0.0.1:8123** → `文件 ▾` → **户型库…**

> ⚠️ 别用 8000 端口：这台机器上 8000 被 Windows 保留，绑定会报 `WinError 10013`。可用端口：8080 / 8081 / 8123 / 5173 / 3000。
> Python 也一样能用：`python -m http.server 8080`（同样别用 8000）。

**单文件导入不受此限**：`文件 ▾ → 导入户型 JSON` 双击打开 `index.html` 也能用。

## 目录内容

| 文件 | 内容 |
|---|---|
| `cubicasa5k-数据集说明.md` | **数据集磁盘结构、获取命令、校验、能不能删**（`.cache` 里那 5000 个文件） |
| `数据来源与可靠性.md` | **每个字段来自哪里、属于哪档可靠性**（原始标注 / 可靠推导 / 假设 / 缺失），界面提示与 JSON 字段说明 |
| `户型库-按需生成.md` | 0–5 室按需生成命令、体积对照、应用内用法、重复度结论 |
| `源码导读.md` | 单文件架构拆解：数据模型、2D 渲染、指针交互、3D 建模、相机、82 项函数索引 |
| `layout-spec.md` | layout JSON 字段说明、从图纸填写的流程、校验器各项含义 |
| `底图与定标.md` | 图片底图层 + 两点定标（把照片换算成真实毫米）的实现与验证 |
| `r2v-数据评估.md` | ICCV 2017 R2V 数据集的可用性评估、五处硬伤、与 CubiCasa5K 对比 |
| `layout-4br-2lr-2ba.json` | 手写的四室两厅两卫示例数据（矩形房间，校验 0 error） |
| `samples/cubicasa/` | 从 CubiCasa5K 转换的真实四室户型（含许可说明） |
| `samples/r2v/` | R2V 样本的格式说明与生成方法（**数据不随仓库分发**） |

## 相关工具

配套脚本都在 [tools/](../tools/)，每个文件头部都有用法注释。常用的几个：

```powershell
node tools/serve.mjs 8123                    # 静态服务器（户型库需要）
node tools/layouts-build.mjs 4 --clean       # 生成 N 室户型库
node tools/validate-layout.mjs <json> --polygons   # 校验户型数据
node tools/render-layout.mjs <json> --iso    # 渲染等轴测 3D 预览
```
