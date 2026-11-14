/** 只有 1 次考试时,趋势图只剩一个孤点:改成一行文字摘要。 */
export default function SingleExamSummary({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>
}
