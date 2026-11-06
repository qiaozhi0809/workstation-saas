import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { ErrorState } from '@/shared/components/feedback/ErrorState'
import { LoadingState } from '@/shared/components/feedback/LoadingState'
import { toast } from '@/shared/components/Toast'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { NativeSelect } from '@/shared/components/ui/native-select'
import type { AiConfigSave, AiConfigView } from '@/shared/types/admin'
import ConfirmBox from '../Org/ConfirmBox'

const DEFAULT_TEMPERATURE = 0.7
const KEY_RENEW_NOTICE = '更换服务商或服务地址后需重新填写 API Key'
/** 因上面那条常驻提示拦下保存 / 测试时,按钮旁给出的原因(L59:不再静默) */
const KEY_RENEW_BLOCKED = '已更换服务商或服务地址,请先填写新的 API Key'

/** 只比 scheme + host + port(大小写不敏感,默认端口等同显式端口,忽略路径);解析不了就比原字符串 */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a.trim()).origin.toLowerCase() === new URL(b.trim()).origin.toLowerCase()
  } catch {
    return a.trim() === b.trim()
  }
}

function ConfigForm({ view }: { view: AiConfigView }) {
  const qc = useQueryClient()
  const [provider, setProvider] = useState(view.provider ?? '')
  const [baseUrl, setBaseUrl] = useState(view.base_url ?? '')
  const [model, setModel] = useState(view.model ?? '')
  const [temperature, setTemperature] = useState(String(view.temperature ?? DEFAULT_TEMPERATURE))
  const [maskForced, setMaskForced] = useState(view.mask_forced)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState<'' | 'test' | 'save' | 'clear'>('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearError, setClearError] = useState('')

  // 已存了配置,换服务商或换服务地址的主机时,旧 Key 不能沿用
  const keyEmpty = apiKey.trim() === ''
  const needKeyRenew =
    view.key_set &&
    !view.key_undecryptable &&
    keyEmpty &&
    view.provider !== null &&
    view.base_url !== null &&
    (provider !== view.provider || !sameOrigin(baseUrl, view.base_url))

  const current = view.providers.find((p) => p.id === provider)
  const models = current?.models ?? []

  const pickProvider = (id: string) => {
    setProvider(id)
    const p = view.providers.find((x) => x.id === id)
    if (p) {
      setBaseUrl(p.base_url)
      setModel(p.models[0] ?? '')
    }
    // 上一次的校验错误 / 测试结果是针对旧服务商的,换了就清掉(L59)
    setError('')
    setTest(null)
  }

  /** 校验通过返回请求体;留空的 Key 一律是 null(沿用已存的) */
  const build = (): AiConfigSave | null => {
    const t = Number(temperature)
    const key = apiKey.trim()
    if (!provider) return fail('请选择服务商')
    if (!baseUrl.trim()) return fail('请填写接口地址')
    // scheme 不分大小写:URL 规范里 HTTPS:// 与 https:// 等价,后端也接受
    if (!/^https?:\/\//i.test(baseUrl.trim())) return fail('接口地址要以 http:// 或 https:// 开头')
    if (!model.trim()) return fail('请填写模型')
    if (temperature.trim() === '' || !Number.isFinite(t) || t < 0 || t > 2)
      return fail('温度需要在 0 到 2 之间')
    if (needKeyRenew) return fail(KEY_RENEW_BLOCKED)
    if (!key && (!view.key_set || view.key_undecryptable)) return fail('请填写 API Key')
    setError('')
    return {
      provider,
      base_url: baseUrl.trim(),
      model: model.trim(),
      temperature: t,
      mask_forced: maskForced,
      api_key: key || null,
    }
  }
  function fail(msg: string): null {
    setError(msg)
    return null
  }

  const onTest = async () => {
    const body = build()
    if (!body) return
    setBusy('test')
    setTest(null)
    try {
      setTest(await adminApi.testAiConfig(body))
    } catch (err) {
      setTest({ ok: false, message: err instanceof ApiError ? err.message : '测试失败,请重试' })
    } finally {
      setBusy('')
    }
  }

  const onSave = async () => {
    const body = build()
    if (!body) return
    setBusy('save')
    try {
      const saved = await adminApi.saveAiConfig(body)
      qc.setQueryData(['ai-config'], saved)
      setApiKey('')
      setTest(null)
      toast('已保存')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败,请重试')
    } finally {
      setBusy('')
    }
  }

  const onClear = async () => {
    setBusy('clear')
    setClearError('')
    try {
      await adminApi.clearAiConfig()
      setConfirmClear(false)
      toast('已清除配置')
      await qc.invalidateQueries({ queryKey: ['ai-config'] })
    } catch (err) {
      setClearError(err instanceof ApiError ? err.message : '清除失败,请重试')
    } finally {
      setBusy('')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 助手服务</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.key_undecryptable && (
          <p
            role="alert"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            已保存的 API Key 无法解密,请重新输入 API Key 后保存。
          </p>
        )}
        {needKeyRenew && (
          <p
            role="alert"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            {KEY_RENEW_NOTICE}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            服务商
            <NativeSelect
              aria-label="服务商"
              className="w-full"
              value={provider}
              onChange={(e) => pickProvider(e.target.value)}
            >
              {!provider && <option value="">请选择</option>}
              {view.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm">
            模型
            <Input
              aria-label="模型"
              list="ai-model-suggestions"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id="ai-model-suggestions">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            接口地址
            <Input
              aria-label="接口地址"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            温度
            <Input
              aria-label="温度"
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            API Key
            <Input
              aria-label="API Key"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={view.key_set ? '已配置,留空则不修改' : ''}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
        </div>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            id="ai-mask"
            aria-label="强制隐去学生姓名"
            className="mt-1"
            checked={maskForced}
            onChange={(e) => setMaskForced(e.target.checked)}
          />
          <div className="text-sm">
            <label htmlFor="ai-mask">强制隐去学生姓名</label>
            <p className="text-xs text-muted-foreground">
              打开后,发给 AI 的内容里学生姓名一律替换掉,老师不能关闭
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {test && (
          <p
            role="status"
            className={test.ok ? 'text-sm text-success' : 'text-sm text-destructive'}
          >
            {test.message}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="mr-auto text-destructive"
            disabled={busy !== ''}
            onClick={() => {
              setClearError('')
              setConfirmClear(true)
            }}
          >
            清除配置
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== ''}
            onClick={() => void onTest()}
          >
            测试连接
          </Button>
          <Button type="button" disabled={busy !== ''} onClick={() => void onSave()}>
            保存
          </Button>
        </div>
      </CardContent>

      <ConfirmBox
        open={confirmClear}
        title="清除 AI 配置"
        confirmLabel="清除"
        busy={busy === 'clear'}
        error={clearError}
        onConfirm={() => void onClear()}
        onClose={() => setConfirmClear(false)}
      >
        <p>清除后全校老师都无法使用 AI 助手</p>
      </ConfirmBox>
    </Card>
  )
}

export default function AiConfigPage() {
  const q = useQuery({ queryKey: ['ai-config'], queryFn: adminApi.aiConfig })
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold">AI 配置</h1>
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          title={q.error instanceof ApiError ? q.error.message : '加载失败,请重试'}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      ) : (
        // 服务端配置变了(保存 / 清除后)就重建表单,让输入框回到服务端的值
        <ConfigForm
          key={JSON.stringify([
            q.data.provider,
            q.data.base_url,
            q.data.model,
            q.data.temperature,
            q.data.mask_forced,
            q.data.key_set,
            q.data.key_undecryptable,
          ])}
          view={q.data}
        />
      )}
    </div>
  )
}
