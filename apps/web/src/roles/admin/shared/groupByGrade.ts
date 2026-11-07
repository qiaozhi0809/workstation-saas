/**
 * 按年级名分组,年级与同年级内的顺序都保持接口返回的顺序。
 * 课表页的班级下拉、摄像头表单的班级下拉、往年班级页的分组共用这一份(L215)。
 */
export function groupByGrade<T extends { grade_name: string }>(
  classes: T[],
): { grade: string; classes: T[] }[] {
  const groups: { grade: string; classes: T[] }[] = []
  for (const c of classes) {
    const g = groups.find((x) => x.grade === c.grade_name)
    if (g) g.classes.push(c)
    else groups.push({ grade: c.grade_name, classes: [c] })
  }
  return groups
}
