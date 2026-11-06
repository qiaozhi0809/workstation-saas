/**
 * 浏览器端保存文件(L43 统一下载入口):临时 <a download> 点一下再移除;
 * 对象地址推迟到下一轮再释放,避免个别浏览器在 click 还没处理完时就取消下载。
 * 文本(CSV 等)请先 new Blob([text], { type }) 再调本函数。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
