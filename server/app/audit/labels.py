"""审计动作的中文名与分组(审计查询页用)。没收录的动作,查询时 action_label 回原值。"""

from collections.abc import Callable

ACTION_LABELS: dict[str, str] = {
    # 学生档案
    "student.list": "查看学生名单",
    "student.read_basic": "查看学生基本信息",
    "student.read_family": "查看学生家庭信息",
    "student.read_learning": "查看学生学习信息",
    "student.read_profile": "查看学生档案",
    "student.teacher_notes": "查看教师备注",
    "student.write_basic": "修改学生基本信息",
    "student.write_notes": "修改教师备注",
    "student.update_class_role": "设置班级职务",
    "student.manage": "管理学生",
    "student.create": "新增学生",
    "student.update": "修改学生信息",
    "student.remove": "移出学生",
    "student.import": "导入学生",
    "student.export": "导出学生",
    # 成绩与考试
    "exam.read": "查看考试",
    "exam.write": "管理考试",
    "exam.create": "新建考试",
    "exam.update": "修改考试",
    "exam.delete": "删除考试",
    "exam.grade_write": "管理联考",
    "exam.grade_create": "新建联考",
    "exam.grade_update": "修改联考",
    "exam.grade_delete": "删除联考",
    "exam.grade_sync": "同步联考成绩",
    "score.write": "录入成绩",
    "score.export": "导出成绩",
    # 点评与座位(含班级日常:考勤、黑板)
    "class.read": "查看班级",
    "class.layout": "调整教室布局",
    "attendance.read": "查看考勤",
    "attendance.write": "记录考勤",
    "attendance.export": "导出考勤报表",
    "review.read": "查看点评",
    "review.write": "点评学生",
    "review.revoke": "撤销点评",
    "seating.write": "调整座位",
    "board.write": "编辑黑板",
    # 评语与成长
    "comment.read": "查看评语",
    "comment.write": "撰写评语",
    "comment.create": "新增评语",
    "comment.delete": "删除评语",
    "growth.read": "查看成长记录",
    "growth.write": "记录成长",
    "growth.create": "新增成长记录",
    "growth.delete": "删除成长记录",
    # AI
    "ai.use": "使用 AI",
    "ai.class": "使用班级 AI",
    "ai.usage": "查看 AI 使用情况",
    "ai.generate": "AI 生成",
    "ai.prompt_copy": "复制 AI 提示词",
    "ai.config": "修改 AI 配置",
    # 账号
    "account.manage": "管理账号",
    "account.create": "新建账号",
    "account.update": "修改账号",
    "account.reset_password": "重置密码",
    "account.password_change": "修改密码",
    "account.freeze": "冻结账号",
    "account.unfreeze": "解冻账号",
    "account.import": "导入账号",
    # 组织
    "org.manage": "管理组织",
    "org.school": "修改学校信息",
    "org.year": "修改学年",
    "org.grade_create": "新建年级",
    "org.grade_update": "修改年级",
    "org.grade_delete": "删除年级",
    "org.class_create": "新建班级",
    "org.class_update": "修改班级",
    "org.class_delete": "删除班级",
    "org.staff_add": "添加教职工",
    "org.staff_end": "结束教职工任职",
    "org.role_add": "添加角色",
    "org.role_end": "结束角色",
    # 学校设置
    "settings.manage": "管理学校设置",
    "settings.tag_pool": "修改标签池",
    "settings.switches": "修改功能开关",
    # 学年
    "year.upgrade": "学年升级",
    "year.rollback": "回滚学年升级",
    # 通知
    "notice.send": "发送通知",
    "notice.recall": "撤回通知",
    # 审计与其他权限(被拒访问的动作名就是权限点)
    "audit.read": "查看审计日志",
    "school.view": "查看全校概览",
}

# 动作名前缀 → 分组
_PREFIX_GROUPS: dict[str, tuple[str, ...]] = {
    "student": ("student.",),
    "grade": ("exam.", "score."),
    "review": ("review.", "seating.", "board.", "class.", "attendance."),
    "record": ("comment.", "growth."),
    "ai": ("ai.",),
    "account": ("account.",),
    "org": ("org.",),
    "settings": ("settings.",),
    "year": ("year.",),
    "notice": ("notice.",),
}

_GROUP_NAMES: dict[str, str] = {
    "student": "学生档案",
    "grade": "成绩与考试",
    "review": "点评与座位",
    "record": "评语与成长",
    "ai": "AI",
    "account": "账号",
    "org": "组织",
    "settings": "学校设置",
    "year": "学年",
    "notice": "通知",
}


def _by_prefix(prefixes: tuple[str, ...]) -> Callable[[str, bool], bool]:
    return lambda action, success: action.startswith(prefixes)


# (key, 中文名, 判定函数(action, success));顺序固定,denied 为所有 success=false
GROUPS: list[tuple[str, str, Callable[[str, bool], bool]]] = [
    (key, _GROUP_NAMES[key], _by_prefix(prefixes)) for key, prefixes in _PREFIX_GROUPS.items()
] + [("denied", "被拒的访问", lambda action, success: not success)]
