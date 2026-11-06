"""班名 / 年级名的排序键(L40):中文数字与阿拉伯数字按数值比,其余文字按原文。

``sorted(names, key=class_sort_key)`` 得到 三年二班 < 三年三班 < 三年十班、一年级 < 十年级,
"3班" 与 "三班" 同序;没有数字的名字按码位序排在带数字的后面。第 1 波只提供函数,
各调用点(班级列表、看板、报表)在后续段里替换。
"""

_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_UNITS = {"十": 10, "百": 100}

SortKey = tuple[tuple[int, int] | tuple[int, str], ...]


def _is_cn_number(ch: str) -> bool:
    return ch in _DIGITS or ch in _UNITS


def _cn_value(text: str) -> int:
    """中文数字的值:二十一 → 21、十 → 10、一百零一 → 101;连写的数字(一二)按位拼成 12。"""
    total = 0
    num = 0
    for ch in text:
        if ch in _UNITS:
            total += (num or 1) * _UNITS[ch]
            num = 0
        else:
            num = num * 10 + _DIGITS[ch]
    return total + num


def class_sort_key(name: str) -> SortKey:
    """把名字切成数字段 (0, 数值) 与文字段 (1, 原文),末尾加 (-1, 原文) 收尾。

    每一段都是 (种类, 值),同一位置先比种类再比值,不会拿数字和文字直接比较;
    收尾段种类最小,所以 "高一" 排在 "高一1班" 前,也保证了全序与稳定。
    """
    parts: list[tuple[int, int] | tuple[int, str]] = []
    i = 0
    while i < len(name):
        ch = name[i]
        if ch.isdecimal():  # int() 只认 decimal 字符:全角 ３ 算数字,带圈 ①、上标 ² 当文字
            j = i
            while j < len(name) and name[j].isdecimal():
                j += 1
            parts.append((0, int(name[i:j])))
        elif _is_cn_number(ch):
            j = i
            while j < len(name) and _is_cn_number(name[j]):
                j += 1
            parts.append((0, _cn_value(name[i:j])))
        else:
            j = i
            while j < len(name) and not (name[j].isdecimal() or _is_cn_number(name[j])):
                j += 1
            parts.append((1, name[i:j]))
        i = j
    return (*parts, (-1, name))
