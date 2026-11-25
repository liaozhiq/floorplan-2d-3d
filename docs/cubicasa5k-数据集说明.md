# CubiCasa5K 数据集说明（磁盘结构 / 获取 / 校验）

> 这份文件回答：**`.cache/cubicasa5k` 里那 5000 个文件是什么、从哪来、能不能删、怎么重建。**

---

## 1. 它是什么

[CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k)（SCIA 2019）是一个**真实户型标注数据集**：
5000 套芬兰住宅的平面图，矢量化标注了墙、门、窗、房间多边形、固定家具，并附有**原图纸印的房间尺寸**。

- 官方体积：**5.09 GiB**（zip）
- 许可：**CC BY-NC-SA 4.0** —— 仅个人非商业用途，需署名，再分发保持同协议
- 我们的用途：作为「户型库」的数据来源，转成项目自己的 layout JSON

---

## 2. 磁盘结构（为什么有两层同名目录）

```
.cache/
└── cubicasa5k/                        ← 我们指定的解压目标目录
    └── cubicasa5k/                    ← zip 内部自带的根目录名（所以重名，正常现象）
        ├── high_quality_architectural/   3732 套
        ├── high_quality/                  992 套
        └── colorful/                      276 套
            └── <样本编号>/                ← 例如 13451
                └── model.svg             ← 我们只需要这一个文件
```

三个风格目录是**互不重叠的分区**（编号两两交集为 0，共 5000 个唯一编号），
不是同一批图的三份渲染 —— 这点在 [数据来源与可靠性.md](数据来源与可靠性.md) 引用的重复度分析里验证过。

### 每个样本夹里原本还有什么

| 文件 | 内容 | 我们下了吗 |
|---|---|---|
| `model.svg` | **矢量标注**（墙/门/窗/房间/家具/尺寸文字） | ✅ 下了 5000 个 |
| `F1_scaled.png` | 缩放后的栅格图（约 1000px） | ❌ 没下 |
| `F1_original.png` | 原始分辨率栅格图 | ❌ 没下 |
| `F1_rendered.png` | 渲染图 | ❌ 没下 |

三张 PNG 占了 zip 体积的 **99% 以上**。我们只用矢量标注，所以只取了 `model.svg`：
**5000 个文件、压缩后 42 MiB、解压约 360 MB**。这就是为什么没去下那个 5.09 GiB 的整包。

---

## 3. 怎么重新获取

```powershell
# 只取 model.svg（约 42 MiB，几分钟；会跳过已存在的文件）
node tools/remote-unzip.mjs "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1" `
  .cache/cubicasa5k --match='model\.svg$' --skip-existing --concurrency=4 --retry=8
```

| 参数 | 说明 |
|---|---|
| `--match=正则` | 只取匹配的条目；默认就是 `model\.svg$` |
| `--skip-existing` | 已下载的跳过（反复重试补漏用） |
| `--concurrency=N` | 并发连接数。**别超过 6** —— Zenodo 会返回 429 限流 |
| `--retry=N` | 单个文件失败重试次数 |
| `--dry` | 只列出命中清单和体积，不下载 |
| `--inventory` | 只统计压缩包里各类文件的数量（用于确认里面有什么） |

> 需要栅格图时把 `--match` 换成 `F1_scaled\.png$` 之类即可。**但先想清楚要不要**：那是 GB 级。

首次下载实测约 20 分钟（42 MiB，但限流导致每个文件约 2.5 秒 × 5000 次请求）。
中途出现 `HTTP 429` 属正常，重跑一遍 `--skip-existing` 就能补齐（我实际跑了三轮：3935 + 1038 + 27）。

---

## 4. 怎么校验完整性

```powershell
# 数量：应为 5000
(Get-ChildItem .cache\cubicasa5k -Recurse -Filter model.svg -File).Count

# 各风格目录分布：3732 / 992 / 276
Get-ChildItem .cache\cubicasa5k\cubicasa5k -Directory |
  ForEach-Object { "{0,-30} {1}" -f $_.Name, (Get-ChildItem $_.FullName -Directory).Count }
```

再用结构完整性做一次体检（能跑通就说明 SVG 没损坏）：

```powershell
node tools/cubicasa-stats.mjs .cache/cubicasa5k      # 应报「有房间标注 4992 / 5000」
```

---

## 5. 能不能删

**能。** 它只是本地缓存，随时可以用上面的命令重建（代价是约 20 分钟下载 + 限流）。

删掉之后会发生什么：

| 依赖它的操作 | 影响 |
|---|---|
| `layouts/` 里已有的户型库 | **不受影响**，那是转换后的产物 |
| 应用本身（index.html） | **不受影响** |
| 重新生成某档户型库（`layouts-build.mjs`） | ❌ 需要先重新下载 |
| `dimlabel-scale.mjs` / `cubicasa-stats.mjs` 等分析 | ❌ 同上 |

所以：**只想用现成户型库 → 可以删**（省 360 MB）；**还想换几室 / 重新转换 → 留着**。

---

## 6. 与项目其它目录的关系

```
.cache/cubicasa5k/**/model.svg          原始标注（本文件描述的对象）
        │
        │  node tools/cubicasa-to-layout.mjs
        ▼
layouts/*.json + layouts/thumb/*.png    转换产物（应用读这个）
        │
        │  index.html → 文件 ▾ → 户型库…
        ▼
       浏览器里的 2D / 3D
```

转换规则、可信度分级见 [数据来源与可靠性.md](数据来源与可靠性.md)；
生成命令与体积对照见 [户型库-按需生成.md](户型库-按需生成.md)。
