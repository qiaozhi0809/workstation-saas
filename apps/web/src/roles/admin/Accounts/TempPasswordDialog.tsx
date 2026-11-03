import { Download } from 'lucide-react'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { downloadText, toCSV } from '@/shared/lib/csv'

export interface TempPassword { login_name: string; display_name: string; temp_password: string }

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
export default function TempPasswordDialog({ entries, onClose }: { entries: TempPassword[]; onClose(): void }) {
  const many = entries.length > 1
  const download = () => downloadText(
    `临时密码-${today()}.csv`,
    toCSV([['登录名', '姓名', '临时密码'], ...entries.map((e) => [e.login_name, e.display_name, e.temp_password])]),
  )
  return (
    <Modal
      open onClose={onClose} title="临时密码" dismissOnOutside={false}
      description="请把下面的密码交给本人,关闭后不再显示;对方首次登录需要修改密码。"
      className={many ? 'max-w-xl' : 'max-w-sm'}
    >
      {many ? (
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">登录名</th><th className="px-3 py-2 font-medium">姓名</th><th className="px-3 py-2 font-medium">临时密码</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.login_name} className="border-t">
                  <td className="px-3 py-1.5">{e.login_name}</td>
                  <td className="px-3 py-1.5">{e.display_name}</td>
                  <td className="px-3 py-1.5 font-mono">{e.temp_password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : entries.map((e) => (
        <div key={e.login_name} className="space-y-1 rounded-md bg-muted px-3 py-3 text-center">
          <p className="text-sm text-muted-foreground">{e.display_name}({e.login_name})</p>
          <p className="select-all font-mono text-xl tracking-wider">{e.temp_password}</p>
        </div>
      ))}
      <div className="mt-4 flex justify-end gap-2">
        {many ? (
          <Button type="button" variant="outline" onClick={download}><Download aria-hidden="true" />下载 CSV</Button>
        ) : (
          <Button type="button" variant="outline" onClick={() => void copy(entries[0].temp_password)}>复制</Button>
        )}
        <Button type="button" onClick={onClose}>关闭</Button>
      </div>
    </Modal>
  )
}
