import type {
  CameraInput,
  CameraOut,
  CameraTestResult,
  CameraWall,
  ClassCameras,
} from '@/shared/types/camera'
import { API_BASE, api } from './client'

export const camerasApi = {
  list: () => api<CameraOut[]>('GET', '/admin/cameras'),
  create: (body: CameraInput) => api<CameraOut>('POST', '/admin/cameras', body),
  update: (id: string, body: CameraInput) => api<CameraOut>('PUT', `/admin/cameras/${id}`, body),
  remove: (id: string) => api<void>('DELETE', `/admin/cameras/${id}`),
  test: (id: string) => api<CameraTestResult>('POST', `/admin/cameras/${id}/test`),
  health: () => api<{ public_hosts: string[] }>('GET', '/admin/cameras/health'),
  classCameras: (classId: string) => api<ClassCameras>('GET', `/classes/${classId}/cameras`),
  wall: () => api<CameraWall>('GET', '/admin/camera-wall'),
  playlistUrl: (id: string) => `${API_BASE}/cameras/${id}/stream.m3u8`,
}
