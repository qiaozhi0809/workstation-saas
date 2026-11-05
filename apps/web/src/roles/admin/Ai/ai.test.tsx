import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/shared/api/admin'
import { ApiError } from '@/shared/api/client'
import { toast } from '@/shared/components/Toast'
import { useAuthStore } from '@/shared/stores/auth'
import type { AiConfigView, AiUsage } from '@/shared/types/admin'
import AdminNav from '../AdminNav'
import AiConfigPage from './AiConfigPage'
import AiUsagePage from './AiUsagePage'

vi.mock('@/shared/api/admin', () => ({
  adminApi: {
    aiUsage: vi.fn(),
    aiConfig: vi.fn(),
    saveAiConfig: vi.fn(),
    clearAiConfig: vi.fn(),
    testAiConfig: vi.fn(),
  },
}))
vi.mock('@/shared/components/Toast', () => ({ toast: vi.fn() }))

const PROVIDERS: AiConfigView['providers'] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.example/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  { id: 'qwen', label: '通义千问', base_url: 'https://qwen.example/v1', models: ['qwen-plus'] },
]
const view = (o: Partial<AiConfigView> = {}): AiConfigView => ({
  provider: 'deepseek',
  base_url: 'https://api.deepseek.example/v1',
  model: 'deepseek-chat',
  temperature: 0.7,
  mask_forced: false,
  key_set: true,
  key_undecryptable: false,
  providers: PROVIDERS,
  ...o,
})

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(adminApi.aiConfig).mockResolvedValue(view())
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().logout()
})

describe('AI 使用', () => {
  const USAGE: AiUsage = {
    month: '2026-11',
    rows: [
      {
        user_id: 'u1',
        display_name: '李老师',
        calls: 12,
        failed: 2,
        prompt_tokens: 3000,
        completion_tokens: 1500,
        top_templates: [
          { template: 'comment', label: '期末评语', count: 8 },
          { template: 'plan', label: '教案', count: 4 },
        ],
      },
      {
        user_id: 'u2',
        display_name: '王老师',
        calls: 3,
        failed: 0,
        prompt_tokens: 400,
        completion_tokens: 200,
        top_templates: [],
      },
    ],
    total: { calls: 15, failed: 2, prompt_tokens: 3400, completion_tokens: 1700 },
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 10, 0, 0))
    vi.mocked(adminApi.aiUsage).mockResolvedValue(USAGE)
  })
  afterEach(() => vi.useRealTimers())

  it('默认请求本月(YYYY-MM),列出各列与合计行', async () => {
    wrap(<AiUsagePage />)
    expect(await screen.findByText('李老师')).toBeInTheDocument()
    expect(adminApi.aiUsage).toHaveBeenCalledWith('2026-11')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '老师',
      '调用次数',
      '失败',
      '输入 token',
      '输出 token',
      '常用场景',
    ])
    expect(screen.getByText('期末评语 × 8、教案 × 4')).toBeInTheDocument()
    const total = screen.getByText('合计').closest('tr') as HTMLElement
    expect(
      within(total)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['合计', '15', '2', '3400', '1700', ''])
  })

  it('切换月份时请求对应月份', async () => {
    wrap(<AiUsagePage />)
    await screen.findByText('李老师')
    fireEvent.click(screen.getByRole('button', { name: '上一月' }))
    await waitFor(() => expect(adminApi.aiUsage).toHaveBeenLastCalledWith('2026-10'))
    expect(screen.getByRole('button', { name: '下一月' })).toBeEnabled()
  })

  it('本月没有记录时显示空状态', async () => {
    vi.mocked(adminApi.aiUsage).mockResolvedValue({
      month: '2026-11',
      rows: [],
      total: { calls: 0, failed: 0, prompt_tokens: 0, completion_tokens: 0 },
    })
    wrap(<AiUsagePage />)
    expect(await screen.findByText('这个月还没有人使用 AI 助手')).toBeInTheDocument()
  })
})

describe('AI 配置', () => {
  const renderConfig = async () => {
    wrap(<AiConfigPage />)
    await screen.findByLabelText('接口地址')
  }

  it('已配置 Key 时占位提示留空不修改;留空保存时 api_key 为 null', async () => {
    vi.mocked(adminApi.saveAiConfig).mockResolvedValue(view())
    await renderConfig()
    const key = screen.getByLabelText('API Key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('placeholder', '已配置,留空则不修改')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(adminApi.saveAiConfig).toHaveBeenCalledWith({
        provider: 'deepseek',
        base_url: 'https://api.deepseek.example/v1',
        model: 'deepseek-chat',
        temperature: 0.7,
        mask_forced: false,
        api_key: null,
      }),
    )
    expect(toast).toHaveBeenCalledWith('已保存')
  })

  it('填了 Key 就带上 Key,并改了强制隐去姓名', async () => {
    vi.mocked(adminApi.saveAiConfig).mockResolvedValue(view({ mask_forced: true }))
    await renderConfig()
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: ' test-key-123 ' } })
    fireEvent.click(screen.getByRole('switch', { name: '强制隐去学生姓名' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(adminApi.saveAiConfig).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: 'test-key-123', mask_forced: true }),
      ),
    )
  })

  it('选服务商后自动填地址与第一个模型', async () => {
    await renderConfig()
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'qwen' } })
    expect(screen.getByLabelText('接口地址')).toHaveValue('https://qwen.example/v1')
    expect(screen.getByLabelText('模型')).toHaveValue('qwen-plus')
  })

  it('模型可以自己输入', async () => {
    vi.mocked(adminApi.saveAiConfig).mockResolvedValue(view())
    await renderConfig()
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'my-model' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(adminApi.saveAiConfig).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'my-model' }),
      ),
    )
  })

  it('没配过 Key 又不填时不发请求,提示填写', async () => {
    vi.mocked(adminApi.aiConfig).mockResolvedValue(
      view({ provider: null, base_url: null, model: null, temperature: null, key_set: false }),
    )
    await renderConfig()
    expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '')
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'deepseek' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请填写 API Key')).toBeInTheDocument()
    expect(adminApi.saveAiConfig).not.toHaveBeenCalled()
  })

  it('温度超出 0 到 2 时不发请求', async () => {
    await renderConfig()
    fireEvent.change(screen.getByLabelText('温度'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('温度需要在 0 到 2 之间')).toBeInTheDocument()
    expect(adminApi.saveAiConfig).not.toHaveBeenCalled()
  })

  it('保存失败显示后端的话', async () => {
    vi.mocked(adminApi.saveAiConfig).mockRejectedValue(
      new ApiError(400, 'BAD_REQUEST', '地址必须以 http 开头(后端)'),
    )
    await renderConfig()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('地址必须以 http 开头(后端)')).toBeInTheDocument()
  })

  it('测试连接失败时显示返回的 message', async () => {
    vi.mocked(adminApi.testAiConfig).mockResolvedValue({ ok: false, message: 'Key 不对或已过期' })
    await renderConfig()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('Key 不对或已过期')).toBeInTheDocument()
    expect(adminApi.testAiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ api_key: null, model: 'deepseek-chat' }),
    )
    expect(adminApi.saveAiConfig).not.toHaveBeenCalled()
  })

  it('测试连接成功显示返回的 message', async () => {
    vi.mocked(adminApi.testAiConfig).mockResolvedValue({ ok: true, message: '连接正常' })
    await renderConfig()
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(await screen.findByText('连接正常')).toBeInTheDocument()
  })

  it('清除配置要先确认,确认后才请求', async () => {
    vi.mocked(adminApi.clearAiConfig).mockResolvedValue(undefined)
    await renderConfig()
    fireEvent.click(screen.getByRole('button', { name: '清除配置' }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('清除后全校老师都无法使用 AI 助手')
    expect(adminApi.clearAiConfig).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(adminApi.clearAiConfig).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '清除配置' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '清除' }))
    await waitFor(() => expect(adminApi.clearAiConfig).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  const NOTICE = '更换服务商或服务地址后需重新填写 API Key'

  it('改了地址的主机且 Key 留空时提示,保存和测试连接都不发请求', async () => {
    await renderConfig()
    expect(screen.queryByText(NOTICE)).toBeNull()
    fireEvent.change(screen.getByLabelText('接口地址'), {
      target: { value: 'https://other.example/v1' },
    })
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(adminApi.saveAiConfig).not.toHaveBeenCalled()
    expect(adminApi.testAiConfig).not.toHaveBeenCalled()
    // 改回去,提示消失
    fireEvent.change(screen.getByLabelText('接口地址'), {
      target: { value: 'https://api.deepseek.example/v1' },
    })
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('填了 Key 后提示消失,保存带上填的 Key', async () => {
    vi.mocked(adminApi.saveAiConfig).mockResolvedValue(view())
    await renderConfig()
    fireEvent.change(screen.getByLabelText('接口地址'), {
      target: { value: 'https://other.example/v1' },
    })
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-key-456' } })
    expect(screen.queryByText(NOTICE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(adminApi.saveAiConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          base_url: 'https://other.example/v1',
          api_key: 'test-key-456',
        }),
      ),
    )
  })

  it('只改路径不提示,保存时 api_key 仍为 null', async () => {
    vi.mocked(adminApi.saveAiConfig).mockResolvedValue(view())
    await renderConfig()
    fireEvent.change(screen.getByLabelText('接口地址'), {
      target: { value: 'https://api.deepseek.example/v2/' },
    })
    expect(screen.queryByText(NOTICE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(adminApi.saveAiConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          base_url: 'https://api.deepseek.example/v2/',
          api_key: null,
        }),
      ),
    )
  })

  it('换服务商(自动填地址)且 Key 留空时提示', async () => {
    await renderConfig()
    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'qwen' } })
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(adminApi.saveAiConfig).not.toHaveBeenCalled()
  })

  it('主机大小写和默认端口写法不同不算换地址', async () => {
    await renderConfig()
    fireEvent.change(screen.getByLabelText('接口地址'), {
      target: { value: 'HTTPS://API.deepseek.example:443/v1' },
    })
    expect(screen.queryByText(NOTICE)).toBeNull()
    fireEvent.change(screen.getByLabelText('接口地址'), {
      target: { value: 'https://api.deepseek.example:8443/v1' },
    })
    expect(screen.getByText(NOTICE)).toBeInTheDocument()
  })

  it('后端返回需要重填 Key 时照常显示它的话', async () => {
    vi.mocked(adminApi.saveAiConfig).mockRejectedValue(new ApiError(400, 'AI_KEY_REQUIRED', NOTICE))
    await renderConfig()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText(NOTICE)).toBeInTheDocument()
  })

  it('Key 无法解密时提示重新填写', async () => {
    vi.mocked(adminApi.aiConfig).mockResolvedValue(view({ key_undecryptable: true }))
    await renderConfig()
    expect(screen.getByText(/已保存的 API Key 无法解密,请重新输入/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请填写 API Key')).toBeInTheDocument()
    expect(adminApi.saveAiConfig).not.toHaveBeenCalled()
  })
})

describe('导航', () => {
  it('只有 settings.manage 的管理员(信息中心)看到 AI 配置,看不到 AI 使用和审计日志', () => {
    useAuthStore.setState({
      accessToken: 'a',
      refreshToken: 'r',
      lastContext: null,
      user: {
        id: 'u',
        display_name: '信息员',
        contexts: ['admin'],
        admin_perms: ['settings.manage'],
        must_change_password: false,
      },
    })
    wrap(<AdminNav />)
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(nav).getByRole('link', { name: 'AI 配置' })).toHaveAttribute(
      'href',
      '/admin/ai/config',
    )
    expect(within(nav).queryByRole('link', { name: 'AI 使用' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: '审计日志' })).toBeNull()
  })

  it('有 ai.usage 和 audit.read 的看到 AI 使用与审计日志', () => {
    useAuthStore.setState({
      accessToken: 'a',
      refreshToken: 'r',
      lastContext: null,
      user: {
        id: 'u',
        display_name: '校长',
        contexts: ['admin'],
        admin_perms: ['ai.usage', 'audit.read'],
        must_change_password: false,
      },
    })
    wrap(<AdminNav />)
    const nav = screen.getByRole('navigation', { name: '主导航' })
    // 两项都有 → 收进"系统"下拉
    fireEvent.click(within(nav).getByRole('button', { name: '系统' }))
    const menu = screen.getByRole('menu', { name: '系统' })
    expect(within(menu).getByRole('menuitem', { name: 'AI 使用' })).toHaveAttribute(
      'href',
      '/admin/ai/usage',
    )
    expect(within(menu).getByRole('menuitem', { name: '审计日志' })).toHaveAttribute(
      'href',
      '/admin/audit',
    )
    expect(within(menu).queryByRole('menuitem', { name: 'AI 配置' })).toBeNull()
  })
})
