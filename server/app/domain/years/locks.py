"""学年行锁:往进行中的学年写外键行之前,确认它仍进行中(与学年升级 / 回滚的锁序配合)。"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import ApiError


def ensure_year_live(db: Session, year_id: UUID) -> None:
    """对学年行取 KEY SHARE(与回滚持有的 FOR UPDATE 互斥):回滚进行中就等它结束;等到时学年
    已被回滚删掉或已被升级停用 → 409,而不是写进一个马上被级联删掉 / 已成往年的学年(L56、L261)。

    锁序(台账 L323):会碰班级行的路径先按 id 升序锁住所涉班级行,再来这里,然后才写;
    只碰年级不碰班级的路径(建班 / 建年级 / 年级组长任命)先来这里、再锁年级行,
    与回滚"学年 FOR UPDATE → DELETE grades"同序。"""
    row = db.execute(
        text("SELECT is_active FROM academic_years WHERE id = :y FOR KEY SHARE"), {"y": year_id}
    ).first()
    if row is None or not row[0]:
        raise ApiError(409, "NO_ACTIVE_YEAR", "学年刚被升级或回滚,请刷新后重试")
