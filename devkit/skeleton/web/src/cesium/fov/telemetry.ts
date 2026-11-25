// Copyright (c) 2026 SZ DJI Technology Co., Ltd.
// SPDX-License-Identifier: Apache-2.0

export interface TelemetryMessage {
  uuid?: string
  /** mqtt_osd | drc_camera | sei | payload_range */
  type: 'mqtt_osd' | 'drc_camera' | 'sei' | 'payload_range' | string
  ts?: number
  gatewaySn?: string
  /** mqtt_osd 子字段，如 location / attitude / gimbalAttitude */
  field?: string
  data: Record<string, unknown>
}

export type TelemetryHandler = (msg: TelemetryMessage) => void

let ws: WebSocket | null = null
const handlers = new Set<TelemetryHandler>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/pf-devkit/ai-plugin/skeleton/api/v1/ws/telemetry`
}

function attachHandlers(socket: WebSocket) {
  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as TelemetryMessage
      handlers.forEach((h) => h(msg))
    } catch {
      /* ignore */
    }
  }
  socket.onclose = () => {
    if (ws === socket) {
      ws = null
    }
  }
  socket.onerror = () => {
    if (ws === socket) {
      try {
        socket.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
  }
}

export function connectTelemetry(onMessage: TelemetryHandler): Promise<void> {
  handlers.add(onMessage)
  if (ws?.readyState === WebSocket.OPEN) {
    return Promise.resolve()
  }
  if (ws?.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      ws!.addEventListener('open', () => resolve(), { once: true })
      ws!.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    try {
      const socket = new WebSocket(wsUrl())
      ws = socket
      attachHandlers(socket)
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => {
        reject(new Error('WebSocket connection failed'))
      }, { once: true })
    } catch (e) {
      reject(e)
    }
  })
}

export function disconnectTelemetry(onMessage?: TelemetryHandler) {
  if (onMessage) {
    handlers.delete(onMessage)
  }
  if (handlers.size === 0 && ws) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    try {
      ws.close()
    } catch {
      /* ignore */
    }
    ws = null
  }
}

export function isWsOpen(): boolean {
  return ws?.readyState === WebSocket.OPEN
}
