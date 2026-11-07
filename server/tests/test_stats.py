"""``app.ai.stats`` 的签名约束(统计规则本身的用例在 test_ai_context.py)。"""

from uuid import uuid4

import pytest

from app.ai.stats import exam_stats, subject_stats
from app.domain.exams.schemas import SubjectFull
from app.domain.school_settings.service import DEFAULT_GRADING


def test_exam_stats_requires_keyword_ratios():
    """L227 ②:``exam_stats(subjects, scores, ids, *, ratios)`` 的比例只能按关键字传——
    位置传入会被当成多余的位置参数而 TypeError,避免调用方把 ratios 与 ids 传反。"""
    subjects = [SubjectFull(name="语文", full=100)]
    eid = uuid4()
    scores = {eid: {"语文": 90.0}}
    with pytest.raises(TypeError):
        exam_stats(subjects, scores, [eid], DEFAULT_GRADING)  # type: ignore[misc]
    with pytest.raises(TypeError):
        subject_stats(subjects, scores, "语文", [eid], DEFAULT_GRADING)  # type: ignore[misc]
    st = exam_stats(subjects, scores, [eid], ratios=DEFAULT_GRADING)
    assert st is not None and st.n == 1
