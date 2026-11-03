"""15 个 AI 模板的定义(字段、所需权限、资料段)。任务文字见 ``app.ai.prompts``。"""

from dataclasses import dataclass
from typing import Literal

from app.rbac.roles import Perm

FieldType = Literal["text", "textarea", "select", "check", "student", "students", "exam", "exam0"]
Context = Literal["class", "student", "exam", "latest_exam"]

# 默认值占位:由 requests 按调用者和班级解析
DEFAULT_TEACHER_SUBJECT = "@teacher_subject"
DEFAULT_GRADE = "@grade"

# 校验顺序,也是缺权限时 deny 的先后
PERM_ORDER = (Perm.AI_USE, Perm.AI_CLASS, Perm.COMMENT_WRITE, Perm.EXAM_READ)
CONTEXT_ORDER: tuple[Context, ...] = ("class", "student", "exam", "latest_exam")


@dataclass(frozen=True)
class Field:
    key: str
    type: FieldType
    label: str
    required: bool = False
    options: tuple[str, ...] | None = None
    default: str | bool | None = None
    placeholder: str | None = None


@dataclass(frozen=True)
class Template:
    id: str
    cat: str
    title: str
    desc: str
    rec: bool
    hidden: bool
    batch: bool
    fields: tuple[Field, ...]
    needs: frozenset[Perm]
    save_as: Literal["comment"] | None
    contexts: frozenset[Context]


CATEGORIES = [
    ("rec", "推荐"),
    ("teach", "教学备课"),
    ("manage", "班级管理"),
    ("home", "家校沟通"),
    ("grow", "学生成长"),
]


def _text(key: str, label: str, **kw) -> Field:
    return Field(key, "text", label, **kw)


def _area(key: str, label: str, **kw) -> Field:
    return Field(key, "textarea", label, **kw)


def _select(key: str, label: str, options: list[str]) -> Field:
    return Field(key, "select", label, options=tuple(options), default=options[0])


_SUBJECT = _text("subject", "学科", default=DEFAULT_TEACHER_SUBJECT)
_GRADE = _text("grade", "年级", default=DEFAULT_GRADE)
_STUDENT = Field("student", "student", "学生", required=True)
_COMMENT_FIELDS = (
    _select("style", "风格", ["温暖鼓励", "朴实真诚", "活泼生动", "正式规范"]),
    _select("len", "字数", ["100 字左右", "150 字左右", "200 字左右"]),
    _select("person", "人称", ["第二人称（你）", "第三人称（该生）"]),
)
_USE = Perm.AI_USE
_CLASS = Perm.AI_CLASS


def _t(
    id: str,
    cat: str,
    title: str,
    desc: str,
    fields: list[Field],
    needs: list[Perm],
    contexts: list[Context] | None = None,
    *,
    rec: bool = False,
    hidden: bool = False,
    batch: bool = False,
    save_as: Literal["comment"] | None = None,
) -> Template:
    return Template(
        id=id,
        cat=cat,
        title=title,
        desc=desc,
        rec=rec,
        hidden=hidden,
        batch=batch,
        fields=tuple(fields),
        needs=frozenset(needs),
        save_as=save_as,
        contexts=frozenset(contexts or []),
    )


_TEMPLATE_LIST = [
    _t(
        "lesson",
        "teach",
        "备课教案",
        "目标、重难点、教学过程表格、板书与分层作业",
        [
            _SUBJECT,
            _GRADE,
            _text("topic", "课题", required=True),
            _select("hours", "课时", ["1 课时", "2 课时", "3 课时"]),
            _area("extra", "学情与要求"),
        ],
        [_USE],
    ),
    _t(
        "ppt",
        "teach",
        "课件大纲",
        "每页要点、互动设计与配图建议",
        [
            _SUBJECT,
            _text("topic", "课题", required=True),
            _select("pages", "篇幅", ["10 页左右", "15 页左右", "20 页左右"]),
        ],
        [_USE],
    ),
    _t(
        "homework",
        "teach",
        "分层作业",
        "基础 / 提高 / 拓展三层,附答案",
        [
            _SUBJECT,
            _GRADE,
            _text("topic", "知识点", required=True),
            _select("count", "每层题量", ["3 题", "5 题", "8 题"]),
        ],
        [_USE],
    ),
    _t(
        "meeting",
        "manage",
        "班会课方案",
        "流程、互动与班主任总结发言",
        [
            _text("theme", "主题", required=True),
            _select("dur", "时长", ["40 分钟", "45 分钟", "30 分钟"]),
            _select("form", "形式", ["讨论交流", "游戏体验", "情景表演", "演讲分享", "综合活动"]),
            Field("use_class", "check", "参考本班情况", default=True),
        ],
        [_USE, _CLASS],
        ["class"],
        rec=True,
    ),
    _t(
        "activity",
        "manage",
        "活动策划",
        "流程、分工、预算与安全预案",
        [
            _text("name", "活动名称", required=True),
            _text("when", "时间地点"),
            _text("people", "参与人数"),
            _text("budget", "预算"),
        ],
        [_USE, _CLASS],
        ["class"],
    ),
    _t(
        "summary",
        "manage",
        "工作总结 / 计划",
        "依据班级数据写总结或计划",
        [
            _select("kind", "类型", ["学期工作总结", "学期工作计划", "月度工作总结"]),
            _area("focus", "希望重点写"),
        ],
        [_USE, _CLASS],
        ["class", "latest_exam"],
    ),
    _t(
        "notice",
        "home",
        "家长群通知",
        "正式版 + 精简版",
        [
            _area("matter", "事项", required=True),
            _text("when", "时间"),
            _area("need", "需要家长配合"),
        ],
        [_USE, _CLASS],
        rec=True,
    ),
    _t(
        "parent",
        "home",
        "家长沟通话术",
        "先肯定,再说事实,给出家校办法",
        [
            _STUDENT,
            _select("reason", "事由", ["表扬进步", "学习下滑", "行为习惯", "身心状况", "日常沟通"]),
            _area("detail", "具体情况"),
            _select("channel", "沟通方式", ["微信消息", "电话提纲", "面谈提纲"]),
        ],
        [_USE, _CLASS],
        ["student"],
        rec=True,
    ),
    _t(
        "pmeeting",
        "home",
        "家长会发言稿",
        "结合考试数据,只谈群体",
        [
            Field("exam", "exam", "考试"),
            _select("mins", "时长", ["10 分钟", "15 分钟", "20 分钟"]),
            _area("focus", "重点强调"),
        ],
        [_USE, _CLASS],
        ["class", "exam"],
    ),
    _t(
        "comments",
        "grow",
        "期末评语(批量)",
        "一次为多位同学各写一段",
        [Field("students", "students", "学生", required=True), *_COMMENT_FIELDS],
        [_USE, _CLASS, Perm.COMMENT_WRITE],
        ["student"],
        rec=True,
        batch=True,
        save_as="comment",
    ),
    _t(
        "report",
        "grow",
        "成绩分析报告",
        "总体、各科、学生与措施",
        [Field("exam", "exam", "考试", required=True), Field("vs", "exam0", "对比考试")],
        [_USE, Perm.EXAM_READ],
        ["exam"],
        rec=True,
    ),
    _t(
        "talk",
        "grow",
        "谈心谈话提纲",
        "开场白、提问清单与应对",
        [_STUDENT, _text("topic", "话题", placeholder="近期状态")],
        [_USE, _CLASS],
        ["student"],
    ),
    _t(
        "birthday",
        "grow",
        "生日祝福",
        "三段不同风格的祝福",
        [_STUDENT, _select("style", "风格", ["温馨", "幽默", "诗意"])],
        [_USE],
        ["student"],
    ),
    _t(
        "comment1",
        "grow",
        "个人评语",
        "为一位同学写期末评语",
        [_STUDENT, *_COMMENT_FIELDS],
        [_USE, _CLASS, Perm.COMMENT_WRITE],
        ["student"],
        hidden=True,
        save_as="comment",
    ),
    _t(
        "parent-batch",
        "home",
        "退步同学家长沟通",
        "为退步 5 名及以上的同学各写一条",
        [
            Field("exam", "exam", "考试", required=True),
            Field("vs", "exam", "对比考试", required=True),
            _select("channel", "沟通方式", ["微信消息", "电话提纲"]),
        ],
        [_USE, _CLASS, Perm.EXAM_READ],
        ["student"],
        hidden=True,
        batch=True,
    ),
]

TEMPLATES: dict[str, Template] = {t.id: t for t in _TEMPLATE_LIST}
