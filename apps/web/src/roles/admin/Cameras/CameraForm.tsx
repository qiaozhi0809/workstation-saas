import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { camerasApi } from '@/shared/api/cameras'
import { ApiError } from '@/shared/api/client'
import Modal from '@/shared/components/overlay/Modal'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { CameraInput, CameraLocation, CameraOut } from '@/shared/types/camera'
import { groupByGrade } from '../shared/groupByGrade'

const LOCATIONS: CameraLocation[] = ['教室', '走廊', '操场', '食堂', '其他']

/** 新建(camera 为空)或编辑。密码框留空 = 不改;"清除凭据"= 显式传 null */
export default function CameraForm({ camera, onClose }: { camera?: CameraOut; onClose(): void }) {
  const qc = useQueryClient()
  const classes = useQuery({ queryKey: ['admin', 'classes'], queryFn: () => adminApi.classes() })
  const [name, setName] = useState(camera?.name ?? '')
  const [classId, setClassId] = useState(camera?.class_id ?? '')
  const [location, setLocation] = useState<CameraLocation>(camera?.location ?? '教室')
  const [rtspUrl, setRtspUrl] = useState(camera?.rtsp_url ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [clearCreds, setClearCreds] = useState(false)
  const [enabled, setEnabled] = useState(camera?.enabled ?? true)
  const [transcode, setTranscode] = useState(camera?.transcode ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [urlError, setUrlError] = useState('')
  const hasCreds = !!camera?.has_credentials
  const credsPlaceholder = hasCreds && !clearCreds ? '留空表示不修改' : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setUrlError('')
    if (!name.trim()) return setError('请填写名称')
    const url = rtspUrl.trim()
    if (!/^rtsp:\/\//i.test(url)) return setUrlError('地址需要以 rtsp:// 开头')
    const body: CameraInput = {
      name: name.trim(),
      class_id: classId || null,
      location,
      rtsp_url: url,
      enabled,
      transcode,
    }
    if (clearCreds) {
      body.username = null
      body.password = null
    } else {
      // 只带填了的字段:省略 = 不改
      if (username.trim()) body.username = username.trim()
      if (password) body.password = password
    }
    setBusy(true)
    try {
      if (camera) {
        await camerasApi.update(camera.id, body)
        toast(`已保存${body.name}`)
      } else {
        await camerasApi.create(body)
        toast(`已添加${body.name}`)
      }
      void qc.invalidateQueries({ queryKey: ['cameras'] })
      void qc.invalidateQueries({ queryKey: ['camera-wall'] })
      onClose()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '保存失败,请重试'
      if (err instanceof ApiError && err.code.startsWith('RTSP_URL_')) setUrlError(msg)
      else setError(msg)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={camera ? '编辑摄像头' : '新建摄像头'}
      dismissOnOutside={false}
      className="max-w-md"
    >
      <form data-testid="camera-form" onSubmit={(e) => void submit(e)} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="cam-name">名称</Label>
          <Input
            id="cam-name"
            value={name}
            maxLength={30}
            placeholder="如 三年二班教室"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cam-location">位置</Label>
            <NativeSelect
              id="cam-location"
              className="w-full"
              value={location}
              onChange={(e) => setLocation(e.target.value as CameraLocation)}
            >
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cam-class">班级</Label>
            <NativeSelect
              id="cam-class"
              className="w-full"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">公共区域(不绑班级)</option>
              {groupByGrade(classes.data ?? []).map((g) => (
                <optgroup key={g.grade} label={g.grade}>
                  {g.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cam-url">RTSP 地址</Label>
          <Input
            id="cam-url"
            value={rtspUrl}
            maxLength={500}
            autoComplete="off"
            spellCheck={false}
            placeholder="rtsp://192.168.1.10:554/stream1"
            aria-invalid={urlError ? true : undefined}
            onChange={(e) => {
              setRtspUrl(e.target.value)
              setUrlError('')
            }}
          />
          <p className="text-xs text-muted-foreground">
            只能是校园内网地址;用户名密码不要写进地址,填在下面。
          </p>
          {urlError && (
            <p role="alert" className="text-sm text-destructive">
              {urlError}
            </p>
          )}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">登录凭据(摄像头不需要就留空)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cam-user">用户名</Label>
              <Input
                id="cam-user"
                value={username}
                maxLength={200}
                autoComplete="off"
                disabled={clearCreds}
                placeholder={credsPlaceholder}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cam-pass">密码</Label>
              <Input
                id="cam-pass"
                type="password"
                value={password}
                maxLength={200}
                autoComplete="new-password"
                disabled={clearCreds}
                placeholder={credsPlaceholder}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          {hasCreds && !clearCreds && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>已保存用户名和密码(不会显示);留空表示不修改。</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setClearCreds(true)
                  setUsername('')
                  setPassword('')
                }}
              >
                清除凭据
              </Button>
            </div>
          )}
          {clearCreds && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
              <span>保存后将清除已保存的用户名和密码。</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setClearCreds(false)}>
                撤销
              </Button>
            </div>
          )}
        </fieldset>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用(停用后不拉流,也看不到画面)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={transcode}
              onChange={(e) => setTranscode(e.target.checked)}
            />
            转码(摄像头不是 H.264 时勾选,更占 CPU)
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  )
}
