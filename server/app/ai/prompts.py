"""各模板的任务文字(重写版)。值都已去首尾空格;条件行在值为空时整行省略。"""

from collections.abc import Callable, Mapping
from typing import Any

TaskFn = Callable[[Mapping[str, Any], Mapping[str, Any]], str]


def _text(v: Mapping[str, Any], key: str) -> str:
    value = v.get(key)
    return value.strip() if isinstance(value, str) else ""


def _or_tbd(v: Mapping[str, Any], key: str) -> str:
    return _text(v, key) or "未定"


def _cond(label: str, value: str) -> str:
    return f"{label}{value}" if value else ""


def _join(*lines: str) -> str:
    return "\n".join(line for line in lines if line)


def _lesson(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        f"请为{x['stage']}{_text(v, 'grade')}{_text(v, 'subject')}的课题《{_text(v, 'topic')}》"
        f"编写一份完整的教学设计（{_text(v, 'hours')}）。",
        "请按以下部分组织：",
        "一、教学目标（围绕核心素养来写）",
        "二、教学重点与难点",
        "三、课前准备",
        "四、教学过程：分导入、新课、练习、小结、布置作业几个环节，"
        "用表格写清每个环节的用时、教师活动、学生活动和设计意图",
        "五、板书设计",
        "六、分层作业（基础、提高、拓展三档）",
        "七、课后反思要点",
        _cond("学情与要求：", _text(v, "extra")),
    )


def _ppt(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        f"请为{x['stage']}{_text(v, 'subject')}《{_text(v, 'topic')}》设计一份课件大纲，"
        f"篇幅{_text(v, 'pages')}。",
        "每一页列出：标题、不超过 4 条要点、互动或提问设计、配图建议。",
        "最后给出 3 条控制课堂时间分配的建议。",
    )


def _homework(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        f"请围绕{x['stage']}{_text(v, 'grade')}{_text(v, 'subject')}的「{_text(v, 'topic')}」"
        f"设计一套分层作业，基础层、提高层、拓展层各{_text(v, 'count')}。",
        "题目尽量联系生活实际，三层难度要拉开梯度。",
        "每层之后附参考答案和简要讲评要点，最后说明每层适合哪些同学。",
    )


def _meeting(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        "请为一节主题班会设计活动方案。",
        f"主题：{_text(v, 'theme')}；时长：{_text(v, 'dur')}；主要形式：{_text(v, 'form')}。",
        "方案包括：",
        "- 活动目标",
        "- 课前准备（含学生分工）",
        "- 活动流程（每个环节的时间、做法、主持词要点）",
        "- 互动环节设计",
        "- 班主任总结讲话（约 300 字）",
        "- 课后延伸",
    )


def _activity(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        f"请为班级活动「{_text(v, 'name')}」写一份策划书。",
        f"时间地点：{_or_tbd(v, 'when')}；参与人员：{_or_tbd(v, 'people')}；"
        f"预算：{_or_tbd(v, 'budget')}。",
        "内容包括：",
        "- 活动目的",
        "- 活动内容和流程（附时间安排）",
        "- 人员分工（可以让班干部承担）",
        "- 物资与预算清单",
        "- 安全预案",
        "- 宣传方式和活动总结方式",
    )


def _summary(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        f"请依据上面的班级资料写一份班主任{_text(v, 'kind')}，篇幅约 1500 字。",
        "结构：",
        "- 班级基本情况",
        "- 主要工作与成效（班风学风、学业成绩、德育与活动、家校沟通、安全工作）",
        "- 存在的不足",
        "- 下一步打算",
        "引用数据要具体，但不要逐个列出学生全名和名次。",
        _cond("希望重点写：", _text(v, "focus")),
    )


def _notice(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        "请拟一条发到家长微信群的班级通知。",
        f"事项：{_text(v, 'matter')}；时间：{_or_tbd(v, 'when')}；"
        f"需要家长配合的事：{_or_tbd(v, 'need')}。",
        "要求：以「各位家长」开头，分条写明时间、地点和要求，语气礼貌简练，不超过 300 字，"
        "结尾请家长收到后回复。",
        "另附一个 100 字以内的简短版本。",
    )


def _parent(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        "请帮我准备和这位同学家长沟通的内容。",
        f"沟通方式：{_text(v, 'channel')}；事由：{_text(v, 'reason')}。",
        _cond("具体情况：", _text(v, "detail")),
        "要求：",
        "- 先说孩子的长处",
        "- 再把情况和事实讲具体",
        "- 给出 2–3 条家校可以一起落实的办法",
        "- 尊重家长，不责怪家长",
        "- 如果是微信消息，控制在 250 字以内",
        "- 如果是提纲，请分条写，并预想家长可能的反应和回应方式",
    )


def _pmeeting(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        f"请写一份班主任在家长会上的发言稿，时长约{_text(v, 'mins')}"
        "（以每分钟约 200 字估算篇幅）。",
        "结构：",
        "- 问候和致谢",
        "- 班级近况",
        "- 考试情况分析（整体和各科，只分析整体情况，不对个别学生点名批评）",
        "- 表扬进步的同学（可以点名）",
        "- 目前存在的问题",
        "- 家校配合建议（具体、能做到）",
        "- 结束语",
        _cond("需要重点强调：", _text(v, "focus")),
    )


def _comment(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        "请为这位同学写一段期末评语。",
        f"风格：{_text(v, 'style')}；字数：{_text(v, 'len')}；人称：{_text(v, 'person')}。",
        "要求：从档案、成绩、点评和成长记录中挑 1–2 个具体细节来写；"
        "先肯定优点，再用委婉、可操作的语气提 1 条希望；",
        "不要提排名和分数，不说套话；只输出评语正文，不要标题和其他说明。",
    )


def _report(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        "请根据上面的考试数据写一份班级成绩分析报告。",
        "结构：",
        "一、总体情况（关键指标用表格列出）",
        "二、各科分析（优势和薄弱环节）",
        "三、学生情况（进步、退步、学习困难的同学，并给出关注建议）",
        "四、原因分析（列出可能的原因，注明需要老师核实）",
        "五、下一步措施（分别写班主任和各科老师可以做什么）",
    )


def _talk(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        "请帮我准备一次和这位同学的个别谈心。",
        f"话题：{_text(v, 'topic') or '近期状态'}。",
        "请给出：",
        "- 谈话目标",
        "- 合适的时间和地点",
        "- 开场白（两种）",
        "- 倾听要点和提问清单（多用开放式问题）",
        "- 可能出现的情况和应对办法",
        "- 结尾的小约定和后续跟进方式",
        "整体语气温和、真诚，让孩子感到被信任。",
    )


def _birthday(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return (
        "今天是这位同学的生日，请用班主任的口吻写 3 段风格不同的生日祝福"
        f"（整体偏{_text(v, 'style')}），\n"
        "每段不超过 60 字，结合 TA 的特点，不要提成绩和名次。"
    )


def _parent_batch(v: Mapping[str, Any], x: Mapping[str, Any]) -> str:
    return _join(
        f"这位同学在「{x['exam']}」中比「{x['vs']}」后退了 {x['n']} 名。",
        f"请写一条给家长的{_text(v, 'channel')}：",
        "- 先肯定孩子的长处",
        "- 再客观说明变化（不直接说名次，用各科表现来描述）",
        "- 提出 2 条家校配合的具体办法",
        "- 语气尊重温和，不超过 250 字",
        "只输出正文。",
    )


TASKS: dict[str, TaskFn] = {
    "lesson": _lesson,
    "ppt": _ppt,
    "homework": _homework,
    "meeting": _meeting,
    "activity": _activity,
    "summary": _summary,
    "notice": _notice,
    "parent": _parent,
    "pmeeting": _pmeeting,
    "comments": _comment,
    "comment1": _comment,
    "report": _report,
    "talk": _talk,
    "birthday": _birthday,
    "parent-batch": _parent_batch,
}


def task_text(template_id: str, values: Mapping[str, Any], extra: Mapping[str, Any]) -> str:
    """``extra``:stage(学段)、exam / vs(考试名)、n(退步名次数)。"""
    return TASKS[template_id](values, extra)
