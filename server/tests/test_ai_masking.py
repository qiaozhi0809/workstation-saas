import json

import pytest
from sqlalchemy import update

from app.ai.masking import Masker, code_of, masker_for_school, scrub
from app.models import Enrollment, School, Student
from tests.seed_ids import CLASS_ID, SCHOOL_ID, STUDENT_IDS

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
    m = Masker([(" 李四 ", 4), ("李四", 5)], class_nos={4, 5})
    assert m.mask("李四来了") == "【学生04】来了"
    assert m.restore("【学生05】") == "【学生05】"


def test_mask_does_not_touch_inserted_codes():
    m = Masker([("学生", 1), ("张三", 3)])
    assert m.mask("张三和学生") == "【学生03】和【学生01】"


def test_restore_and_unknown_code_kept():
    m = Masker(PEOPLE, class_nos={3, 12, 4})
    assert m.restore("【学生03】、[学生12]、【学生4】") == "张三、张三丰、李四"


def test_unknown_code_kept():
    assert Masker(PEOPLE, class_nos={3}).restore("【学生99】很好") == "【学生99】很好"


def test_mapping_lists_used_codes_only():
    assert Masker(PEOPLE, class_nos={3, 12}).mapping("【学生12】与【学生03】,【学生03】") == [
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
    "raw",
    [
        "138 0000 0011",
        "138-0000-0011",
        "+8613800000011",
        "+86 138 0000 0011",
        "+86-138-0000-0011",
        "８６13800000011",
        "１３８００００００１１",
        "＋86 １３８ ００００ ００１１",
        "110101 19900101 123X",
        "110101-19900101-123x",
        "１１０１０１１９９００１０１１２３Ｘ",
    ],
)
def test_scrub_phone_and_id_formats(raw):
    assert scrub(f"家长电话:{raw}。") == "家长电话:〔号码已隐去〕。"


@pytest.mark.parametrize(
    "text",
    [
        "分数 90 85 100",
        "日期 2026-11-02 和 2026-11-03",
        "编号 91380000001 12",
        "1380000001123",  # 号码后紧挨数字
        "7613800000011",  # 号码前紧挨数字(非 86 前缀)
        "2011010119900101123X",  # 证件前紧挨数字
        "1101011990010112345",  # 证件后紧挨数字
    ],
)
def test_scrub_leaves_glued_and_ordinary_numbers(text):
    assert scrub(text) == text


@pytest.mark.parametrize(
    "chunks",
    [
        ["【学", "生03】进步", "很大"],
        ["【", "学生", "0", "3】进步很大"],
        ["开头【学生03】进步很大"],
    ],
)
def test_stream_restorer_handles_split_codes(chunks):
    r = Masker(PEOPLE, class_nos={3, 12}).restorer()
    out = "".join(r.feed(c) for c in chunks) + r.flush()
    assert out.endswith("张三进步很大") and "【" not in out


def test_stream_restorer_releases_non_code_bracket():
    r = Masker(PEOPLE, class_nos={3, 12}).restorer()
    assert r.feed("【注意】这里") == "【注意】这里"


def test_stream_restorer_flushes_dangling_tail():
    r = Masker(PEOPLE, class_nos={3, 12}).restorer()
    assert r.feed("结尾【学") == "结尾" and r.flush() == "【学"


def test_stream_restorer_half_width_bracket_split():
    r = Masker(PEOPLE, class_nos={3, 12}).restorer()
    out = r.feed("好[学生1") + r.feed("2]!") + r.flush()
    assert out == "好张三丰!"


def test_masker_for_school_includes_removed_students(db):
    db.execute(
        update(Enrollment)
        .where(Enrollment.class_id == CLASS_ID, Enrollment.student_id == STUDENT_IDS[0])
        .values(status="removed")
    )
    db.flush()
    m = masker_for_school(db, SCHOOL_ID, CLASS_ID)
    assert m.mask("王小一") == "【学生01】"
    assert m.restore("【学生01】") == "王小一"


def test_masker_for_school_covers_unenrolled_but_not_other_schools(db):
    other = School(name="外校")
    db.add(other)
    db.flush()
    mine = Student(school_id=SCHOOL_ID, mk="mk-x1", name="周远航")
    theirs = Student(school_id=other.id, mk="mk-x2", name="吴天佑")
    db.add_all([mine, theirs])
    db.flush()
    m = masker_for_school(db, SCHOOL_ID)
    assert m.mask("周远航与吴天佑") == f"{code_of(mine.mask_no)}与吴天佑"


def _other_class_student(db, name, mk):
    from tests.factories import make_class, make_student

    other_cls = make_class(db, "另一班")
    sid = make_student(db, other_cls, name, mk)
    db.commit()
    return db.get(Student, sid)


def test_other_class_student_masked(client, settings, db):
    from tests.test_ai_chats import (
        configure_ai,
        create,
        get_chat,
        lesson_body,
        run_reply,
        set_transport,
    )

    configure_ai(db, settings)
    other = _other_class_student(db, "赵明轩", "mk-x3")
    code = code_of(other.mask_no)
    rec = set_transport(client, [f"{code}很棒"])
    chat = create(client, settings, {**lesson_body(), "mask": True})
    run_reply(client, settings, chat["id"], {"text": "请表扬赵明轩"})
    sent = json.dumps(rec[0], ensure_ascii=False)
    assert code in sent and "赵明轩" not in sent
    got = get_chat(client, settings, chat["id"]).json()
    assert got["messages"][-1]["content"] == "赵明轩很棒"


def test_old_sent_with_real_name_is_remasked_next_turn(client, settings, db):
    from sqlalchemy import select

    from app.models import AiMessage
    from tests.test_ai_chats import (
        configure_ai,
        create,
        get_chat,
        lesson_body,
        run_reply,
        set_transport,
    )

    configure_ai(db, settings)
    other = _other_class_student(db, "钱天宇", "mk-x4")
    code = code_of(other.mask_no)
    chat = create(client, settings, {**lesson_body(), "mask": True})
    first = db.scalars(
        select(AiMessage).where(AiMessage.chat_id == chat["id"], AiMessage.role == "user")
    ).first()
    first.sent = "上一轮提到钱天宇"  # 旧消息的 sent 里含外班真名
    db.commit()
    rec = set_transport(client, [f"{code}加油"])
    run_reply(client, settings, chat["id"], {"text": "继续"})
    sent = json.dumps(rec[0], ensure_ascii=False)
    assert "钱天宇" not in sent and code in sent
    got = get_chat(client, settings, chat["id"]).json()
    assert got["messages"][-1]["content"] == "钱天宇加油"


def test_same_name_across_classes_shares_smaller_mask_no(db):
    first = Student(school_id=SCHOOL_ID, mk="mk-dup1", name="张伟")
    db.add(first)
    db.flush()
    second = Student(school_id=SCHOOL_ID, mk="mk-dup2", name="张伟")
    db.add(second)
    db.flush()
    low, high = sorted((first.mask_no, second.mask_no))
    assert low < high
    m = masker_for_school(db, SCHOOL_ID)
    m.mask("张伟")
    assert m.mask("张伟今天进步了") == f"{code_of(low)}今天进步了"
    assert code_of(high) not in m.mask("张伟")
    assert m.restore(code_of(low)) == "张伟"


def test_prefix_name_not_truncated_by_shorter_name(db):
    short = Student(school_id=SCHOOL_ID, mk="mk-pf1", name="王明")
    long_ = Student(school_id=SCHOOL_ID, mk="mk-pf2", name="王明轩")
    db.add_all([short, long_])
    db.flush()
    m = masker_for_school(db, SCHOOL_ID)
    masked = m.mask("王明轩和王明一起")
    assert masked == f"{code_of(long_.mask_no)}和{code_of(short.mask_no)}一起"
    assert "轩" not in masked
    assert m.restore(masked) == "王明轩和王明一起"


# ---- I1:只换回本班名单与本次 mask() 实际生成过的编号


def test_hand_written_code_of_foreign_student_not_restored():
    m = Masker(PEOPLE, class_nos={3})
    text = "【学生12】与【学生03】"
    assert m.restore(text) == "【学生12】与张三"
    assert m.mapping(text) == [("【学生03】", "张三")]


def test_emitted_codes_restored_even_outside_class():
    m = Masker(PEOPLE, class_nos={3})
    masked = m.mask("张三丰来了")  # 外班学生被替换,编号计入 emitted
    assert masked == "【学生12】来了"
    assert m.restore(masked) == "张三丰来了"
    assert m.mapping(masked) == [("【学生12】", "张三丰")]
    assert m.restore("【学生04】") == "【学生04】"  # 未生成过、也不在本班


def test_stream_restorer_same_rule():
    m = Masker(PEOPLE, class_nos={3})
    m.mask("张三丰")
    r = m.restorer()
    out = r.feed("【学生12】、【学") + r.feed("生04】、【学生03】") + r.flush()
    assert out == "张三丰、【学生04】、张三"


def test_masker_for_school_scopes_class_roster(db):
    other = Student(school_id=SCHOOL_ID, mk="mk-r1", name="郑远山")
    db.add(other)
    db.flush()
    m = masker_for_school(db, SCHOOL_ID, CLASS_ID)
    assert m.restore(code_of(other.mask_no)) == code_of(other.mask_no)
    assert m.restore("【学生01】") == "王小一"
    m.mask("郑远山")
    assert m.restore(code_of(other.mask_no)) == "郑远山"
    # 没有班级上下文:只有 emitted
    bare = masker_for_school(db, SCHOOL_ID)
    assert bare.restore("【学生01】") == "【学生01】"
