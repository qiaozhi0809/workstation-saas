# 班主任工作台(原 HTML)· 功能考古报告

> 本文档是原 HTML 项目的完整功能提取,作为新项目重写时的权威参考。
> 原项目路径:`workstation-teacher/index.html`,共 4467 行、360KB。
> 考古日期:2026-11-01

---

## 附录 C: 文件章节与行号索引(先放这里便于后续检索)

| 章节 | 起始行 | 止 | 大致主题 |
|---|---|---|---|
| CSS 变量与样式 | 10 | 580 | `:root` 变量、框架、组件样式 |
| HTML body / skeleton | 581 | 586 | `<body>` 空壳 |
| ART · 教室场景与角色(SVG) | 593 | 1378 | 学生/老师/课桌/教室 SVG 渲染 |
| CORE · 工具函数、存储、数据模型、示例数据、统计 | 1379 | 1770 | `VERSION`、`STORE_KEY`、state `S` 结构、示例班级、derived 统计 |
| UI · 外壳、路由、弹窗、抽屉、提示、事件委托 | 1771 | 2118 | `ICON`、路由、Modal、Drawer、Toast |
| CHARTS · 轻量 SVG 图表 | 2119 | 2285 | 细线柱状、折线、分数段柱、及格线 |
| 教室页(Cls) · 五种模式、悬浮卡、拖拽、随机点名、右侧栏 | 2286 | 2927 | 日常/考勤/点评/成绩/排座 |
| 学生档案(Stu) · 名单、抽屉、编辑、导入导出、成长、评语 | 2928 | 3321 | 5 个标签页、CSV 导入、学科画像 |
| 成绩录入(Sc) · 考试管理、Excel 粘贴、按表头导入 | 3322 | 3548 | 考试、分数表格、粘贴识别 |
| 成绩分析(An) · 总体、分科、分数段、趋势、关注名单 | 3549 | 3654 | 及格率、优秀率、标准差、进退步 5 名 |
| AI 助手(AI) · 多家接口、流式、模板、脱敏、批量评语 | 3655 | 4249 | DeepSeek/通义/Kimi/智谱/豆包/硅基流动/文心 |
| 设置(SetP) · 班级/教师/教室/学科/AI/备份/关于 | 4250 | 4403 | 7 个标签页 |
| 启动(Welcome) · 首次欢迎页 → 工作台 | 4404 | 4467 | 老师形象选择、示例/新建 |

---

## 0. 总览

### 0.1 项目全貌

**班主任工作台**是一个 **单文件、零依赖、本地优先** 的个人工具,打开 `index.html` 双击即用,数据存浏览器 `localStorage`,不上传任何服务器。核心是一张**用纯 SVG 字符串拼接**出来的教室场景:讲台、黑板、挂钟、智慧屏、挂画、植物、座位、每个学生有自己的"黑色扁平+彩色围巾"卡通形象,老师形象立在讲台上。老师鼠标移到学生身上,学生"回头看",弹出信息卡;切到不同"模式"(考勤/点评/成绩/排座),同一张教室图承载不同的交互。

一个单文件装下了:**班级信息、学生档案(含家长)、考勤、点评、积分、成绩、评语、成长记录、待办、班级动态、AI 助手、设置、数据备份/恢复**。所有视觉完全由 SVG 字符串拼接,**不用任何图片资源、不用任何前端框架**。

### 0.2 核心产品灵魂

- **教室隐喻**:整个主界面就是一间"真的"教室,讲台/黑板/挂钟/智慧屏/挂画/绿植/软包椅/地毯/书架/读书角,学生按真实座位排布,班干部头顶有徽章(如小红花),体委手持哨子等。灵魂是"**我站在讲台上看着全班**"。
- **班主任主视角**:默认老师就是班主任,右上角老师形象可切男/女,下面写名字。老师形象也会在教室里出现(讲台后方立着),"回头看"、"随机点名拿教鞭"等动作绑在老师身上。
- **本地数据与隐私**:数据只在当前浏览器 `localStorage` 里,`STORE_KEY = 'bzr-workbench-v1'`。有 `migrate()` 做前向兼容,老的字段补齐默认值。
- **零门槛**:打开就是示例班级(46 人、4 次考试)或空教室,老师看看就能用。所有必填只有"学生姓名"一项。
- **"软科技感"美学**:白色家具 + 右上方打光的长软阴影 + 黑色扁平角色 + 彩色围巾。CSS 变量集中在 `:root`,主题色为蓝(#2f7ff0)、红(#e5483b)、琥珀(#e89a0c)、绿(#1d9a57)。
- **AI 作为"写作助手"**:AI 从不自动做事,**所有 AI 输出都是草稿让老师看过改过再用**;默认隐去学生真名脱敏,结果返回后在本地替换回真名。

### 0.3 模块清单

| 一级模块 | 核心能力 |
|---|---|
| 教室 (Cls) | 五种模式(日常/考勤/点评/成绩/排座)+ 悬浮卡 + 随机点名 + 右侧概况栏 |
| 学生档案 (Stu) | 名单筛选 + 档案抽屉(5 标签页) + 添加 + CSV/Excel 粘贴批量导入 + 导出 CSV |
| 成绩录入 (Sc) | 考试管理 + 表格录入(方向键/回车/Excel 粘贴) + 按表头导入 |
| 成绩分析 (An) | 总体指标 + 分科得分率 + 分数段 + 历次趋势 + 排名表 + 需要关注的同学 |
| AI 助手 (AI) | 多家 LLM 接入 + 流式输出 + 24 个模板 + 批量评语 + 无 API 时复制提示词 |
| 设置 (SetP) | 班级/教师形象/教室布局/学科点评/AI 接口/数据备份/关于 |
| 启动 (Welcome) | 首次欢迎页(选形象/示例 or 新建) → 进入工作台 |

---

## 1. 存储模型(localStorage)

### 1.1 存储入口

| 常量 | 值 | 含义 |
|---|---|---|
| `VERSION` | `'1.0.0'` | 代码版本号(未写入 state) |
| `STORE_KEY` | `'bzr-workbench-v1'` | 唯一 localStorage key |

- `Store`(1409-1418 行):localStorage 不可用时自动降级到内存 `mem`,API `ok/get/set/del`。写满/隐私模式下 `UI.toast('存储空间不足，请到设置里导出备份')`。
- `save(now)`:默认 250ms 防抖 → `localStorage.setItem(STORE_KEY, JSON.stringify(S))`。`now=true` 立即写。
- `load()`:读 → `JSON.parse` → `migrate()` → 返回;**解析失败返回 null**(不弹错)。

### 1.2 全局状态 `S` 的 schema(默认结构见 `defaultState()` 1490-1510 行)

```jsonc
{
  "v": 1,                            // state 版本号(当前恒为 1,保留给后续迁移)
  "demo": false,                     // 是否示例数据(载入示例后为 true,"开始录入我的班级"会清空)
  "settings": {
    "school": "",                    // 学校名
    "className": "我的班级",
    "stage": "初中",                  // 学段:小学/初中/高中(决定科目预设)
    "grade": "",                     // 年级(自由文本,如 "初二")
    "term": "",                      // 学期(自由文本,如 "2026—2027 学年 第一学期")
    "termStart": "2026-09-01",       // 开学日期,用于算"第几周"
    "countdown": {
      "label": "期末考试",             // 倒计时名称
      "date": "2027-01-15"           // 倒计时日期
    },
    "teacher": {
      "name": "老师",
      "gender": "F",                 // 'F' | 'M'
      "subject": ""                  // 任教学科
    },
    "rows": 6,                       // 教室排数
    "pairs": 4,                      // 教室组数(每组 2 桌,所以总桌数 = rows * pairs * 2)
    "subjects": [                    // 当前学科清单(默认从 SUBJECT_PRESETS[stage] 前 6 科)
      { "name": "语文", "full": 120 },
      ...
    ],
    "boardLeft": "1 语文  2 数学\n...",  // 左黑板"今日课程",换行分隔
    "boardRight": "值日：待安排\n作业：", // 右黑板"今日事项"
    "reasons": [                     // 点评理由池(默认见 DEFAULT_REASONS)
      { "t": "积极发言", "d": 1 }, ...
    ],
    "anim": true,                    // 教室小动画开关
    "ai": {
      "provider": "deepseek",
      "base": "https://api.deepseek.com",
      "key": "",                     // 明文存储(未加密),用户自己负责
      "model": "deepseek-flash",
      "mask": true,                  // 隐去学生姓名
      "temp": 0.7                    // temperature
    },
    "lastBackup": 0,                 // 时间戳,0=从未备份
    "onboarded": false               // 是否完成首次欢迎页
  },
  "students": [                      // 见下 1.3
    {...}
  ],
  "exams": [                         // 见下 1.4
    {...}
  ],
  "attendance": {                    // 见下 1.5: { "YYYY-MM-DD": { sid: 'leave'|'absent'|'late' } }
    "2026-11-01": { "stu103": "leave", "stu130": "late" }
  },
  "points": [                        // 见下 1.6:点评积分流水
    { "id": "p1", "sid": "stu100", "d": 1, "r": "积极发言", "t": 1730000000000 }
  ],
  "records": [                       // 见下 1.7:成长记录
    { "id": "r1", "sid": "stu100", "type": "表扬", "text": "...", "date": "2026-11-01" }
  ],
  "todos": [                         // 老师私人待办
    { "id": "t1", "text": "周五前收齐秋游安全回执", "done": false }
  ],
  "chats": [                         // AI 对话历史(见 §10)
    { ..., "msgs": [...] }
  ]
}
```

### 1.3 Student 对象字段(来自 `demoState()` 和编辑表单)

```jsonc
{
  "id": "stu100",                   // uid('stu') 生成,首次 demo 用 'stu' + (100 + idx)
  "name": "王浩然",
  "gender": "M",                    // 'M' | 'F'
  "no": "250301",                   // 学号(自由字符串,支持 numeric collator 排序)
  "seat": "3-5",                    // 'row-col'(0-based),null=未排座
  "group": 0,                       // 小组号(自动 = Math.floor(col/2))
  "birthday": "2012-09-15",         // YYYY-MM-DD
  "role": "班长",                   // ROLES 枚举之一或 ""
  "tags": ["重点关注", "住校"],      // TAG_POOL 枚举 + 自由添加
  "boarding": false,                // 是否住校(tags 里有"住校"时冗余为 true)
  "parents": [                      // 联系人,0-2 个
    { "name": "王建国", "rel": "父亲", "phone": "13800000011", "job": "工程师" }
  ],
  "family": "双亲家庭",             // FAMILY_TYPES 之一
  "familyNote": "...",              // 家庭备注
  "study": "...",                   // 学习情况
  "strengths": "",                  // 性格特长(编辑表单里拆成两项,实际用一字段)
  "personality": "...",             // 性格描述
  "health": "",                     // 健康情况
  "note": "",                       // 其他备注
  "comments": []                    // 评语数组,见下
}
```

**Comments(学期评语)**:每条
```jsonc
{ "id": "cm_xxx", "term": "2026—2027 第一学期", "text": "...", "date": "2026-11-01", "ai": true }
```

### 1.4 Exam 对象字段

```jsonc
{
  "id": "ex1",
  "name": "期中考试",
  "date": "2026-10-23",             // YYYY-MM-DD
  "type": "期中",                   // EXAM_TYPES 之一:月考/期中/期末/周测/单元测/模拟考/其他
  "subjects": [                      // 本次考试包含的科目(可以是设置里科目的子集)
    { "name": "语文", "full": 120 }
  ],
  "scores": {                        // 分数矩阵:{sid: {subName: 数值|null}},null=缺考
    "stu100": { "语文": 110.5, "数学": 115 },
    "stu120": { "语文": 95, "数学": null }       // 缺考
  }
}
```

### 1.5 Attendance 字段

`S.attendance[dateStr][sid] = 'leave' | 'absent' | 'late'`。**出勤状态不存**(默认即出勤)。

### 1.6 Points(点评积分流水)

```jsonc
{
  "id": "p1",
  "sid": "stu100",
  "d": 1,                           // 正=加分,负=扣分,也可以是任意整数
  "r": "积极发言",                   // 理由(reason 池里取,也可以自由输入)
  "t": 1730000000000                 // 时间戳(ms)
}
```

### 1.7 Records(成长记录)

```jsonc
{
  "id": "r1",
  "sid": "stu100",
  "type": "表扬",                    // RECORD_TYPES: 表扬/谈话/家访/获奖/提醒/其他
  "text": "期中英语缺考...",
  "date": "2026-11-01"
}
```

### 1.8 migration 规则(migrate() 1436-1472 行)

- 没有版本号,**基于字段补齐**:缺的字段用 `defaultState()` 的值兜底,保证旧数据能继续用。
- 旧 AI model 名的硬映射:`deepseek-chat / deepseek-reasoner → deepseek-flash`;`moonshot-v1* → kimi-k3`。
- 校验 `students[]/exams[]/points[]/records[]/todos[]/chats[]` 为数组,否则重置为 `[]`。
- 过滤 `students` 必须有 `id && name`;`exams` 必须有 `id`;`points` 必须有 `sid && typeof d === 'number'`。
- Exam.subjects 清洗:只保留 `{name, full>0 ? +full : 100}`;Exam.scores 为对象;Exam.name 兜底 `'未命名考试'`;Exam.date 兜底 `todayStr()`。
- 关闭页面时正在流式生成的 AI 回复:标记 `streaming=false`,如果没内容加 `err='上次生成被中断了（页面关闭或刷新），可以点「重试」。'`;有内容追加 `(上次生成被中断，可以点「重新生成」)`;batch 内 `'run'` 状态改回 `'wait'`。
- `students` 补齐 `parents=[], tags=[], comments=[]`。

### 1.9 预设枚举(1475-1488 行)

```js
SUBJECT_PRESETS = {
  '小学': [['语文',100],['数学',100],['英语',100],['科学',100],['道法',100]],
  '初中': [['语文',120],['数学',120],['英语',120],['物理',100],['化学',100],['道法',100],['历史',100],['地理',100],['生物',100]],
  '高中': [['语文',150],['数学',150],['英语',150],['物理',100],['化学',100],['生物',100],['政治',100],['历史',100],['地理',100]]
}

DEFAULT_REASONS = [
  {t:'积极发言',d:1},{t:'作业优秀',d:1},{t:'乐于助人',d:1},{t:'值日认真',d:1},{t:'考试进步',d:2},{t:'为班争光',d:3},
  {t:'上课走神',d:-1},{t:'作业未交',d:-1},{t:'迟到',d:-1},{t:'违反纪律',d:-2}
]

ROLES = ['班长','副班长','学习委员','纪律委员','体育委员','文艺委员','劳动委员','宣传委员','心理委员',
        '语文课代表','数学课代表','英语课代表','物理课代表','化学课代表','小组长']

TAG_POOL = ['重点关注','住校','留守','单亲','近视','过敏','体育特长','文艺特长',
            '进步明显','偏科','心理关注','困难帮扶']

FAMILY_TYPES = ['双亲家庭','单亲家庭','重组家庭','隔代抚养','父母在外务工','其他']

RECORD_TYPES = ['表扬','谈话','家访','获奖','提醒','其他']

ATT = {
  leave:  { t:'请假', tone:'amber' },
  absent: { t:'缺勤', tone:'red' },
  late:   { t:'迟到', tone:'blue' }
}

EXAM_TYPES = ['月考','期中','期末','周测','单元测','模拟考','其他']
```

### 1.10 衍生/统计函数(1678-1769 行)

- 查询:`stuById / examById / examsSorted / latestExam / prevExam / seatMap / studentsByNo / pointsOf / attToday / age / daysToBirthday / weekNo / countdownDays`
- 成绩:
  - `examFull(ex)` = 该考试所有 subject 的 full 之和
  - `stuTotal(ex, sid)` = 学生所有有分数的科目加和;**全部缺考返回 null**
  - `examTable(ex)` = `[{sid, total, rank, subs:{name:v}}]`,按总分降序,**同分同名次**(dense-rank 的一种变体,实际是:相同 total 用上一个的 rank,下一个按位次,这里实现是 `if (total !== last) lastRank = i+1`,所以是**排名并列但下一名跳号**)
  - `rankMap(ex)` = sid → row 的字典
  - `subjectStats(ex, name)` = `{full, n, avg, rate, max, min, pass, good, low}`:及格线=full×0.6,优秀线=full×0.85,`low` 是不及格人数
  - `examStats(ex)` = `{ex, full, n, table, subs[], avg, max, min, rate, pass, good, sd}`:`sd` 为总分标准差
  - `entryProgress(ex)` = `{n, total}`:成绩录入完成度(所有科目都非空算完成)
  - `stuTrend(sid)` = 返回数组,每次考试 `{ex, total, rank, n, rate}`

---

## 2. 教室可视化(SVG 渲染层,ART 模块,593-1377 行)

### 2.1 公开 API(1373-1376 行)

```js
ART = {
  INK, GROUPS, groupColor,
  layout(rows, pairs, extra),        // 返回布局数据 L(所有坐标函数)
  scene(data),                        // 返回 {svg: string, L: layout},主入口
  avatar(st, size, opts),            // 学生正脸头像(用于信息卡)
  teacherAvatar(t, size, bg),        // 老师头像
  hash(str), rng(seed)               // 用于稳定的"随机"
}
```

`scene(data)` 的 `data` 结构:

```js
{
  rows, pairs,                          // 排数 × 组数(每组 2 桌)
  extra,                                // 屏幕额外宽度,用于两侧加宽放"图书角/生物角"等
  subjects,                             // 右侧作业收纳架按科目分格
  seats: {"r-c": student},             // 座位 → 学生对象
  teacher: {gender, label},            // 老师形象
  board: {                              // 黑板和智慧屏
    leftTitle, leftLines,               // 左黑板"今日课程"
    rightTitle, rightLines,             // 右黑板"今日事项"
    screenTop, screenBottom,            // 智慧屏顶/底文字
    days, countLabel,                   // 倒计时数字 + 名称
    stars,                              // "本周之星" 排行(宽屏显示)
    bdays                               // "本月寿星" 排行(宽屏显示)
  },
  views: {                              // 每个学生的"渲染行为"覆写
    [sid]: {
      cls,                              // 加 CSS class(如 'absent' 半透明)
      tint,                             // 桌面着色(成绩模式按名次深浅)
      color,                            // 围巾颜色覆写
      badge, badgeTone,                 // 桌子上方徽章(点评 +/- 分值)
      chip, chipTone                    // 头上胸标(如 ↑ 进步、↓ 退步)
    }
  },
  seatNos: boolean,                     // 是否显示 "行-列" 座位号
  mode                                  // 外部切换 CSS
}
```

### 2.2 布局函数 layout(rows, pairs, extra) 672-700 行

- 关键常量:`DW=92 课桌宽、DD=44 课桌深、DF=10 桌面厚、LEG=18 桌腿、PAIR=184 一组两桌、AISLE=58 过道、SIDE=96 两侧墙到座位距离、WT=16 墙厚、FRONT=214 前墙高度、PLAT=92 讲台进深、ROW=112 行距、BACK=96 后排距离`
- extra 多余宽度分配:先给过道加,最多每过道加 56;剩下的两侧各加 ≤320 用于放陈设。
- 坐标函数:
  - `L.seatX(c)` = `WT + SIDEL + (c/2 整)×(PAIR+AISLE) + (c%2)×DW`
  - `L.seatY(r)` = `FRONT + PLAT + 36 + r × ROW`
  - `L.headX(c)` = seatX + DW/2
  - `L.headY(r)` = seatY + DD + 2
- 总宽 `L.W = gridW + 2 × SIDE + 2 × WT`,总高 `L.H = row0 + rows × ROW + BACK + WT`。

### 2.3 公共 defs(703-723 行)

一堆渐变/模糊滤镜,原文抓关键 id:

- Filters: `fxShadow(高斯模糊 9)`、`fxShadowS(高斯模糊 2.2)`、`fxLight(高斯模糊 7,用于窗口光斑)`
- Gradients: `gFloor` 地板、`gWall` 墙面、`gDeskTop` 桌面、`gDeskFace` 桌侧、`gChair` 椅子、`gChalk` 黑板、`gScreen`(蓝色智慧屏:#4b9bff→#2a6fe0)、`gPlat` 讲台地台、`gLectFace` 讲桌、`gGlass` 玻璃窗、三个 `gWallAO/gWallAOx/gWallAOxr` 墙根暗角
- Pattern: `pTiles` 地砖纹理(88×88 浅线)

### 2.4 角色

- **studentFigure(st, color)**(726-772 行):背面坐姿,原点=头部中心。女生 3 种发型(双马尾/波波头/丸子头,按 `hash(st.id or name) % 3` 选),男生耳朵+1 种帽子类分叉。身体黑色 INK,围巾按组色或自定义。
  - `.arm` 组默认 CSS display:none,随机点名时 CSS 切换显示(举手)
  - `.face` 组:正脸(回头显示)——椭圆白色眼白 + 黑色瞳孔 + 两颊腮红
  - `.zz` 组:两个 "z" 字,头上冒(课间趴桌睡觉)
  - `.body / .head / .scarf` 分组方便 CSS 控制
- **avatar(st, size, opts)**(774-805 行):正面头像 SVG,用于悬浮卡、档案抽屉的头像位。可覆盖 `color` 和背景 `bg`,size 决定渲染分辨率。
- **teacherFigure(t)**(807-851 行):老师正面站立,原点头部中心。女老师丸子头+刘海+红发箍,男老师西服+蓝领带+白衬衫。
  - `.t-arm` 组:默认 display:none,点名/讲课时抬起,拿一根米色教鞭(path 到 92, -56)
  - `.t-pupil`:两只瞳孔,"回头看"时随鼠标偏移
- **teacherAvatar(t, size, bg)**:正面头像版本。

### 2.5 课桌与椅子(857-915 行)

- **desk(L, x, y)**:桌面(白色上面 + 灰色侧面)+ 桌腿阴影 + 桌面厚度 + 边缘描边。
- **deskProps(x, y, W, seed)**:桌上随机书、笔、水瓶、翻开的书 —— **按 seed 决定摆放**(`rng(hash(key + sid))`),所以每次渲染同一个学生桌子**稳定一样**。书籍颜色从 `BOOK` / `SPINE` 色板里取。
- **chairSeat(cx, cy) / chairBack(cx, cy)**:椅子分前后两层(前面坐部分在学生之前渲染,后面靠背在学生之后渲染,产生"学生坐在椅子上"的层次感)。
- **deskShadow / seatShadow**(917-925 行):每张桌子/椅子的斜向软阴影 polygon,fill-opacity 0.07-0.15。

### 2.6 前墙(frontWall, 927-1031 行)

- 墙体底色 + 顶/底踢脚线
- 中央一块 BW×BH 的黑板(两块 + 中间智慧屏),宽度 `min(800, gridW + 40)`,高度 106
- **左黑板**(左 pw 宽):`b.leftTitle || '今日课程'` + `b.leftLines[0..3]`,楷体 Kaiti SC,灰白色 #f1f1ec
- **右黑板**(右 pw 宽):`b.rightTitle || '值日'` + `b.rightLines[0..3]`
- **智慧屏**(292 宽):`b.screenTop / b.days / b.countLabel / b.screenBottom`,蓝色渐变背景,数字 40px font-weight 700
- **粉笔槽**:桌面下方灰条 + 几支彩色粉笔(白/粉/黄 + 一个黑板擦)
- **两侧展板**(宽屏才有):
  - `segL >= 260`:左侧"本周之星"(金色 #f2b01e,显示前 3 名字+积分)+ "班级公约" 一张倾斜 -3° 的白纸
  - `segR >= 260`:右侧 "本月寿星"(红色 #e5483b,显示前 3 名字+日期)+ 挂钟(实时表盘,时针/分针用 class clock-h/clock-m,JS 定时转动)
  - 窄一些时只放纸和钟

### 2.7 讲台(podium, 1033-1071 行)

- 地台(pw ≤ gridW+60,居中)+ 下方斜向阴影
- **讲桌**(lw=240,居中)+ 上面摆:笔记本电脑(60×33,从背面看,中间圆点=苹果 logo 风格)、三本倾斜叠放的作业本、马克杯(双圈,一圈蓝环)、粉笔盒(白底 + 4 根彩色粉笔)
- **讲桌铭牌**:圆角白框 + `t.label`(班级名)
- **作业筐**(hx+60):白框装 3 本倾斜课本
- **老师形象**:`teacherFigure(t)` 立在讲桌前,scale 1.2

### 2.8 房间(room, 1073-1304 行,最长最复杂的函数)

房间按**可用宽度自适应**布置:

- 地板:渐变 + 瓷砖纹理 pattern(pTiles)
- **窗户光斑**:nwin = max(3, rows-2) 个,每个一片 polygon 从右墙投到地上,带高斯模糊
- 右墙是整排玻璃窗(gGlass 渐变)
- 左墙前后各一个门(门洞 + 门垫)
- 后墙是**储物柜**(按宽度算 lockN 个柜门,每个柜子还有一个彩色贴纸)
- **左侧区域**(可用宽度 zl):
  - zl < 130:只放一个纵向书架(shelfV) + 一个地球仪
  - zl >= 130:三层
    - 上层:**图书角** = 纵向书架 + 横向书架 + 地毯 + 圆桌(台灯) + 2-4 个豆袋 + 可能有双人沙发;zoneLabel("图书角")
    - 中层:**荣誉展柜** = 盾形奖杯 + 几个圆形奖牌(金色) + 墙边"奖状展示台";zoneLabel("荣誉展柜")
    - 下层:**卫生角** = 2 个圆垃圾桶(灰+蓝) + 木柄扫把 + 浅蓝桶拖把;zoneLabel("卫生角")
- **右侧区域**(可用宽度 zr):
  - zr < 130:只放一个前角绿植
  - zr >= 130:三层
    - 上层:**作业收纳**(按 subjects 分格,每格放 1-3 本本子,格子底写科目名前两字);zoneLabel("作业收纳")
    - 中层:**生物角** = 柜 + 鱼缸(3 条彩色小鱼) + 多肉盆栽 ×4 + 旁边可能有观察记录板;zoneLabel("生物角")
    - 下层:**器材筐**(篮球橙+足球黑白+呼啦圈);zoneLabel("器材筐")
    - 更下:**谈心角** = 地毯 + 圆桌(两个茶杯 + 一本笔记) + 两张单人座椅;zoneLabel("谈心角")
- 右前角:**饮水机**(32×32 白柜 + 蓝色水桶圆) + 绿植

**所有陈设都有软阴影 shade/fxShadowS**。

### 2.9 整个场景(scene, 1306-1371 行)

绘制顺序(z-index 从低到高):
1. defs
2. room(含所有陈设)
3. frontWall(黑板/智慧屏/钟表/展板)
4. podium(讲台 + 老师)
5. 阴影层(所有桌子+椅子的大阴影 polygon 一次性画完)
6. **逐行**(越往下越近)画课桌 + 学生:
   - `<g class="seat has/empty" data-seat="r-c" data-sid="...">`
   - 内含:
     - 命中区 `rect.hit`(transparent,点击/悬停识别)
     - `desk-g`:课桌 + 可选 tint(成绩模式着色) + deskProps(桌上物品)
     - 学生姓名 `text.lbl`(课桌正面标签)
     - `chairSeat`(椅前坐垫)
     - 学生 `<g class="stu">` 或空座的"+"占位符(虚线圆圈)
     - `chairBack`(椅背,盖住学生下半身)
     - 可选 `badge`(点评飘字 +N/-N)
     - 可选 `chip`(头上标记,如 ↑/↓)
     - 可选 `seatno`(左上角 "r-c")
7. 右下角水印 `Developed by @赛博老爸`
8. `<g class="fx-layer">` 空层,用于动态插入"举手"、"教鞭"、"飘字"效果

### 2.10 关键交互(具体在 §13 展开)

- **鼠标悬停学生"回头看"**:JS 监听 `.seat.has` 的 `pointerenter/leave`,通过 CSS 切换 `.face` 可见、`.body` 翻转、瞳孔跟随鼠标 X 坐标
- **随机点名"举手+教鞭"**:JS 修改选中 `.seat` 的 class 让 `.arm` 显示,老师 `.t-arm` 显示并旋转指向该座位
- **积分飘字**:插入到 `.fx-layer` 一个带 CSS 消失动画的 `<text>`,2 秒后自删
- **拖拽排座**:原生 pointer 事件 + 把 SVG 坐标映射到座位编号
- **教室缩放/拖动**:外层 `.scene` 用 `transform: translate(x,y) scale(s)` 控制,`Cls.view = {s, x, y, fit}`,Ctrl+滚轮缩放,按住左键拖

### 2.11 全屏模式

浏览器原生 `requestFullscreen()` 包住 app 容器;Esc 自动退出;CSS 用媒体查询 `:fullscreen` 隐藏侧栏和 rail。

---

## 3. UI 外壳、路由、事件委托(UI 模块,1771-2117 行)

### 3.1 `ICON` 对象(1774-1811)

含 32 个内联 SVG 图标:room / users / edit / chart / spark / gear / search / plus / x / dice / zin / zout / unfull / fit / lock / down / up / trash / copy / doc / check / cake / send / stop / side / print / userplus / back / refresh / eye / shuffle / star / link。都是 16×16(少数 14×14),stroke=currentColor,方便外部用 color 控制。

### 3.2 `UI` 对象的职责(1813-1950)

- `UI.page`:当前页名,枚举 `'class' | 'students' | 'scores' | 'analysis' | 'ai' | 'settings'`。
- `UI.pages`:页定义注册表,结构 `{render(el, opts), rail(el), mount(opts), unmount(), resize(), ...}`。每个业务模块(Cls/Stu/Sc/An/AI/SetP)自己 `UI.register('class', {...})` 注册进来。
- `UI.act / UI.inp / UI.chg / UI.key`:**事件委托字典**。全局监听 click/input/change/keydown,找 `[data-act=...]` 等属性,查字典对应函数调用。整个应用没有 React 式的 handler 绑定,全是**声明式 data-act**。
- `UI.go(page, opts)`:路由。调用 pages[old].unmount,设置 nav 高亮,`.main` 渲染,`.rail` 渲染,`UI.drawCharts()`,`history.replaceState('#/' + page)`。
- `UI.shell()`:主框架:
  - 左 `aside.side` = brand + 全局搜索框 + nav + 最近对话 + 老师信息
  - 中 `main#main`
  - 右 `aside#rail`(窄屏自动隐藏,class `with-rail`)
  - 浮动全屏按钮 `#fsBtn`
- `UI.modal(o)`、`UI.closeModal()`、`UI.confirm(title, msg, okText, onOk, danger)`:弹窗。
- `UI.drawer(html)`、`UI.closeDrawer()`:**右侧抽屉**,用于学生档案详情。
- `UI.toast(msg)`:底部短提示,2.1s 后消失。
- `UI.showCard(html, anchor)`、`UI.hideCard()`:**悬浮卡**,随 anchor 定位(鼠标悬停学生时弹出)。
- `UI.pop(html, x, y)`:**右键菜单式弹层**,点击任意处关闭。
- `UI.chart(fn)` + `UI.drawCharts()`:注册一个图表函数,渲染后按容器宽度回调绘制 SVG(响应式)。

### 3.3 全局搜索(1827 + 2062)

- 侧栏顶部 `#gsearch` 输入框,`data-inp="gsearch"` → `UI.inp['gsearch']`
- 匹配 `student.name.indexOf(q) >= 0 || String(student.no).indexOf(q) >= 0`,最多 8 条
- 结果弹出 `.search-pop`,第一条有 `.on` 高亮,**回车即跳到第一条**(`UI.key['gsearch']` 监听 Enter)

### 3.4 全局事件委托模式(1970-2001)

```js
document.addEventListener('click', e => {
  var el = e.target.closest('[data-act]');
  var fn = UI.act[el.getAttribute('data-act')];
  fn(el, e);
});
```

- **声明式驱动**:HTML 元素带 `data-act="save"`,JS 侧 `UI.act['save'] = function(el, e) {...}` 注册。
- 一致性强,但调试时跳转到定义不如 React 直观。
- `Esc` 按键:优先关 pop → modal → drawer → 随机点名卡。

### 3.5 全屏(2027-2047)

- `UI.act['fullscreen']`:原生 `requestFullscreen()`,包住 `document.documentElement`,整个工作台进全屏。
- Esc / 浏览器事件 fullscreenchange → updateFsBtn + resize。
- 不支持的浏览器弹 "可以按 F11"。

### 3.6 下载 / 复制 / CSV 解析(2074-2117)

- `downloadFile(name, content, type)`:生成 Blob + `<a download>` 自动点击 + revokeObjectURL
- `copyText(t)`:优先 `navigator.clipboard`,降级到 `document.execCommand('copy')`
- `csvCell(v) / toCSV(rows)`:生成 CSV,**带 UTF-8 BOM**(`'﻿'` 开头),防止 Excel 乱码
- `parseTable(text, keepEmpty)`:**同时解析 Excel 粘贴(Tab 分隔)和 CSV**,带引号和多行单元格处理;`keepEmpty=true` 时保留空行(成绩粘贴专用,防错位)

---

## 4. CHARTS 图表库(2119-2284 行,CH 模块)

### 4.1 颜色体系

- `C.s1 = #2a78d6`(主蓝)、`C.s2 = #eb6834`(橙)、`C.s3 = #1baf7a`(绿)、`C.base = #a3a29b`(灰基线)、`C.crit = #d03b3b`(红,参考线)
- `SEQ = ['#cde2fb','#9ec5f4','#6da7ec','#3987e5','#256abf']`:单色阶梯

### 4.2 API 导出

- `bars(data, W, opts)`:**柱状图**,数据 `[{label, value, tip, color}]`,opts `{h, max, fmt, ref, refLabel, color, valueLabels}`
  - **圆角柱头** `colTop()`(自定义 SVG path 实现圆角 r=4)
  - 支持**参考线**(红色水平线 + 标注),用于"及格线 60%"
  - 自动 `niceMax()` 计算 Y 轴上限(1/2/2.5/5/10 的倍数,近似 D3 niceScale)
- `lines(series, labels, W, opts)`:**折线图**,支持多系列、面积填充、末端标签、悬停提示
  - 空值 null 自动断开(pen = false)
  - `endLabel`:主系列最后一个点上方显示数值
- `radar(axes, series, W, opts)`:**雷达图/蜘蛛图**,用于**学生学科画像**。1/4/0.6/0.8/1 的 5 层网格
  - 每个顶点一个 hover 热区
- `spark(values, W, H, color)`:**sparkline**,用于学生档案"得分率曲线"迷你图

### 4.3 Tip 系统

全局 mousemove 监听 `[data-tip]`,找到后 `#tip` 弹层按鼠标位置定位,避开屏幕边缘。tip 内容是 HTML。

---

## 5. 教室页 Cls(2286-2926 行,核心页面)

### 5.1 Cls 全局状态(2289-2294)

```js
Cls = {
  mode: 'daily',           // 当前模式:'daily' | 'att' | 'points' | 'grade' | 'seat'
  view: {s:1, x:0, y:0, fit:true},  // 缩放/平移状态
  L: null,                 // 当前 layout 数据
  attDate: null,           // 考勤选中日期(YYYY-MM-DD)
  gradeExam: null,         // 成绩模式当前考试 id
  seatUndo: null,          // 排座前的快照
  pickedSeat: null,        // 排座模式先选中的座位
  idle: null, clock: null, // 定时器 handle
  down: null,              // pointerdown 状态(拖/点/平移)
  picking: false,          // 正在随机点名
  recentPicks: [],         // 最近抽过的 sid(不超过 8 或 pool-1)
  entered: false,          // 首次进入做入场动画
  cardT: null, hideT: null // 悬浮卡定时器
}

MODES = [
  {id:'daily', t:'日常'},
  {id:'att',   t:'考勤'},
  {id:'points',t:'点评'},
  {id:'grade', t:'成绩'},
  {id:'seat',  t:'排座'}
]
```

### 5.2 场景数据组装(2308-2371)

- **`boardData()`**:生成传给 ART.frontWall 的黑板/智慧屏数据
  - 左黑板:`今日课程` + `settings.boardLeft.split('\n')`
  - 右黑板:`今日事项` + `settings.boardRight.split('\n')`
  - 智慧屏 top:`"初二(3)班 · 11月1日 星期一"`
  - 中间:距期末考试 X 天(countdownDays())
  - 底:倒计时日期或学校名
  - 本周之星:`weekStars()`
  - 本月寿星:`monthBirthdays()`
- **`weekStars()`**:本周(周一起)积分 > 0 的前 3 名,`{name, pts: '+N'}`
- **`monthBirthdays()`**:本月有生日的学生按日期排序
- **`sceneExtra()`**:根据舞台宽度算 extra 加宽量(让教室填满横向空间)
- **`buildViews()`**:**每个模式对每个学生的"渲染行为"**
  - 考勤:请假/缺勤加 chip + CSS 'ghost'(半透明);迟到只加 chip 不加 ghost
  - 点评:积分 badge `+N` 或 `-N`(≥8 用主色 badge,否则 light)
  - 成绩:桌面 tint 按名次深浅(用 CH.SEQ 5 色),进退步 ≥5 名 badge `#N ↑n` / `↓n`,无成绩 dim + badge '无成绩'
  - 排座 picked:加 'picked' class

### 5.3 五大模式切换规则(2491-2512 `onSeatClick` + 2728 `cls-mode`)

| 模式 | 点学生 → | 点空座 → | 子工具栏 |
|---|---|---|---|
| `daily` | 打开档案抽屉 overview | 打开"添加学生"表单 | 无 |
| `att` | 轮转考勤状态 `null → leave → absent → late → null`,并立即 save | 添加学生 | 日期选择器 + 实到/请假/缺勤/迟到统计 + 全部出勤 + 导出本月 |
| `points` | 弹出 `openPointPop`(点评选单) | 添加学生 | 全班 +1 + 积分榜 |
| `grade` | 打开档案 scores 标签 | 添加学生 | 选考试 + 色阶图例 + 完整分析入口 |
| `seat` | 两次点选交换;点同一个取消 | — | 随机打乱 / 优带弱 / 男女同桌 / 撤销 / 打印 |

### 5.4 随机点名(2639-2680)

- 过滤 pool:**有座位 && 当日 attendance 不是 leave 或 absent**(late 可以被抽)
- **冷却**:`Cls.recentPicks` 保存最近抽过的 sid,池里优先用没在 recentPicks 里的;都抽过就清空重来
- 冷却长度 = `min(8, pool.length - 1)`
- **动画**:16 步跳动,delay 从 55ms 开始每步 ×1.16(减速),prefers-reduced-motion 跳过
- 中选后:
  - 学生座位加 CSS class `turn` + `hand` + `picked` → 学生 CSS 控制回头 + 举手
  - 老师 `.teacher` 加 class `point` → 老师 CSS 控制举教鞭+指向
  - 弹出 `#pickCard`:显示头像/姓名/学号/职务 + "回答得好 +1" + "再抽一个"
- 关闭:清除所有 class,`pick-close`
- 回答得好:`addPoint(sid, 1, '回答问题')` + 关闭

### 5.5 排座算法(2562-2636)

#### 5.5.1 `moveSeat(from, to)`
- 保存快照到 `Cls.seatUndo`(所有学生的 `[id, seat, group]`)
- 把 `from.seat = to`,如果 to 有人则 `to.seat = from`(**交换,不是插入**)
- `autoGroups()`:根据 col 自动设 group(`Math.floor(col/2)`)

#### 5.5.2 `placePairs(pairs)`
- `pairs = [[A,B|null], ...]`
- 桌子列表 `desks = ['0-0','0-1', '0-2','0-3', ...]`(行列顺序)
- **先把所有学生 seat 清空**,再把 pairs 按桌子顺序填入
- 排座算法外部通常先 `shuffleArr(pairs)` 打乱桌子顺序,避免固定前后

#### 5.5.3 具体三个算法
- **随机打乱 `seat-shuffle`**:`shuffleArr(students)`,按 `allSeats()` 顺序填入
- **优带弱同桌 `seat-mentor`**:要求最近有考试;按最新考试 `rankMap` 排名,**前后搭配**(第 1 配最后一名,第 2 配倒数第二,...),再 `shuffleArr(pairs)` 打乱桌序
- **男女同桌 `seat-gender`**:boys/girls 各自 shuffle;循环配对直到一方用完;剩下的两两再配
- **撤销 `seat-undo`**:还原 `Cls.seatUndo` 的快照

#### 5.5.4 拖拽实现(2799-2848,pointerdown/move/up)
- `Cls.mode === 'seat' && seat.has` → `kind: 'drag'`
- `pointermove` 距离 > 5 → `moved = true` + 创建 `#dragGhost`(头像 54 跟随鼠标)+ 原座位加 `.dragging` class
- 鼠标下方的 `.seat` 加 `.drop-on`
- `pointerup`:如果有 drop-on → `moveSeat`

#### 5.5.5 打印(2619-2636)
- 新开窗口 `window.open('', '_blank')`,写入独立的 HTML(自带 CSS):讲台框 + 表格,相邻两列中间插 `td.gap` 过道
- 底部 `<script>setTimeout(window.print, 300)</script>` 自动调起打印

### 5.6 考勤(att 模式)

- 状态轮转:`[null, 'leave', 'absent', 'late']`(2504)
- 日期选择器 `<input type="date">`,`UI.chg['att-date']`
- 补录任意日期 → `S.attendance[date][sid] = status`
- "全部出勤" `att-clear`:`S.attendance[Cls.attDate] = {}`(整天清空 = 全部默认出勤)
- "导出本月" `att-export` 月度 CSV:
  - 表头:`学号, 姓名, DD(1..31), 请假次数, 缺勤次数, 迟到次数`
  - 筛选 `S.attendance` key 以 YYYY-MM 开头,排序
  - 单元格显示 "请假/缺勤/迟到" 中文
- CSS 半透明:`.seat.ghost` → leave/absent 的学生整个座位半透明

### 5.7 点评(points 模式)

- `openPointPop(st, x, y)`:弹出带理由池的 popover
  - 从 `settings.reasons` 读理由,每个按钮上写"理由 ±N",正数 class='plus' 负数 class='minus'
  - 底部有自定义理由输入 + 快捷 +1 / -1
- `addPoint(sid, d, r)`:
  - unshift 到 `S.points`(新的在前)
  - 当前在教室页就 `drawScene()` + `renderRail()` + `floatAt(seat, '+1', color)` 飘字
- 飘字 `floatAt(seat, text, color)`(2434-2443):
  - 定位到座位头部中心上方 26px
  - SVG `<text>` 带白色描边 stroke-width 4 + paint-order stroke(文字白边)
  - CSS class `.float-pt` 2s 消失动画
  - 1200ms 后 remove
- "全班 +1" `pt-all`(2535):
  - 过滤有座位 && 不是 leave/absent
  - 每人 unshift 一条 `{d:1, r:'全班表现好'}`
  - 全场飘 "+1"
- "积分榜" `pt-board`(2542):
  - 顶部"小组积分":按组加和,降序,圆点颜色 ART.groupColor
  - 下方表格:名次 / 姓名 / 积分 / 加分次数 / 扣分次数
  - 可点学生打开档案
  - "导出 CSV" `pt-export`:日期/姓名/学号/分值/理由
- **本周之星**(前 §5.2):每周一归零(JS 用当前周一计算)

### 5.8 空闲小动画(idleTick, 2683-2699)

- 2.3s 一次 interval,每次挑一个随机学生做动作
- 动作集:`['turn', 'turn', 'turn', 'hand', 'sleep']` (turn 权重高)
- 持续时间:`sleep` 4200ms、`hand` 2400ms、`turn` 1900ms
- 条件:动画开关开 + 不是 reduced-motion + 页面可见 + 当前是 class 页 + 不在点名中 + 不在拖拽中 + 不在悬浮(:hover)
- 老师随机动作:`.t-pupil` translateX ±1.5 像素(瞳孔动),14% 概率 `.point` 2600ms(抬手)

### 5.9 右侧概况栏 Cls.renderRail(2870-2922)

**6 个 section(可能需要滚动)**:
1. **今天** = 日期 + 学期/第几周 + "在籍/男生/女生" trio
2. **今日出勤** = 实到大数字 + 彩色进度条(实到黑/迟到蓝/请假琥珀/缺勤红)+ "请假 X 缺勤 Y 迟到 Z" + 异常学生 mini-list(最多 4 人 + "去点名"按钮)
3. **近 7 天生日** = 最多 5 个,"今天/明天/几天后" + 下年龄 + 一键"祝福"按 AI
4. **最近考试** = 名字 + 平均分 + 及格率/优秀率 + sparkline(历次平均得分率趋势)+ 跳转"查看分析"
5. **待办** = 复选框列表 + 删除 x + 底部"添加一件要做的事"输入(Enter 添加)
6. **班级动态** = 融合最近 12 条 point + records,按时间倒排,最多 6 条
7. **隐私条**:"数据只保存在这台电脑的浏览器里" + "备份"按钮

### 5.10 示例数据切换为真实班级(demo-clear, 2751-2770)

- 弹窗要求填**班级名(必填)+ 学段 + 学校(选填)**
- 清空规则:保留 `S.settings.teacher` 和 `S.settings.ai`,其他全部重置为 defaultState
- 根据学段重设 subjects(小学前 3 科,初中/高中前 6 科)
- save → shell → go('class')

### 5.11 缩放和平移(2793-2829)

- `wheel`:
  - Ctrl/Meta + 滚轮 → zoomAt (缩放因子 = `exp(-deltaY * 0.0022)`)
  - 否则 → 平移 `Cls.view.x/y -= deltaX/Y`
- `pointer`:非 seat 模式按住拖动 → 平移
- `applyView()`:clamp 保证教室不会被拖出屏幕外(至少剩 140 像素)
- `fitView()`:根据舞台尺寸算最大合适缩放(0.68 底 ~ 1.2 顶)
- 教室缩放的 CSS 变换挂在 `#stageInner` 上

### 5.12 顶部工具栏(2782-2787)

- 随机点名按钮(ICON.dice)
- 缩放组:`-` / `适应` / `+`
- 侧栏开关 ICON.side(窄屏时抽屉式显示 rail)

### 5.13 班级为空的空状态(2786)

- 当 `S.students.length === 0`:显示老师头像 + "教室还空着" + "添加学生 / 批量导入" 两个按钮

---

## 6. 学生档案 Stu(2928-3320 行)

### 6.1 名单页列表

- **全局状态** `Stu = {q, filter, sort, dir, tab}`
- 过滤器选项:`all / M / F / cadre / focus / board / bday / noseat`(8 个 chip)
  - `cadre` = `!!s.role`;`focus` = tags 包含"重点关注";`bday` = 本月生日;`noseat` = 未排座
- 排序维度:`no(学号) / name / rank(最近考试排名) / pts(积分,降序) / bday(距下次生日)`,点表头反向
- 搜索:姓名 || 学号 || tag 列表
- 表格列:学号 / 姓名(头像+名字) / 性别 / 座位 / 职务 / 生日(含"今天"红标)/ 主要联系人(姓名+关系+电话)/ 标签(最多 3 个 + "+N") / 排名(含 ↑↓ 变化) / 积分 / 操作
- 点行:`open-stu`(抽屉),点"编辑"按钮:阻止冒泡,`stu-edit`

### 6.2 添加/编辑学生表单 openStudentForm(3002-3044)

**宽弹窗**,字段:
- 姓名(必填,maxlength 20)、性别(seg 切换 M/F)、学号(默认 `nextNo()` = 最大号+1)
- 生日(date 控件)、职务(datalist roleList)、座位(select 全座位列表,**占用的会标 "将挪到空位/将互换"**)
- 标签:TAG_POOL + 已有自定义 tag,每个 chip 可切换;底部"+ 自定义"输入(Enter 添加,无中文输入冲突)
- 家庭结构(select FAMILY_TYPES)、住宿(seg 走读/住校)
- 2 组联系人:姓名/关系(datalist "母亲/父亲/祖母...")/电话/职业
- 家庭备注、学习情况(maxlength 500)、性格与特长、健康情况(maxlength 300)、其他备注
- Foot:新建时勾"保存后继续添加",编辑时底部"删除学生"(红)
- `nextNo()` 智能:从现有学号找最大数字,保持前缀和位宽(如 "2503" + pad)
- 保存时座位冲突**自动互换**:新占的座位原主人去新建的空位,或找下一个空位
- 住校和"住校" tag 同步

### 6.3 档案抽屉 openStudent(3115-3131)

- 右侧 slide-in drawer
- Hero:头像 84 + 姓名(+ 职务 tag) + 学号/性别/年龄/座位/组 + tags
- 工具栏:"AI 写评语" + "家长沟通" + "编辑档案" + 关闭 x
- 5 个标签页:**概览 / 档案 / 成绩 / 成长记录 / 评语**

#### 6.3.1 概览 Tab

- 4 KPI 卡:最近考试总分(+排名+变化)、累计积分(+点评次数)、本月考勤(全勤/N 天未到 + 请假/缺勤/迟到计数)、生日(日期 + "N 天后/就是今天")
- 图表 1:**总分得分率曲线** `CH.lines`,学生自己 + 班级平均(灰) 对比,y 轴 40-100%,末端标签 +"%"
- 图表 2:**学科画像雷达图** `CH.radar`,各科得分率,学生 vs 班级平均
- 下面:学习/性格/家庭/健康 的 info-grid
- 最近 3 条成长记录

#### 6.3.2 档案 Tab

- 基本信息 info-grid
- 家庭与联系人(电话有一键复制按钮 ICON.copy)
- 学习与成长
- 右下角"编辑档案"按钮

#### 6.3.3 成绩 Tab

- 考试表格:考试名+日期、每科分数(**不及格标红 `.dn`**,**缺考显示 "缺考" amber tag**)、总分(粗体)、排名
- "红色为不及格(低于满分的 60%)" 提示
- 下方 **班级排名变化曲线** `CH.lines`,**y 轴反转**(越靠上排名越前):values = `n - rank + 1`,fmt 显示 "第 N" 名

#### 6.3.4 成长记录 Tab

- 新增记录面板:类型(RECORD_TYPES select)+ 日期(date)+ 内容(Enter 直接添加)
- 时间线 `timeline` 展示所有记录(日期 + 类型 tag + 内容 + 删除按钮)
- 下方"点评明细":前 40 条,时间/理由/±N 分值/撤销按钮

#### 6.3.5 评语 Tab

- 顶部:textarea + "AI 生成" + "保存评语"
- 下方评语卡列表(新的在上):每条 日期 + "AI 生成" 或 "手写" tag + 复制 + 删除

### 6.4 删除学生(stu-del, 3097-3107)

- `UI.confirm` 二次确认(danger 风格,红按钮)
- 级联删除:`S.points` / `S.records` / `S.exams[].scores[sid]` / `S.attendance[*][sid]` 全清
- `UI.closeDrawer()`

### 6.5 批量导入(stu-import, 3252-3312)

#### 6.5.1 识别规则 `STU_COLS`(3253)

```js
STU_COLS = [
  ['name',       ['姓名','名字','学生姓名']],
  ['gender',     ['性别']],
  ['no',         ['学号','编号']],
  ['birthday',   ['生日','出生日期','出生年月']],
  ['role',       ['职务','班干部']],
  ['p0name',     ['家长姓名','家长','联系人','监护人']],
  ['p0rel',      ['关系','家长关系']],
  ['p0phone',    ['家长电话','联系电话','电话','手机']],
  ['family',     ['家庭结构','家庭情况']],
  ['familyNote', ['家庭备注']],
  ['study',      ['学习情况']],
  ['personality',['性格','性格特长']],
  ['health',     ['健康','健康情况']],
  ['note',       ['备注','其他备注']]
]
```

- 识别算法:**两趟** — 第一趟全文完全匹配,第二趟前缀匹配(处理 "性别(男/女)"、"家长电话1" 这类列名)
- 清洗表头:去括号内容 `(xxx)`、去空格、冒号 `[(（][^)）]*[)）]` 和 `[\s*：:]`

#### 6.5.2 导入流程

- 弹窗显示 textarea,支持粘贴 Excel(Tab)或 CSV
- 底部"选择 CSV 文件"按钮(FileReader readAsText utf-8)
- "下载模板":`姓名,性别,学号,生日,职务,家长姓名,关系,家长电话,家庭结构,备注` + 1 行示例
- 实时预览:`imp-preview` input 回调计算识别到几人几列
- 导入时:
  - 生日自动规整(把 `/.日年月` 替换成 `-`,再 pad 月日)
  - 性别匹配 `/女|f/i`,其余算男
  - **去重**:同名 + 同学号已存在的跳过(no 不填时也跳过)
  - 家庭:FAMILY_TYPES 直接匹配,不匹配的填 "其他" 并把原文放到 familyNote
  - 可选"自动安排到空座位":`firstEmptySeat()`
- Toast:"导入 N 人,跳过重复 M 人"

### 6.6 导出名单 CSV(stu-export, 3313-3320)

字段:`学号, 姓名, 性别, 生日, 职务, 座位, 家长姓名, 关系, 家长电话, 家庭结构, 家庭备注, 学习情况, 性格特长, 健康情况, 标签(用、拼接), 积分`
文件名:`<className>-学生名单.csv`,带 UTF-8 BOM

### 6.7 其他操作

- `copy-txt`:一键复制联系人电话
- `pt-del`:在成长记录 Tab 撤销某条点评(删除 Points 项)
- `rec-add` / `rec-del`:添加/删除成长记录
- `cmt-add` / `cmt-del`:添加/删除评语
- 全局搜索命中后 `open-stu`:清空搜索框和 pop,然后打开 drawer

---

## 7. 成绩录入 Sc(3322-3547 行)

### 7.1 页面布局

- 左:考试列表 `.exam-list`,每个 item 显示 名字 + 类型 tag + 日期 + 科目数 + 已录进度条 `已录 N/total`
- 右:当前考试的分数网格 + 顶部的 "编辑考试 / 按表头导入 / 导出 / 看分析" 按钮
- 粘贴提示条:教老师怎么从 Excel 粘贴
- 分数单元格:**input 元素**,支持 inputmode=decimal

### 7.2 新建/编辑考试(examForm, 3440-3457)

- 字段:名称(必填)、日期(必填)、类型(chips,EXAM_TYPES 之一)、**科目与满分**
- 科目区:默认把 `settings.subjects` 的所有科 chip 都列出,点一下切换选中(有满分 input)
- 底部可添加新科目(名字 + 满分)
- 保存时**新科目回写到 `S.settings.subjects`** 作为未来默认
- 删除考试:级联清空该考试的所有 scores

### 7.3 成绩单元格行为

#### 7.3.1 `parseScore(t)` (3381)

```
// 支持全角数字 → 半角,去空格
// '' → undefined(清空)
// 匹配 /^(缺|缺考|-|—|\/|x|X)$/ → null(缺考)
// 其他:parseFloat 后 isNaN → undefined,否则返回数字
```

#### 7.3.2 `cellCls(v, full)`(3374)

```
null  → ' miss'(缺考样式)
> full || < 0 → ' bad'(超限红色)
< full * 0.6  → ' low'(不及格红字)
```

#### 7.3.3 输入事件 `onCellInput`

- 实时 `setScore(ex, sid, sub, v)`
- 更新 cell class
- `save()` + `Sc.refreshTotals()`(更新总分 / 排名 / 已录进度)

#### 7.3.4 键盘导航 `onCellKey`

- `Enter / ArrowDown` → 下一行同列(Shift+Enter 上一行)
- `ArrowUp` → 上一行
- `ArrowRight`:光标在末尾 → 右一列
- `ArrowLeft`:光标在开头 → 左一列
- 聚焦时自动 select 全选内容

#### 7.3.5 Excel 粘贴 `onCellPaste`

- 判断是否多值(含 Tab 或换行):否则走默认粘贴
- 多值时阻止默认,用 `parseTable(text, keepEmpty=true)` 解析
- 从当前 cell 开始**行 → 列**依次填入
- 填好后计数 N 个,如果有超满分的提示红色警告
- `save()` + `refreshTotals()`

### 7.4 按表头导入 score-import(3508-3547)

- 弹窗 textarea,**第一行必须是表头**
- 识别**姓名**或**学号**列(姓名列的别名"名字"也支持)
- 识别**科目列**:列名严格 === 考试的某科名
- `findStu(name, no)`:
  - 优先按**学号**精确匹配
  - 否则按**姓名**精确匹配,**重名(多个匹配)时不猜,返回 null** 避免错写
- 实时预览:显示识别到几行、匹配到多少学生、识别到的科目
- 导入:只写 ex.scores,**不改变学生档案**
- 导入完成后 toast 包含"X 行没对上名字"

### 7.5 导出 CSV score-export(3499)

字段:`学号, 姓名, 科目列..., 总分, 排名`
缺考显示"缺考";没录显示空
文件名:`<className>-<exam.name>-成绩.csv`

---

## 8. 成绩分析 An(3549-3653 行)

### 8.1 页面结构

- 顶栏:考试选择 + 对比考试选择 + "AI 写分析报告"按钮
- `An = {exam, cmp}`:当前考试 + 对比考试
- 默认 `An.exam = exs[last]`,`An.cmp = prevExam(ex)`

### 8.2 KPI 行(stat-row)

5 个 KPI 卡:
1. **平均分**(含满分) + delta(与对比考试的得分率百分点变化,显示 "↑/↓ X 个百分点 较<对比考试>")
2. **最高分** + 得主姓名
3. **及格率** + delta
4. **优秀率** + delta
5. **标准差** + "越小说明分数越集中"

delta 的通用逻辑(3572-3577):
- 没有对比 → "—"
- 差值 < 1e-9 → "与上次持平"
- 否则:红绿箭头 + 绝对值 + "较<对比考试>"

### 8.3 图表组 1

- **各科平均得分率**(柱状):y 轴 0-100%,红色参考线 60% "及格",tip 含满分、平均、最高/最低、及格率、优秀率
- **总分分数段**(柱状):10 段,从第一个有人的段开始显示;**配色分段**:>=85% 优秀深蓝、<60% 浅蓝(不及格)、中间常规;柱顶数字为人数
- legend:三色小方块 + 不及格段/及格段/优秀段

### 8.4 历次考试趋势(小多图)

- 多个考试才显示
- "总分" + 所有出现过的科目,各一张迷你折线图
- **各图纵轴一致**:gLo/gHi 由所有数据的 min-4/max+4 向下/上取 5 的倍数,0-100 之间,显示在面板副标题
- 每张图 h=120,2 ticks,末端数字 round1(last) + "%"
- 用 `UI.chart(fn)` 延迟绘制(响应式)

### 8.5 班级排名表 + 需要关注名单

两列 grid:

**左:排名表**(可滚动,max-height 460)
- 列:名次 / 姓名 / 各科(不及格红字) / 总分 / 进退(有对比才显示)
- 进退:ch > 0 "↑N" 绿色,ch < 0 "↓N" 红色,0 "0" 灰
- 点行:open-stu

**右:需要关注**
- **进步之星**:ch > 0 排序,取前 5 名
- **退步 5 名以上**:ch <= -5 排序,取前 6 名
- **两科及以上不及格**:遍历每人统计 n(科目分数 < 60% 的科目数),n >= 2 的按 n 降序,取前 8
- 底部"给退步同学家长写沟通消息"(调 AI 模板 parent-batch)

### 8.6 各科明细表

- 列:科目 / 满分 / 平均分 / 得分率 / 最高 / 最低 / 及格率 / 优秀率 / 不及格人数 / 得分率变化(含对比才显示,百分点)
- 底部提示:"及格 = 满分 60%,优秀 = 满分 85%"

### 8.7 考试选择器变化处理

- 换 exam:`An.cmp = null`(让下次 render 自动找 prevExam)
- 换 cmp:直接 rerender

---

## 9. AI 助手 AI(3655-4248 行)

### 9.1 预设服务商 AI_PRESETS(3658-3669)

```js
AI_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-flash', site: 'platform.deepseek.com', hint: '需要更强的推理可以把模型改成 deepseek-v4-pro' },
  { id: 'qwen',     name: '通义千问（阿里云百炼）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus',    site: 'bailian.console.aliyun.com' },
  { id: 'kimi',     name: 'Kimi（月之暗面）',       base: 'https://api.moonshot.cn/v1',                      model: 'kimi-k3',      site: 'platform.moonshot.cn' },
  { id: 'glm',      name: '智谱 GLM',                base: 'https://open.bigmodel.cn/api/paas/v4',             model: 'glm-4-flash',  site: 'open.bigmodel.cn', hint: 'glm-4-flash 是免费模型' },
  { id: 'doubao',   name: '豆包（火山方舟）',          base: 'https://ark.cn-beijing.volces.com/api/v3',         model: '',             site: 'console.volcengine.com/ark', hint: '模型名填方舟控制台里的模型 ID 或推理接入点 ID' },
  { id: 'silicon',  name: '硅基流动',                 base: 'https://api.siliconflow.cn/v1',                    model: 'deepseek-ai/DeepSeek-V3', site: 'cloud.siliconflow.cn' },
  { id: 'openai',   name: 'OpenAI',                   base: 'https://api.openai.com/v1',                        model: 'gpt-4o-mini',  site: 'platform.openai.com' },
  { id: 'claude',   name: 'Claude（Anthropic）',      base: 'https://api.anthropic.com/v1',                     model: 'claude-sonnet-5-5', site: 'console.anthropic.com' },
  { id: 'ollama',   name: 'Ollama 本地模型',          base: 'http://localhost:11434/v1',                        model: 'qwen2.5:7b',   site: 'ollama.com', hint: '需 OLLAMA_ORIGINS=* 允许网页访问' },
  { id: 'custom',   name: '自定义（OpenAI 兼容接口）', base: '',                                                 model: '',             site: '', hint: '任何兼容 /chat/completions 的服务都可以' }
]
```

### 9.2 AIC(调用客户端, 3673-3741)

- `AIC.ready()`:判断是否可以调用(有 base + model + (key 或 localhost))
- `AIC.isClaude()`:provider === 'claude' 或 base 含 anthropic.com
- `AIC.label()`:面向 UI 显示的"品牌 · 模型",如 "DeepSeek · deepseek-flash"
- `AIC.stream(messages, onDelta, signal, maxTokens)`:**流式 fetch**
  - **Claude 分支**:URL `/messages`,headers 含 `x-api-key`、`anthropic-version: 2023-06-01`、**`anthropic-dangerous-direct-browser-access: 'true'`**;body 分离 system 消息
  - **OpenAI 兼容分支**:URL `/chat/completions`,Bearer token;body 带 model/messages/stream/temperature
  - **流式解析**:
    - content-type 含 application/json 直接 `res.json()`:两分支都覆盖(`choices[0].message.content` 或 `content[0].text`)
    - 否则 reader + TextDecoder,按 `data:` 行解析:`choices[0].delta.content` 或 `content_block_delta.delta.text`
    - `[DONE]` 结束
  - 错误透传:AbortError → 友好 "已停止生成";fetch 失败 → "连不上 AI 服务...可以换 DeepSeek、Kimi,或运行 ai-proxy.js..."
- `AIC.httpErr(status, text)`:401/403 → Key 无效;404 → 地址或模型名不对;429 → 频率/额度;402 → 余额;500+ → 服务出错

### 9.3 隐去姓名 Mask(3744-3771)

- 每个学生有一个**永久 maskSeq**(保存在 `S.settings.maskSeq`),学生对象上有 `s.mk`。即便学生改名/改学号,编号不变。
- `Mask.ensure()`:给没有 `mk` 的学生按 `studentsByNo()` 顺序分配下一个编号
- `Mask.code(s)`:`【学生07】`(mk 两位 pad)
- `Mask.build()` 返回 `{fwd, back}`:
  - fwd:`[[name, 【学生N】], ...]` 按名字长度降序(避免"张三"覆盖"张三丰")
  - back:`{"07": "张三"}`
- `Mask.apply(t)`:启用脱敏时,把 t 中的学生名**全部替换**为编号(split+join)
- `Mask.restore(t)`:正则 `/[【\[]学生(\d{1,3})[】\]]/g`,把编号换回名字(找不到就保留原文)

### 9.4 上下文构造(3774-3846)

#### 9.4.1 `sysPrompt()`

**系统提示词**(所有调用都带):

```
你是一名经验丰富、温和务实的中国中小学班主任助理，熟悉课程标准、班级管理与家校沟通。
写作要求：
1. 使用简体中文，语气真诚具体、有温度，避免空话套话和夸张表述；
2. 用 Markdown 组织内容（标题、列表、必要时用表格），老师可以直接复制使用；
3. 只依据老师提供的信息，不编造具体事实、成绩、奖项或数据；信息不够时用「（可补充：……）」提示老师；
4. 涉及学生时以成长和鼓励为导向，不贴标签，不公开排名羞辱学生，注意保护隐私；
5. 资料里「【学生07】」这样的占位符代表某位学生，请原样保留，不要改写，也不要替换成其他名字。
当前老师：<name>，<school> <className> 班主任<，任教subject>；学段：<stage>。
```

#### 9.4.2 `classContext()`

拼接的"【班级概况】"段:学校、班级、学段、学期、第几周、人数、男女分布、班干部列表、tag 统计、最近考试(名、日期、平均分、及格率、优秀率、各科得分率)、近 30 天点评(加分扣分次数、常见加分/扣分理由前 4)、近期班级记录(最多 6 条,日期+学生名+类型+内容)。

#### 9.4.3 `studentContext(s)`

拼接的"【学生档案】":姓名/性别/年龄/职务/tags;家庭(类型+备注);学习情况;性格特长;健康;其他备注;成绩序列(每场考试总分+班级排名+人数);最近一次考试每科(得分+班均);课堂点评累计分+加分/扣分理由统计;近期成长记录 6 条;考勤累计(请假/缺勤/迟到天数)。

#### 9.4.4 `examContext(ex, cx)`

"【考试数据】":名/日期/类型/人数/满分 + 总分统计(平均/最高/最低/及格率/优秀率/标准差)+ 各科详细(平均/得分率/及格率/优秀率/最高/最低/不及格人数)+ 前 5 名(姓名+总分)+ (若有对比考试)得分率变化、各科得分率变化、进步 5 名以上、退步 5 名以上 + 两科不及格人数(含姓名)。

### 9.5 模板 TPLS(3850-3894)

**分类**:`TPL_CATS = [['rec','推荐'],['teach','教学备课'],['manage','班级管理'],['home','家校沟通'],['grow','学生成长']]`

**模板清单**(15 个,其中 5 个标 rec 推荐,2 个 hidden 隐藏):

| id | cat | 标题 | fields | batch |
|---|---|---|---|---|
| lesson | teach | 备课教案 | 学科+年级+课题*+课时+学情 | — |
| ppt | teach | 课件大纲 | 学科+课题*+页数 | — |
| homework | teach | 分层作业 | 学科+知识点*+每层题量 | — |
| meeting | manage(rec) | 班会课方案 | 主题*+时长+形式+参考本班情况(check) | — |
| activity | manage | 活动策划 | 活动名*+时间地点+参与人数+预算 | — |
| summary | manage | 工作总结 / 计划 | 类型+重点 | — |
| notice | home(rec) | 家长群通知 | 事项*+时间+家长配合 | — |
| parent | home(rec) | 家长沟通话术 | 学生*+事由(select)+具体情况+沟通方式 | — |
| pmeeting | home | 家长会发言稿 | 考试+发言时长+重点 | — |
| comments | grow(rec) | 期末评语(批量) | 学生们*+风格+字数+人称 | ✅ |
| report | grow(rec) | 成绩分析报告 | 考试+对比考试 | — |
| talk | grow | 谈心谈话提纲 | 学生*+话题 | — |
| birthday | grow | 生日祝福 | 学生*+风格 | — |
| comment1 | hidden | 个人评语(单条) | 学生*+风格+字数+人称 | — |
| parent-batch | hidden | 退步同学家长沟通 | 考试+对比+沟通方式 | ✅ |

### 9.6 模板 prompts(原文摘录,附录 A 的核心)

所有 prompts 在 `tpl.build(v)` 返回的 `{title, show, prompt, ctx?, sid?, saveAs?}` 中。重要原文已附录 A 完整摘出。要点:

- `commentPrompt(v)` 生成期末评语的 prompt(3896-3898)
- 每个模板的 build 函数把表单值拼成具体的 user prompt,系统 prompt 是通用的

### 9.7 AI 首页 renderAIHome(3917-3934)

- 大的问候语 + aiAvatar + apiPill(配置状态按钮)
- **composer**(大 textarea + 发送按钮):"直接说要做什么,比如:帮我写一份期中考试后的家长会发言稿..."
  - composer-bar 上有 ctx-chip:
    - **班级概况**(check):是否把 classContext 加入
    - **+ 学生档案**(select):选一个学生加入
    - **+ 考试数据**(select):选一个考试加入
    - **隐去学生姓名**(checkbox,改 settings.ai.mask)
    - 发送按钮(Enter 快捷键,Shift+Enter 换行)
- **tpl-tabs**:TPL_CATS 切换 + "推荐"(rec=1 的)
- **tpl-grid**:选中分类的模板卡片
- **最近对话** list(最多 8 个)
- 底部隐私条:"只有你点击发送时,才会把选中的资料发给你配置的 AI 服务;家长电话等联系方式从不发送"

### 9.8 模板表单 UI.act['ai-tpl'](3956-3987)

- 根据 `tpl.fields` 动态渲染:
  - **text / textarea / select(chip)/ check**:常规表单项
  - **student**:下拉选单(全班学生,支持 data-sid 预选)
  - **exam / exam0**:下拉选单(exam0 多一个 "不对比" 选项)
  - **students**:**checkbox 网格** + "全选/全不选" + 已选计数
- 底部两个按钮:
  - "复制提示词"(永远可用):`copyPromptModal(fullPrompt(job))`,把 sysPrompt + ctx + prompt 整合给用户
  - "开始生成"(配好 AI 才可用):`startChat(job)`
- "ai-mask 开启时" 底部显示:"学生姓名会先替换成编号再发送..."

### 9.9 无 API 的"复制提示词"流程 copyPromptModal(4022-4030)

- 大 prompt-box 展示完整 prompt
- 底部"配置 API,直接生成"按钮(跳设置)和"复制提示词"
- 脱敏开启时自动追加**编号对照表**(折叠的 details)

### 9.10 对话 renderThread(4082-4107)

- 顶部 thread-head:返回新对话 + 标题 + apiPill + 导出 Word + 删除
- 消息列表:
  - user: `.msg.user .bubble`(灰色气泡,右对齐)
  - bot: aiAvatar + 内容 + `.who`("班级助理 · 正在写…")
  - streaming:`#streamMd` id + cursor
  - 错误:`.msg-err` 红框 + "重试" + "检查 AI 设置" + "改为复制提示词"
  - batch:见下
- 消息工具栏:复制 / 导出 Word / 保存为评语(saveAs=comment) / 记到成长记录(有 sid) / 重新生成(最后一条)
- 底部 composer:继续追问(Enter 发送,Shift+Enter 换行);busy 时显示"停止"按钮

### 9.11 流式输出的渲染 updateStreaming(4070-4074)

- requestAnimationFrame 节流
- `innerHTML = mdToHtml(bot.content) + '<span class="cursor"></span>'`
- 自动滚底:只在接近底部(180px 内)时才滚

### 9.12 批量生成(4138-4214)

#### 9.12.1 jobs 构造(4139-4149)

- `comments`:每位选中学生一个 job,prompt = `Mask.apply(studentContext(s) + '\n【任务】\n' + commentPrompt(v))`
- `parent-batch`:过滤出 ex.rank - pe.rank <= -5 的学生,每位一个 job

#### 9.12.2 启动 startBatch(4156-4169)

- 创建 chat,`batchOnly: true`(不允许追问),`saveAs: 'comment'`(如果是评语)
- `msgs[0]` 是 user 一条总览,`msgs[1]` 是 assistant 的 batch 容器 `{batch: {kind, items: [{sid, prompt, text, st}]}}`
- items.st:`'wait' | 'run' | 'done' | 'err'`

#### 9.12.3 执行 runBatch(4170-4186)

- **串行**(for 循环+Promise 链),一次只跑一个 job
- 单条:AIC.stream → onDelta 实时更新 `#bt-<sid>` 元素的 textContent
- 成功:`st='done'`,文本 trim
- 失败:AbortError → 'wait'(可继续);其他 → 'err'
- 全部完成或 abort 时结束

#### 9.12.4 UI batchHTML(4187-4203)

- 顶部:进度条 + 完成/总数;"继续生成"(有失败时);"全部保存到档案"(评语)
- 每条:学生头像+名字+状态 tag(排队中/生成中/失败/完成)+ 完成后"复制" + "保存到档案"
- 文本区域 `#bt-<sid>`:实时流式更新

### 9.13 Markdown 渲染 mdToHtml(4216-4243)

**"够用版"**:
- Inline:`\`code\``、`**粗体**`、`*斜体*`
- Headings:`#` ~ `####`(限制到 `<h3>`)
- 分隔线:`---` 或 `***`
- 无序列表:`- *` 或 `•`
- 有序列表:`\d+[.、)]`
- 引用:`> `(esc 后是 `&gt; `)
- 表格:`|...|` 行,包含 `:-{2,}` 分隔线行
- 段落:连续非空行用 `<br>` 拼接,空行分段

### 9.14 导出 Word(4244-4248)

- 组装 HTML(含 Office XML namespace),`<style>` 用宋体 SimSun 12pt;**UTF-8 BOM**(`'﻿'`)避免 Word 乱码
- 文件扩展名 `.doc`,MIME `application/msword`
- 文件名清洗(替换 Windows 禁用字符)

### 9.15 保存评语/成长记录(4118-4125)

- `msg-save-cmt`:assistant 消息 trim 后 push 到 `stuById(c.sid).comments`,src='AI',当前日期
- `msg-save-rec`:转为成长记录,类型='其他',text 清洗 Markdown 符号(`[#*>\`]`) 后截 200 字

---

## 10. 设置 SetP(4250-4402 行)

### 10.1 7 个分区 SET_SECS

`[['class','班级信息'],['teacher','教师形象'],['room','教室与黑板'],['subjects','学科与点评'],['ai','AI 接口'],['data','数据与备份'],['about','关于']]`

### 10.2 班级信息

- 班级名称 / 学校 / 学段(select 小学/初中/高中)/ 年级 / 学期 / 开学日期

### 10.3 教师形象

- 男/女两张大头像卡,点选 + 显示在卡片上
- 称呼 / 任教学科

### 10.4 教室与黑板

- **排数**:4/5/6/7/8/9 chip
- **组数**:2/3/4/5 chip
- **mini-class 预览**:14×14 的小格子矩阵,显示当前布局
- **小动画开关**(settings.anim)
- **黑板内容**:
  - 左黑板 textarea `boardLeft`(今日课程)
  - 右黑板 textarea `boardRight`(今日事项)
- **倒计时**:名称(countdown.label) + 日期(countdown.date)

**改小时的保护** `fixSeats()`:遍历学生,如果座位行列超出新尺寸就置 null;`autoGroups()`;`Cls.view.fit = true`。

### 10.5 学科与点评

- **科目列表**:每个 chip + 满分 input + × 删除
- "添加科目"输入:名字 + 满分
- "按学段重置":根据 stage 重置为 SUBJECT_PRESETS
- **点评理由列表**:每个 chip + 分值 input + × 删除,**+ 分绿底、- 分红底**
- "添加理由"输入:理由 + 分值(默认 +1)

### 10.6 AI 接口

- 服务商 select(10 项,见 §9.1)
- 服务商变更时:非 custom 自动填入该 provider 的 base/model(覆盖已填)
- API Key(password + 眼睛按钮切换显示/隐藏)
- Base URL / 模型名
- temperature(number, 0-1.5, step 0.1)
- 隐去学生姓名 checkbox
- **测试连接**:发一条 "请只回复四个字:连接成功" 的 user 消息(maxTokens=20),显示耗时 + 回复预览
- "连不上" 提示:换服务商 / 用 ai-proxy.js

### 10.7 数据与备份

- 当前数据统计:学生/考试/点评/成长记录/AI 对话数
- 占用空间:`(Store.get(STORE_KEY).length / 1024).toFixed(1) KB`
- 上次备份时间
- 存储状态(禁用 localStorage 的红字提醒)
- **导出备份**:`JSON.stringify(S, null, 1)`(1 空格缩进),文件名 `班主任工作台备份-<className>-YYYY-MM-DD-HHMM.json`,`settings.lastBackup = Date.now()`
- **从备份恢复**:FileReader readAsText utf-8 → JSON.parse → 基础校验(有 settings 和 students 数组)→ 二次确认 → `migrate()` → save → shell + go class
- "载入示例班级":`demoState()` 覆盖,保留 teacher 和 ai 设置
- "清空全部数据":`defaultState()` + 保留 teacher 和 ai + onboarded=true

### 10.8 关于

- Logo + 标题 + VERSION
- 简介
- 开源协议说明
- @赛博老爸 署名

---

## 11. 启动 boot(4404-4463)

### 11.1 Welcome 欢迎页(首次使用)

- 大 Logo 居中
- "你好,我是你的班主任工作台" + "先选一个你的形象,它会站在教室讲台上"
- 两个大头像(96 size):**女老师 / 男老师** 卡片切换 Welcome.g
- 表单:
  - **怎么称呼你**(default "李老师" 或 "王老师" 根据性别自动切换,除非用户已改)
  - **任教学科**
- **两个大模式按钮**:
  - **先看看示例班级**:46 名虚拟学生 + 4 次考试
  - **直接用我的班级**:空教室,会显示"班级名称 + 学段"输入
- "开启工作台":
  - demo 模式:`demoState()` + 覆盖 teacher
  - blank 模式:`defaultState()` + 班级名/学段/科目预设 + teacher
  - 设置 `onboarded=true`,fade out welcome,`UI.shell()` + `UI.go('class')`
- 底部隐私提示 + @赛博老爸

### 11.2 boot 入口(4451-4458)

```js
function boot() {
  S = load();
  if (!S || !S.settings.onboarded) { S = defaultState(); showWelcome(); return; }
  UI.shell();
  var h = (location.hash || '').replace('#/', '');
  UI.go(UI.pages[h] ? h : 'class');
  if (!Store.ok()) setTimeout(() => UI.toast('浏览器禁止了本地存储...'), 800);
}
```

### 11.3 hashchange 响应

location.hash 变化(用户点浏览器前进/后退)时,如果是有效的 page name 就 `UI.go(h)`。

---

## 12. 右侧概况栏 Cls.renderRail

见 §5.9 已经写了。

---

## 13. 全局交互

### 13.1 鼠标悬停学生

- `mouseover`/`mouseout` 事件在 `#stage` 上监听
- 命中 `.seat.has` 或 `.teacher` → `scheduleCard(el)`(220ms 延迟)避免抖动触发
- 卡片离开 → `scheduleHide()`(180ms 延迟)
- 卡片本身的 mouseenter 取消 hide,mouseleave 触发 hide → 鼠标可以从座位移到卡片上

### 13.2 空座位点击

- `.seat.empty` 点击 → `openStudentForm(null, {seat: key})` 预填座位的新建学生弹窗

### 13.3 侧栏/概况栏切换

- CSS 类 `.app.with-rail`:显示右侧 rail
- 窄屏 CSS 隐藏 rail
- `.rail-toggle` 按钮加 class `.app.rail-open` 让 rail 以抽屉形式弹出

### 13.4 键盘

- 全局 Escape 关 pop/modal/drawer/pick-card(优先级)
- Enter:全局搜索框跳第一条;评语/待办/成长记录输入框 Enter 确认
- isComposing 判断(中文输入法):只在非输入状态下处理 Enter

### 13.5 响应式

- `window.resize` 120ms 防抖 → `UI.drawCharts()` + 当前页的 `resize()`(class 页会 `relayout()` 重新适应)
- `.app.with-rail` 媒体查询在窄屏下隐藏 rail

### 13.6 快捷键

**没有定义全局快捷键**(除了 Enter 和 Escape)。

### 13.7 全屏

- "全屏" 按钮(浮在右上) → `requestFullscreen()`
- `fullscreenchange` 事件回调 `updateFsBtn` + 重 layout
- CSS `:fullscreen` 隐藏侧栏/rail

### 13.8 Ctrl+V 粘贴成绩

- 教室页里挂在 `.grid-tbl` 的 paste 事件(§7.3.5)

---

## 14. 工具函数(1385-1407 行附近)

见 §1.1 的工具段落已经列全:`esc / uid / $ / $$ / clamp / round1 / pad2 / todayStr / parseDate / daysBetween / fmtMD / fmtShort / fmtTime / sum / avg / fmtNum / pct / deepClone`。

ART 内另有:`hash(str)` FNV-1a 哈希;`rng(seed)` 伪随机数生成器(用于稳定的"随机"效果,如桌上物品布局)。

---

## 15. 导入导出字段映射

### 15.1 学生导入识别(§6.5.1)

见 STU_COLS 完整表。清洗规则:
- 去括号内 `[(（][^)）]*[)）]`
- 去空格 冒号 `[\s*：:]`
- 两趟匹配:先完全匹配,再前缀匹配

### 15.2 学生导出 CSV(§6.6)

字段 16 列:`学号, 姓名, 性别, 生日, 职务, 座位, 家长姓名, 关系, 家长电话, 家庭结构, 家庭备注, 学习情况, 性格特长, 健康情况, 标签, 积分`

### 15.3 成绩按表头导入(§7.4)

- "姓名" 或 "名字" 列必有
- "学号" 列优先匹配(名字相同时)
- 科目列**严格 ===** 考试的某科名(不像学生导入那样支持别名)

### 15.4 成绩导出(§7.5)

字段:`学号, 姓名, <科目列...>, 总分, 排名`

### 15.5 考勤导出(§5.6)

字段:`学号, 姓名, <日期列(MM-DD)>, 请假, 缺勤, 迟到`
- 日期范围:当前 `Cls.attDate` 的那个月(YYYY-MM)
- 日期单元格值:中文"请假/缺勤/迟到"或空

### 15.6 点评导出(§5.7)

字段:`日期, 姓名, 学号, 分值, 理由`

### 15.7 示例模板

`UI.act['imp-template']`:下载 `学生名单模板.csv`:
```
姓名,性别,学号,生日,职务,家长姓名,关系,家长电话,家庭结构,备注
张三,男,01,2012-05-06,,张建国,父亲,13800000000,双亲家庭,
```

### 15.8 全量 JSON 备份(§10.7)

- 文件名:`班主任工作台备份-<className>-YYYY-MM-DD-HHMM.json`
- 格式:`JSON.stringify(S, null, 1)`,1 空格缩进
- 内容:整个 S 对象(settings + students + exams + attendance + points + records + todos + chats)

---

## 16. 新项目重写时需要特别注意的坑

### 16.1 全局状态 S 挂在 window 顶层

- `var S` 在 `<script>` 顶层,**整个 JS 共享**
- 任何业务都是 `S.students / S.points / S.exams...`
- `save()` 把整个 S 序列化回 localStorage,**改任何子属性都要调 save()**
- 新项目用 React 时,这个"全局单一真实源"要换成**后端 API + TanStack Query 缓存**,或**全局 store**(Zustand/Redux)

### 16.2 没有响应式(非 React),所有渲染靠手动调用

- 代码里到处见 `drawScene()`, `Cls.renderRail()`, `renderDock()`, `Stu.renderTable()`, `openStudent()`
- 改一个点评:`save() + drawScene() + Cls.renderRail() + floatAt()`
- 新项目用 React 后,大部分这种"主动渲染"消失,但要**同步正确**地做 cache 失效(TanStack Query 的 invalidate)

### 16.3 事件代理 `data-act` 一套字典

- 代码里几百个 `data-act="xxx"`,对应 `UI.act['xxx']` 函数
- **移植到 React 时**,这些要变成 onClick handler 或 useCallback,**要注意闭包和 stale state**
- 原项目因为是全局 S,闭包问题不存在;React 要用 ref 或者直接从 store 读

### 16.4 SVG 字符串拼接 → React JSX

- 原项目的 ART 模块都是**字符串拼接**(`'<rect ...>'`),innerHTML 一次性塞
- React 下必须拆成 JSX 组件
- **性能权衡**:教室 46 个学生 + 大量装饰元素,如果每次都重新渲染可能卡;要用 `React.memo` 或 SVG `<use>` 做复用
- 推荐实现思路:
  - **背景层**(房间、黑板、讲台)用一个 `<ClassroomBackground>` 组件,只在布局/黑板变化时重渲
  - **学生层**用 Virtualized 或分组 memo,只在该学生 view 变化时重渲
  - 动画(回头、举手)仍用 CSS class 切换 + CSS keyframes

### 16.5 CSS 变量 → Tailwind 还是 CSS Modules

- 原项目 400+ 行 CSS,`:root` 定义了一套品牌 token
- 新项目用 Tailwind:
  - 把 `:root` 变量迁到 `tailwind.config.ts` 的 colors / radius / shadow / fontFamily
  - 组件内保留少量 inline SVG style
  - CSS 变量方案:也可以保留 CSS 变量到 `app/globals.css`,Tailwind 的 `bg-[var(--blue)]` 内联引用

### 16.6 AI 调用从前端直连 → 后端 Gateway

- 原项目直接 fetch 到 AI 服务商,CORS 和 Key 泄露都是前端问题
- 新项目(B 端 SaaS)**所有 AI 调用走后端 Gateway**:
  - 前端只传 `{template_id, context_refs: {student_ids, exam_ids}, user_prompt}`
  - 后端拉取数据 + 应用脱敏 + 组装 prompt + 调用 LLM + 流式返回
  - API Key 在后端配置(学校级),前端完全不碰
- **脱敏逻辑**整个搬到后端的 AI Gateway,`Mask` 工具可以直接改成后端的工具函数

### 16.7 "一次性 innerHTML 替换"的性能

- 原项目很多列表 render 用 innerHTML 整体替换(排名表、名单表)
- React 下用正常的 map + key 就行,但要注意 **key 不要用 index**(排序时会错位)
- 用 `student.id` / `exam.id` 作 key

### 16.8 localStorage 容量 vs 后端数据库

- localStorage 典型 5-10MB,原项目一个班 46 人 + 4 考 ≈ 50KB,还有巨大余量
- 新项目后端用 PostgreSQL,**写入要考虑并发**(多个老师同时录成绩)
- 迁移上原项目的"save() 全量写"模式**绝对不能保留**,得按资源单条 CRUD

### 16.9 时间字段的大坑

- 原项目:日期是本地字符串 `YYYY-MM-DD`,时间戳是 ms
- 考勤 key 是本地日期字符串(受浏览器时区影响)
- 新项目后端:全部用 ISO 8601 + UTC 存储,前端显示时转时区;特别考勤这种"校园当地日期"要存 `school_timezone`

### 16.10 "脱敏 Mask" 的 maskSeq 从哪里来

- 原项目的 `s.mk` 是**每个学生永久不变的编号**,改学号也不变
- 新项目的 Student 实体最好同样有一个独立的 `mask_code INT`(或 UUID 的后 4 位),**不依赖主键**(不希望 AI 对话里出现数据库 ID)

### 16.11 示例数据的随机性

- `demoState()` 用了固定 seed(20261029)的 PRNG → **每次示例班级都一样**
- 新项目的"演示模式"也要**可复现**,方便售前演示

### 16.12 原项目的"ok hooks"

**没有专门的 "ok hooks"**。所有"编辑后立即渲染"的逻辑都是**手动写在每个 action 结尾**:`save() + 相关 renderXxx()`。

### 16.13 Markdown 渲染

- 原项目 `mdToHtml` 是**纯函数**版本,"够用"
- 新项目可以直接用 `react-markdown` + remark-gfm(表格)+ 自定义 code 组件
- 导出 Word:保留原逻辑(拼 HTML + application/msword MIME),这个"民间约定"在新项目也适用

### 16.14 流式输出 UI

- 原项目用 requestAnimationFrame 节流 + `#streamMd` 元素 innerHTML
- React:用 `useState` + `useReducer` 累加 chunks;要节流(每 100ms)避免 re-render 过频;`autoscroll` 要判断用户是否手动滚动过(接近底部才自动滚)

### 16.15 UI 组件库选择

- 原项目的"按钮/卡片/弹窗"全是自写 CSS
- 新项目用 shadcn/ui + Tailwind 可以快速搭骨架,**教室可视化部分保持纯 SVG + CSS**(shadcn 不管这块)
- 配色体系从 CSS 变量移到 shadcn 的 CSS 变量(--primary、--secondary 等),或直接做自定义 theme

### 16.16 排座算法要特别注意

- `moveSeat` 的"交换"行为(不是插入)
- "优带弱同桌" 需要最近有考试(新项目可以放宽:用班级平均来算)
- 原项目**没有考虑**"固定座位"(例如视力不好必须坐前排):新项目可以加 `student.seat_preference` 字段

### 16.17 考勤状态轮转

原项目的轮转 `null → leave → absent → late → null`,**不含出勤**(默认即出勤)
新项目可以显式四状态存储(便于区分"没录"vs"确认出勤"),但 UI 行为可以保留轮转

### 16.18 单文件 36KB 的函数命名习惯

- 没有 TypeScript 类型
- 简短无前缀(如 `S / Cls / Stu / Sc / An`)
- 迁移时**必须加类型**,这些名字可能和 React/库里的东西冲突

---

## 附录 A: AI Prompt 模板原文

**系统提示词(sysPrompt,3774-3782)**:见 §9.4.1 完整原文。

### A.1 commentPrompt(期末评语)

```
请为这位同学写一段期末评语。
风格：<style>；字数：<len>；人称：<person>。
要求：从档案、成绩、点评和成长记录里找 1–2 个具体细节来写，
先肯定优点，再用委婉、可操作的方式提出 1 条期望；
不要出现排名和分数，不要套话；只输出评语正文，不要标题和其他说明。
```

### A.2 lesson(备课教案)

```
请为<stage><grade><subject>《<topic>》写一份完整教案（<hours>）。
结构：
一、教学目标（核心素养导向）；
二、教学重难点；
三、教学准备；
四、教学过程（导入、新授、练习、小结、作业，每个环节写清时间、教师活动、学生活动和设计意图，用表格呈现）；
五、板书设计；
六、分层作业（基础、提高、拓展）；
七、课后反思提示。
<如有>学情与要求：<extra>
```

### A.3 ppt(课件大纲)

```
请为<stage><subject>《<topic>》设计课件大纲，<pages>。
每页写：页标题、要点（不超过 4 条）、互动或提问设计、配图建议。
最后给出 3 条讲课节奏提醒。
```

### A.4 homework(分层作业)

```
请为<stage><grade><subject>「<topic>」设计分层作业：
基础层、提高层、拓展层各 <count>，题目贴近生活、难度梯度清晰。
每层后面给出参考答案和简短讲评要点，
最后说明每层适合哪类同学。
```

### A.5 meeting(班会课方案)

```
请设计一节主题班会课方案。
主题：<theme>；时长：<dur>；形式以<form>为主。
内容：
- 活动目标
- 课前准备（含学生分工）
- 活动流程（每个环节写时间、做法和主持词要点）
- 互动环节设计
- 班主任总结发言（300 字左右）
- 课后延伸。
```
useClass=true 时追加 classContext。

### A.6 activity(活动策划)

```
请为「<name>」写一份班级活动策划书。
时间地点：<when>；参与：<people>；预算：<budget>。
包括：
- 活动目的
- 活动内容与流程（时间表）
- 人员分工（可以安排班干部）
- 物资与预算清单
- 安全预案
- 宣传与总结方式。
```
附 classContext。

### A.7 summary(工作总结 / 计划)

```
请根据下面的班级数据写一份班主任<kind>，1500 字左右。
结构：
- 班级基本情况
- 主要工作与成效（班风学风、学业、德育与活动、家校沟通、安全）
- 存在的问题
- 下一步措施。
数据要引用得具体，但不要罗列学生全名排名。
<如有>老师希望重点写：<focus>
```
附 classContext + 最近考试 examContext。

### A.8 notice(家长群通知)

```
请写一条发在家长微信群里的班级通知。
事项：<matter>；时间：<when>；需要家长配合：<need>。
要求：开头称呼「各位家长」，分点写清时间、地点、要求，
语气礼貌简洁，300 字以内，结尾请家长收到回复。
再额外给一个 100 字以内的精简版。
```

### A.9 parent(家长沟通话术)

```
请帮我准备与这位同学家长的沟通内容，
形式：<channel>；事由：<reason>。
<具体情况：detail>
要求：
- 先肯定孩子的优点
- 再具体说明情况和事实
- 提出 2–3 条家校可以一起做的具体办法
- 语气尊重、不指责家长
- 微信消息控制在 250 字以内
- 提纲要分点并预判家长可能的回应。
```
附 studentContext。

### A.10 pmeeting(家长会发言稿)

```
请写一份班主任家长会发言稿，时长约<mins>（按每分钟 200 字估算）。
结构：
- 问候与感谢
- 班级近况
- 考试情况分析（整体与各科，只说群体数据，不点名批评）
- 表扬进步（可以点名表扬）
- 存在的问题
- 家校配合建议（具体可执行）
- 结束语。
<如有>重点强调：<focus>
```
附 classContext + examContext。

### A.11 report(成绩分析报告)

```
请根据考试数据写一份班级成绩分析报告。
结构：
一、总体情况（用表格列出关键指标）；
二、各科分析（优势与薄弱）；
三、学生层面（进步、退步、学困生，给出关注建议）；
四、原因分析（可能的原因，标注需要老师核实）；
五、下一步措施（班主任与各科老师分别做什么）。
```
附 examContext(ex, cx)。

### A.12 talk(谈心谈话提纲)

```
请帮我准备一次与这位同学的个别谈心谈话。
话题：<topic || 近期状态>。
给出：
- 谈话目标
- 合适的时间地点
- 开场白（2 种）
- 倾听与提问清单（开放式问题）
- 可能的情况与应对
- 最后的小约定和后续跟进方式。
语气要像一位信任孩子的老师。
```
附 studentContext。

### A.13 birthday(生日祝福)

```
今天是这位同学的生日，请以班主任的口吻写 3 段不同的生日祝福（<style>风格），
每段 60 字以内，结合 TA 的特点，不要提成绩排名。
```
附 studentContext。

### A.14 parent-batch(退步同学家长沟通,每人一条)

```
<studentContext>
【任务】
这位同学在「<ex.name>」中比「<pe.name>」退步了 N 名。
请写一条给家长的<channel>：
- 先肯定孩子的优点
- 再客观说明变化（不要直接说排名，用各科表现描述）
- 提出 2 条家校配合的具体办法
- 语气尊重温和，250 字以内。
只输出正文。
```

### A.15 批量总览组合 prompt(batchCombinedPrompt, 4150-4155)

当无 API 时,`copyPromptModal(batchCombinedPrompt(tpl, v))` 会一次给出所有人的组合 prompt:

```
<sysPrompt>

下面有 N 位同学的资料，请逐一完成任务，每位同学用「### 【学生编号】」或「### 姓名」作为小标题分隔。

=== 第 1 位 ===
<job[0].prompt>

=== 第 2 位 ===
<job[1].prompt>
...
```

---

## 附录 B: localStorage 字段完整列表

参见 §1.2 - §1.7 已完整列出 S.* 结构。关键顶层字段:

- `v: 1`(状态版本号,未使用)
- `demo: boolean`(是否示例数据)
- `settings: {...}`(含 school/className/stage/grade/term/termStart/countdown/teacher/rows/pairs/subjects/boardLeft/boardRight/reasons/anim/ai/lastBackup/onboarded/maskSeq)
- `students: []`(含 id/name/gender/no/seat/group/birthday/role/tags/boarding/parents/family/familyNote/study/strengths/personality/health/note/comments/mk)
- `exams: []`(含 id/name/date/type/subjects/scores)
- `attendance: {}`(以日期为 key,内嵌 sid→'leave|absent|late')
- `points: []`(含 id/sid/d/r/t)
- `records: []`(含 id/sid/type/text/date)
- `todos: []`(含 id/text/done,老师私人待办)
- `chats: []`(AI 对话历史,含 id/title/date/tpl/sid/saveAs/batchOnly/msgs)

隐藏字段:
- `student.mk`:脱敏编号(1 开始的整数,pad2 显示为 "01" ~ "99")
- `settings.maskSeq`:全局 mask 序列号最大值

---

## 结语

本考古报告总长度约 500+ 节内容,**覆盖了原项目的全部可移植知识点**。

**新项目(三角色 B 端 SaaS)重写时的使用方式**:
1. **数据模型**:§1 的 S schema 对照 spec 的 Enrollment/Attendance/Score/Review 等实体做映射
2. **教师角色功能**:§5 - §9 直接当做教师角色视图的 PRD
3. **UI 交互细节**:§13 补齐所有小细节(悬停回头、随机点名、排座动画、积分飘字)
4. **AI 层**:§9 + 附录 A,所有 prompt 搬到新后端的 AI Gateway 作为模板
5. **数据脱敏**:§9.3 Mask 工具原封搬到后端
6. **CSV/Excel 导入导出**:§6.5 / §7.4 / §15 的字段映射规则直接复用
7. **重写时的坑**:§16 清单在每个阶段开发前过一遍

**不覆盖的内容**(有意省略):
- SVG 具体坐标的像素级细节(§2 给了布局公式和颜色,具体画法新项目用 React/CSS 重做)
- CSS 样式的具体数值(颜色和 token 已列,其余看原文)
- JavaScript 的具体实现代码(本文把算法和结构讲清楚,具体代码新项目用 TypeScript 重写)

---

## 附录 D: 上游 v1.1.0 新增功能摘要(班级设置 · 桌椅排列)

> 本报告正文对应基线 v1.0.0(上游提交 `0bcff76`,即仓库里的 `reference-html/index.html`)。上游 2026-11-02 发布 v1.1.0(提交 `a49bd54`),`reference-html/` **未更新**;本附录用自己的话概括 v1.1 新增的行为,供 M2d 对标。逐项处理方式见 [M2d 范围清单](../docs/superpowers/plans/2026-11-03-M2d-范围清单.md),基线说明见 [`BASELINE.md`](BASELINE.md)。

### D.1 新增的班级设置项

| 设置 | 取值 | 默认 | 说明 |
|---|---|---|---|
| 每张桌子坐几人 | 1 单人单列 / 2 双人同桌 / 3 三人一排 | 2 | v1.0 只有双人同桌 |
| 每排几张桌子 | 单人 2~12、双人 1~6、三人 1~4 | 单人 8、双人 4、三人 3 | v1.0 的"组数"变成"每排桌数";座位列数 = 桌数 × 每桌人数 |
| 排数 | 2~10 | 6 | 自己设定时可调 |
| 行列方式 | 按人数自动排 / 自己设定 | 新班级:自动 | 旧数据升级为"自己设定",排列不变 |
| 新同学找空位的顺序 | 横着 / 竖着 | 横着 | 选过"按学号横 / 竖排"后记住 |
| 讲台左边、右边的单人桌 | 各 0~2 张 | 0 | 1 号紧挨讲桌,2 号在外侧 |
| 教室名称 | 文本,最多 30 字 | 空 | 显示在教室页顶部和座位表上 |

### D.2 自动排行列

- 只算"需要排进普通座位的人":讲台边坐着人的不算。
- 先尽量保持现在每排的桌数,只增减排数:排数 = 人数 ÷ 每排座位数向上取整,但最少 4 排;超过 10 排才换每排桌数。
- 换桌数时在所有可选桌数里打分取最小:空座数 × 0.5(人少时最少 4 排造成的空位不算)+ |排数 − 6| × 2 + |每排座位数 − 8| × 1.5;都超过 10 排时取 10 排 × 最宽。
- 没有学生时 6 排、默认桌数。
- 添加、删除、批量导入学生后自动重算;行列变了就按"保持"重排(已坐好的不动)。教室坐满时添加学生,座位一栏默认"自动加座位",保存后多出一排。

### D.3 学生坐哪儿(重排方式)

- **保持**:座位仍存在且没被占的同学不动;座位没了的同学按原来从前到后、从左到右的顺序坐进空位;在设置里点保存时,原来没座位的同学也按学号依次补进剩下的空位。
- **按学号横着排**:学号按数字大小排,第一排最左边开始,往右坐满一排再下一排。
- **按学号竖着排**:一组(一张桌子那一竖列)从前往后坐满再下一组;单人单列时一列一列来。
- 讲台边的同学在任何重排里都不动;讲台边那张桌子被撤掉时,他按"座位没了"处理。

### D.4 讲台两边的座位

- 座位编号与普通座位分开(左 1、左 2、右 1、右 2);新同学入座、重排、随机打乱、优带弱、男女同桌都不会动到,只能手动拖进拖出或在学生表单里选。
- 座位文字:"讲台左边 / 讲台右边",一边有两张时加"靠讲桌 / 外侧"。
- 小组:讲台左边的同学算第一组,右边的算最后一组。
- 画面:讲台地台随两侧桌子加宽,讲桌和老师仍在正中;放作业筐的位置被桌子占了就挪到外侧,放不下就不画。

### D.5 排座模式与打印的变化

- 小组 = 一张桌子那一竖列;单人单列时相邻两列算一组。
- 三人一排时,"优带弱"每桌放成绩前、中、后各一人(第 1 名、正中间那名、最后 1 名为一桌,依次类推);"男女同桌"每桌男女交替。单人单列时这两个按钮隐藏。
- 排座模式里多了"桌椅排列"按钮,打开班级设置。
- 打印座位表:每张桌子之后留过道;讲台那一行把两侧座位也打出来(左边外侧在最左);标题下一行是"学校 · 教室 · 日期 · 讲台在上方"。

### D.6 班级设置对话框

- 入口:教室右上角齿轮;排座模式"桌椅排列";设置页"教室布局"里的"调整桌椅排列"(设置页原来的排数 / 组数按钮删掉,改成摘要 + 小预览)。
- 内容:班级名称、教室;每张桌子;行列(自己设定时两个步进器);讲台两边(两个 0~2 步进器);学生坐哪儿(三选一,说明文字随选项变)。
- 右侧实时预览:小方块画出讲台、两侧座位和每排桌子,有人的填色;下方写座位总数构成和学生人数,座位不够时红字提醒、有人未排座时提示去排座模式拖。
- 底部:学生人数,以及"添加学生 / 批量导入 / 管理名单"(先保存再跳)。
- 保存:桌椅或座位有变化才重排,提示"已保存,座位已按新桌椅排好"或"已保存"。

### D.7 与新项目无关的改动

- 设置 → 关于:新增原作者的开发者信息(署名与联系方式)。新项目不跟。
- README / CHANGELOG / 截图更新。
