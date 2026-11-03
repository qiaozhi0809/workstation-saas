import pytest
from sqlalchemy import update

from app.ai.masking import Masker, code_of, masker_for_class, scrub
from app.models import Enrollment
from tests.seed_ids import CLASS_ID, STUDENT_IDS

PEOPLE = [("张三", 3), ("张三丰", 12), ("李四", 4), ("王", 9)]


def test_code_of_pads_two_digits():
    assert code_of(3) == "【学生03】"
    assert code_of(123) == "【学生123】"


def test_longest_name_first():
    m = Masker(PEOPLE)
    assert m.mask("张三丰和张三是同桌") == "【学生12】和【学生03】是同桌"


def test_single_char_name_not_replaced():
    assert Masker(PEOPLE).mask("王老师说") == "王老师说"


def test_names_are_stripped_and_first_duplicate_wins():
    m = Masker([(" 李四 ", 4), ("李四", 5)])
    assert m.mask("李四来了") == "【学生04】来了"
    assert m.restore("【学生05】") == "【学生05】"


def test_mask_does_not_touch_inserted_codes():
    m = Masker([("学生", 1), ("张三", 3)])
    assert m.mask("张三和学生") == "【学生03】和【学生01】"


def test_restore_and_unknown_code_kept():
    m = Masker(PEOPLE)
    assert m.restore("【学生03】、[学生12]、【学生4】") == "张三、张三丰、李四"


def test_unknown_code_kept():
    assert Masker(PEOPLE).restore("【学生99】很好") == "【学生99】很好"


def test_mapping_lists_used_codes_only():
    assert Masker(PEOPLE).mapping("【学生12】与【学生03】,【学生03】") == [
        ("【学生03】", "张三"),
        ("【学生12】", "张三丰"),
    ]


def test_scrub_phone_and_id():
    assert (
        scrub("电话 13800000011,证件 11010119900101123X")
        == "电话 〔号码已隐去〕,证件 〔号码已隐去〕"
    )
    assert scrub("学号 2026001 和 123138000000110") == "学号 2026001 和 123138000000110"


@pytest.mark.parametrize(
    "chunks",
    [
        ["【学", "生03】进步", "很大"],
        ["【", "学生", "0", "3】进步很大"],
        ["开头【学生03】进步很大"],
    ],
)
def test_stream_restorer_handles_split_codes(chunks):
    r = Masker(PEOPLE).restorer()
    out = "".join(r.feed(c) for c in chunks) + r.flush()
    assert out.endswith("张三进步很大") and "【" not in out


def test_stream_restorer_releases_non_code_bracket():
    r = Masker(PEOPLE).restorer()
    assert r.feed("【注意】这里") == "【注意】这里"


def test_stream_restorer_flushes_dangling_tail():
    r = Masker(PEOPLE).restorer()
    assert r.feed("结尾【学") == "结尾" and r.flush() == "【学"


def test_stream_restorer_half_width_bracket_split():
    r = Masker(PEOPLE).restorer()
    out = r.feed("好[学生1") + r.feed("2]!") + r.flush()
    assert out == "好张三丰!"


def test_masker_for_class_includes_removed_students(db):
    db.execute(
        update(Enrollment)
        .where(Enrollment.class_id == CLASS_ID, Enrollment.student_id == STUDENT_IDS[0])
        .values(status="removed")
    )
    db.flush()
    m = masker_for_class(db, CLASS_ID)
    assert m.mask("王小一") == "【学生01】"
    assert m.restore("【学生01】") == "王小一"
