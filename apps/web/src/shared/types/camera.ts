export type CameraLocation = '教室' | '走廊' | '操场' | '食堂' | '其他'
export type CameraStatus = 'idle' | 'streaming' | 'error'

export interface CameraOut {
  id: string
  name: string
  class_id: string | null
  class_name: string | null
  location: CameraLocation
  enabled: boolean
  transcode: boolean
  rtsp_url?: string
  has_credentials: boolean
  status: CameraStatus
  last_error: string | null
}
export interface CameraInput {
  name: string
  class_id: string | null
  location: CameraLocation
  rtsp_url: string
  username?: string | null
  password?: string | null
  enabled: boolean
  transcode: boolean
}
/** worker 用 ffprobe 探到的流信息;探测失败或旧 worker 时整个为 null */
export interface StreamProbe {
  /** ffprobe 的 codec_name:'h264' | 'hevc' | 'mpeg4' | … */
  video_codec: string | null
  width: number | null
  height: number | null
  fps: number | null
  bitrate_kbps: number | null
  audio_codec: string | null
  /** h264(或已勾选转码)为 true;false 表示测试通了但浏览器放不出来 */
  browser_playable: boolean
  /** 后端给的中文提示,直接显示 */
  hint: string | null
}
export interface CameraTestResult {
  ok: boolean
  message: string
  preview_jpeg_base64: string | null
  probe: StreamProbe | null
}
export interface CameraBrief {
  id: string
  name: string
  location: CameraLocation
  status: CameraStatus
}
export interface ClassCameras {
  class_id: string
  cameras: CameraBrief[]
  reason: 'homeroom' | 'period' | 'admin'
  period: { no: number; subject: string; ends_at: string } | null
}
export interface CameraWall {
  school_name: string
  timezone: string
  grades: {
    grade_id: string
    grade_name: string
    classes: { class_id: string; class_name: string; cameras: CameraBrief[] }[]
  }[]
  public: CameraBrief[]
}
