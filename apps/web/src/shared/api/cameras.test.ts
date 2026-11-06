import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { CameraInput } from '@/shared/types/camera'
import { camerasApi } from './cameras'
import { timetableApi } from './timetable'

const fetchMock = vi.fn()
afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  useAuthStore.setState({ accessToken: 'a', refreshToken: 'r' })
})

const last = () => {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return { url: url as string, init }
}
const input: CameraInput = {
  name: '测试机位',
  class_id: null,
  location: '走廊',
  rtsp_url: 'rtsp://example.invalid/1',
  enabled: true,
  transcode: false,
}

it('cameras api uses the frozen paths and methods', async () => {
  const cases: [() => Promise<unknown>, string, string][] = [
    [() => camerasApi.list(), 'GET', '/api/v1/admin/cameras'],
    [() => camerasApi.create(input), 'POST', '/api/v1/admin/cameras'],
    [() => camerasApi.update('c1', input), 'PUT', '/api/v1/admin/cameras/c1'],
    [() => camerasApi.test('c1'), 'POST', '/api/v1/admin/cameras/c1/test'],
    [() => camerasApi.health(), 'GET', '/api/v1/admin/cameras/health'],
    [() => camerasApi.classCameras('k1'), 'GET', '/api/v1/classes/k1/cameras'],
    [() => camerasApi.wall(), 'GET', '/api/v1/admin/camera-wall'],
  ]
  for (const [call, method, url] of cases) {
    await call()
    expect(last().init.method).toBe(method)
    expect(last().url).toBe(url)
  }
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
  await camerasApi.remove('c1')
  expect(last().init.method).toBe('DELETE')
  expect(last().url).toBe('/api/v1/admin/cameras/c1')
  expect(camerasApi.playlistUrl('c1')).toBe('/api/v1/cameras/c1/stream.m3u8')
})

it('timetable api uses the frozen paths and methods', async () => {
  await timetableApi.periods()
  expect([last().init.method, last().url]).toEqual(['GET', '/api/v1/periods'])
  await timetableApi.savePeriods([{ no: 1, starts_at: '08:00', ends_at: '08:40' }])
  expect([last().init.method, last().url]).toEqual(['PUT', '/api/v1/admin/periods'])
  expect(JSON.parse(last().init.body).periods).toHaveLength(1)
  await timetableApi.classTimetable('k1')
  expect(last().url).toBe('/api/v1/classes/k1/timetable')
  await timetableApi.saveClassTimetable('k1', [
    { weekday: 1, period_no: 1, subject: '语文', teacher_id: null },
  ])
  expect([last().init.method, last().url]).toEqual(['PUT', '/api/v1/admin/classes/k1/timetable'])
  expect(JSON.parse(last().init.body).cells[0].teacher_id).toBeNull()
})

it('timetable csv import posts text/csv with auth', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, written: 2, errors: [] }), { status: 200 }),
  )
  const file = new File(['a,b\n1,2'], 't.csv', { type: 'text/csv' })
  const r = await timetableApi.importCsv(file)
  expect(r.written).toBe(2)
  const { url, init } = last()
  expect(url).toBe('/api/v1/admin/timetable/import')
  expect(init.method).toBe('POST')
  expect(init.headers['Content-Type']).toBe('text/csv')
  expect(init.headers.Authorization).toBe('Bearer a')
})

it('timetable csv import throws ApiError on failure', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { code: 'BAD_CSV', message: 'x' } }), { status: 422 }),
  )
  await expect(timetableApi.importCsv(new File(['x'], 't.csv'))).rejects.toMatchObject({
    code: 'BAD_CSV',
  })
})

describe('timetable csv 401 handling', () => {
  const res401 = () =>
    new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }), {
      status: 401,
    })
  const refreshOk = () => new Response(JSON.stringify({ access_token: 'new' }), { status: 200 })
  const file = () => new File(['x'], 't.csv')

  it('refreshes and resends once with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(res401())
      .mockResolvedValueOnce(refreshOk())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, written: 1, errors: [] }), { status: 200 }),
      )
    const r = await timetableApi.importCsv(file())
    expect(r.written).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer a')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new')
    expect(fetchMock.mock.calls[2][1].headers['Content-Type']).toBe('text/csv')
    expect(fetchMock.mock.calls[2][1].body).toBeInstanceOf(File)
  })

  it('logs out and throws when refresh is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(res401())
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(timetableApi.importCsv(file())).rejects.toMatchObject({ status: 401 })
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('keeps the session and throws the original 401 on network failure', async () => {
    fetchMock.mockResolvedValueOnce(res401()).mockRejectedValueOnce(new TypeError('offline'))
    await expect(timetableApi.importCsv(file())).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    })
    expect(useAuthStore.getState().accessToken).toBe('a')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('logs out when the resend is 401 again', async () => {
    fetchMock
      .mockResolvedValueOnce(res401())
      .mockResolvedValueOnce(refreshOk())
      .mockResolvedValueOnce(res401())
    await expect(timetableApi.importCsv(file())).rejects.toMatchObject({ status: 401 })
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not refresh on a business 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'TOTP_INVALID', message: 'x' } }), {
        status: 401,
      }),
    )
    await expect(timetableApi.importCsv(file())).rejects.toMatchObject({ code: 'TOTP_INVALID' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().accessToken).toBe('a')
  })
})
