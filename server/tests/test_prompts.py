"""逐模板的任务文字断言:每个模板至少锁住一句关键句与字段代入(L18)。"""

import pytest

from app.ai.prompts import TASKS, task_text
from app.ai.templates import TEMPLATES

STAGE = {"stage": "小学"}

# (模板 id, 表单值, 额外参数, 必须出现的关键句)
CASES = [
    (
        "lesson",
        {"grade": "三年级", "subject": "语文", "topic": "秋天的雨", "hours": "2 课时"},
        STAGE,
        [
            "请为小学三年级语文的课题《秋天的雨》编写一份完整的教学设计（2 课时）。",
            "六、分层作业（基础、提高、拓展三档）",
        ],
    ),
    (
        "ppt",
        {"subject": "数学", "topic": "分数的初步认识", "pages": "15 页左右"},
        STAGE,
        ["请为小学数学《分数的初步认识》设计一份课件大纲，篇幅15 页左右。", "配图建议"],
    ),
    (
        "homework",
        {"grade": "三年级", "subject": "数学", "topic": "两位数乘法", "count": "5 题"},
        STAGE,
        ["设计一套分层作业，基础层、提高层、拓展层各5 题。", "每层之后附参考答案"],
    ),
    (
        "meeting",
        {"theme": "诚实守信", "dur": "40 分钟", "form": "讨论交流"},
        STAGE,
        ["请为一节主题班会设计活动方案。", "主题：诚实守信；时长：40 分钟；主要形式：讨论交流。"],
    ),
    (
        "activity",
        {"name": "秋季研学", "when": "", "people": "", "budget": ""},
        STAGE,
        ["请为班级活动「秋季研学」写一份策划书。", "时间地点：未定；参与人员：未定；预算：未定。"],
    ),
    (
        "summary",
        {"kind": "学期工作总结", "focus": "班风建设"},
        STAGE,
        ["请依据上面的班级资料写一份班主任学期工作总结，篇幅约 1500 字。", "希望重点写：班风建设"],
    ),
    (
        "notice",
        {"matter": "下周一春游", "when": "周一 8:00", "need": "准备午餐"},
        STAGE,
        [
            "请拟一条发到家长微信群的班级通知。",
            "事项：下周一春游；时间：周一 8:00；需要家长配合的事：准备午餐。",
        ],
    ),
    (
        "parent",
        {"channel": "微信消息", "reason": "表扬进步", "detail": "本周作业全对"},
        STAGE,
        ["沟通方式：微信消息；事由：表扬进步。", "具体情况：本周作业全对", "- 先说孩子的长处"],
    ),
    (
        "pmeeting",
        {"mins": "15 分钟", "focus": ""},
        STAGE,
        ["请写一份班主任在家长会上的发言稿，时长约15 分钟（以每分钟约 200 字估算篇幅）。"],
    ),
    (
        "comments",
        {"style": "温暖鼓励", "len": "100 字左右", "person": "第二人称（你）"},
        STAGE,
        [
            "请为这位同学写一段期末评语。",
            "风格：温暖鼓励；字数：100 字左右；人称：第二人称（你）。",
        ],
    ),
    (
        "comment1",
        {"style": "朴实真诚", "len": "150 字左右", "person": "第三人称（该生）"},
        STAGE,
        [
            "请为这位同学写一段期末评语。",
            "风格：朴实真诚；字数：150 字左右；人称：第三人称（该生）。",
        ],
    ),
    (
        "report",
        {},
        STAGE,
        [
            "请根据上面的考试数据写一份班级成绩分析报告。",
            "三、学生情况（进步、退步、学习困难的同学",
        ],
    ),
    (
        "talk",
        {"topic": ""},
        STAGE,
        ["请帮我准备一次和这位同学的个别谈心。", "话题：近期状态。"],
    ),
    (
        "birthday",
        {"style": "幽默"},
        STAGE,
        ["请用班主任的口吻写 3 段风格不同的生日祝福（整体偏幽默）", "不要提成绩和名次"],
    ),
    (
        "parent-batch",
        {"channel": "电话提纲"},
        {**STAGE, "exam": "期中考试", "vs": "第一次月考", "n": 6},
        ["这位同学在「期中考试」中比「第一次月考」后退了 6 名。", "请写一条给家长的电话提纲："],
    ),
]


def test_every_template_has_a_task_and_a_case():
    assert set(TASKS) == set(TEMPLATES)
    assert {c[0] for c in CASES} == set(TEMPLATES) and len(CASES) == len(TEMPLATES)


@pytest.mark.parametrize(
    ("template_id", "values", "extra", "expected"), CASES, ids=[c[0] for c in CASES]
)
def test_task_text_contains_key_sentences(template_id, values, extra, expected):
    text = task_text(template_id, values, extra)
    for sentence in expected:
        assert sentence in text, f"{template_id} 缺少:{sentence}\n{text}"


def test_values_are_stripped_and_empty_conditional_lines_dropped():
    text = task_text(
        "lesson",
        {
            "grade": " 三年级 ",
            "subject": "语文",
            "topic": " 秋天的雨 ",
            "hours": "1 课时",
            "extra": "  ",
        },
        STAGE,
    )
    assert "请为小学三年级语文的课题《秋天的雨》" in text
    assert "学情与要求" not in text
    with_extra = task_text(
        "lesson",
        {
            "grade": "三年级",
            "subject": "语文",
            "topic": "秋天的雨",
            "hours": "1 课时",
            "extra": "基础薄弱",
        },
        STAGE,
    )
    assert with_extra.endswith("学情与要求：基础薄弱")
