// 往年注册记录的状态原值 → 中文;未知值原样显示,避免后端新增状态时丢信息。
export const ENROLLMENT_STATUS_TEXT: Record<string, string> = {
  active: '在读',
  promoted: '已升级',
  graduated: '已毕业',
  transferred: '已转出',
  removed: '已移出',
}

export const enrollmentStatusText = (status: string) => ENROLLMENT_STATUS_TEXT[status] ?? status
