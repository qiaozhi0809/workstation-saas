import { Download } from 'lucide-react'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '@/shared/components/ui/table'
import { downloadText, toCSV } from '@/shared/lib/csv'

export interface TempPassword {
  login_name: string
  display_name: string
  temp_password: string
}

const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制')
  } catch {
    toast('复制失败,请手动选中复制')
  }
}

/** 临时密码只存在于调用方传进来的 entries;关闭时调用方把它置空 */
export default function TempPasswordDialog({
  entries,
  batch = false,
  onClose,
}: {
  entries: TempPassword[]
  batch?: boolean
  onClose(): void
}) {
  // 批量导入即使只有一行也用表格 + 下载 CSV
  const many = batch || entries.length > 1
  const download = () =>
    downloadText(
      `临时密码-${today()}.csv`,
      toCSV([
        ['登录名', '姓名', '临时密码'],
        ...entries.map((e) => [e.login_name, e.display_name, e.temp_password]),
      ]),
    )
  return (
    <Modal
      open
      onClose={onClose}
      title="临时密码"
      dismissOnOutside={false}
      description="请把下面的密码交给本人,关闭后不再显示;对方首次登录需要修改密码。"
      className={many ? 'max-w-xl' : 'max-w-sm'}
    >
      {many ? (
        <Table
          density="compact"
          containerClassName="max-h-80 overflow-auto bg-transparent shadow-none"
        >
          <TableHead>
            <TableRow>
              <Th>登录名</Th>
              <Th>姓名</Th>
              <Th>临时密码</Th>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.login_name}>
                <Td>{e.login_name}</Td>
                <Td>{e.display_name}</Td>
                <Td className="font-mono">{e.temp_password}</Td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        entries.map((e) => (
          <div key={e.login_name} className="space-y-1 rounded-md bg-muted px-3 py-3 text-center">
            <p className="text-sm text-muted-foreground">
              {e.display_name}({e.login_name})
            </p>
            <p className="select-all font-mono text-xl tracking-wider">{e.temp_password}</p>
          </div>
        ))
      )}
      <div className="mt-4 flex justify-end gap-2">
        {many ? (
          <Button type="button" variant="outline" onClick={download}>
            <Download aria-hidden="true" />
            下载 CSV
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => void copy(entries[0].temp_password)}
          >
            复制
          </Button>
        )}
        <Button type="button" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
  )
}
