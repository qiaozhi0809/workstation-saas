import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/shared/stores/auth'
import type { CameraInput } from '@/shared/types/camera'
import { camerasApi } from './cameras'
import { timetableApi } from './timetable'

const fetchMock = vi.fn()
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
