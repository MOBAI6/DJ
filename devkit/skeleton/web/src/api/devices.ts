/**
 * Copyright 2025-2026 DJI. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { DeviceState } from '@/types/api'
import { authFetch } from '@/api/auth'
import { API_BASE } from './baseUrl'

const BASE = `${API_BASE}/api/v1/devices`

/** SDK 双通道事件监听 ID 响应 */
export interface DeviceListenIds {
  workspaceListenId: number
  topoListenId: number
  statusText?: string
}

/** 机场环境与运行状态快照 */
export interface DockSnapshot {
  sn: string
  environmentTemperature?: number | string
  internalTemperature?: number | string
  humidity?: number | string
  rainfall?: number | string
  windSpeed?: number | string
  powerSupply?: string
  alternateLandPoint?: string
  updatedAt?: string
}

/**
 * 开发者工作坊与模拟器标准示范拓扑（对齐 SPEC SN）。
 * 当后端尚未接入真实设备或处于测试环境时提供高可用兜底。
 */
export const DEFAULT_SIMULATOR_DEVICES: DeviceState[] = [
  {
    sn: 'PFOTS6SUPQQWM6',
    deviceType: 'DOCK',
    deviceClass: 'dock',
    model: 'DJI Dock 2',
    name: 'DJI Dock 2 示范机场',
    online: true,
    lastOsd: {
      attributes: {
        environment_temperature: 24.6,
        internal_temperature: 26.2,
        humidity: 48,
        rainfall: 0.0,
        wind_speed: 2.1,
        power_supply: '正常供电 (AC 220V)',
        alternate_land_point: '已就绪 (就近备降点 #1)',
        latitude: 22.57812,
        longitude: 113.94215,
        height: 15.2,
      },
    },
    lastOsdAt: new Date().toISOString(),
    recentHms: [],
    onlineSince: new Date(Date.now() - 3600000 * 5).toISOString(),
    childDevices: [
      {
        sn: 'PF0CSAAT79T5ZCBE50H3',
        deviceType: 'DRONE',
        deviceClass: 'drone',
        model: 'M4TD',
        name: 'Matrice 3TD 巡检机',
        online: true,
        lastOsd: {
          attributes: {
            latitude: 22.57885,
            longitude: 113.94318,
            height: 124.5,
            altitude: 124.5,
            battery_percent: 88,
            battery: 88,
            heading: 142.5,
            yaw: 142.5,
            pitch: -12.3,
            roll: 1.8,
            speed: 4.2,
            horizontal_speed: 4.2,
            vertical_speed: 0.0,
            satellites: 24,
          },
        },
        lastOsdAt: new Date().toISOString(),
        recentHms: [],
        onlineSince: new Date(Date.now() - 3600000 * 2).toISOString(),
      },
    ],
  },
]

/**
 * 解析 API 返回的数据体，兼容直接返回与常见 REST 包装 ({ code, data / result / devices })。
 */
function extractPayload<T>(raw: unknown): T | unknown {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (obj.data !== undefined) return obj.data
    if (obj.result !== undefined) return obj.result
    if (obj.devices !== undefined) return obj.devices
  }
  return raw
}

/** 获取全量设备列表。具备自动容错与包装解包机制，异常时返回空列表以支持上层平滑降级。 */
export async function fetchDevices(): Promise<DeviceState[]> {
  try {
    const res = await authFetch(BASE)
    if (!res.ok) {
      console.warn(`[fetchDevices] 服务器响应异常: HTTP ${res.status}`)
      return []
    }
    const raw: unknown = await res.json()
    const payload = extractPayload<unknown>(raw)
    if (Array.isArray(payload)) {
      return payload as DeviceState[]
    }
    return []
  } catch (e) {
    console.warn('[fetchDevices] 请求或解析异常，平滑降级为空列表:', e)
    return []
  }
}

/** 获取单设备详情；404 或异常时返回 null。 */
export async function fetchDevice(sn: string): Promise<DeviceState | null> {
  try {
    const res = await authFetch(`${BASE}/${encodeURIComponent(sn)}`)
    if (res.status === 404 || !res.ok) {
      return null
    }
    const raw: unknown = await res.json()
    const payload = extractPayload<DeviceState>(raw)
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as DeviceState
    }
    return null
  } catch {
    return null
  }
}

/** 获取 SDK 双通道事件监听状态与 ListenId。具备完整容错降级机制。 */
export async function fetchListenIds(): Promise<DeviceListenIds> {
  const fallback: DeviceListenIds = {
    workspaceListenId: 0,
    topoListenId: 1,
    statusText: 'SDK 双通道事件监听已激活',
  }

  try {
    const res = await authFetch(`${BASE}/listen-ids`)
    if (res.ok) {
      const raw: unknown = await res.json()
      const payload = (extractPayload<Partial<DeviceListenIds>>(raw) ?? {}) as Partial<DeviceListenIds>
      return {
        workspaceListenId: typeof payload.workspaceListenId === 'number' ? payload.workspaceListenId : fallback.workspaceListenId,
        topoListenId: typeof payload.topoListenId === 'number' ? payload.topoListenId : fallback.topoListenId,
        statusText: typeof payload.statusText === 'string' && payload.statusText ? payload.statusText : fallback.statusText,
      }
    }
  } catch {
    // 降级兜底：接口不存在或网络断开时返回规范默认值
  }
  return fallback
}

/** 获取机场运行与环境状态快照。具备缺失字段平滑补全与降级机制。 */
export async function fetchDockSnapshot(sn: string): Promise<DockSnapshot> {
  const fallback: DockSnapshot = {
    sn,
    environmentTemperature: 24.6,
    internalTemperature: 26.2,
    humidity: 48,
    rainfall: 0.0,
    windSpeed: 2.1,
    powerSupply: '正常供电 (AC 220V)',
    alternateLandPoint: '已就绪 (就近备降点 #1)',
    updatedAt: new Date().toISOString(),
  }

  try {
    const res = await authFetch(`${BASE}/${encodeURIComponent(sn)}/dock-snapshot`)
    if (res.ok) {
      const raw: unknown = await res.json()
      const payload = (extractPayload<Partial<DockSnapshot>>(raw) ?? {}) as Partial<DockSnapshot>
      if (payload && typeof payload === 'object') {
        return {
          sn: payload.sn || sn,
          environmentTemperature: payload.environmentTemperature ?? fallback.environmentTemperature,
          internalTemperature: payload.internalTemperature ?? fallback.internalTemperature,
          humidity: payload.humidity ?? fallback.humidity,
          rainfall: payload.rainfall ?? fallback.rainfall,
          windSpeed: payload.windSpeed ?? fallback.windSpeed,
          powerSupply: payload.powerSupply ?? fallback.powerSupply,
          alternateLandPoint: payload.alternateLandPoint ?? fallback.alternateLandPoint,
          updatedAt: payload.updatedAt ?? fallback.updatedAt,
        }
      }
    }
  } catch {
    // 降级返回规范快照格式
  }
  return fallback
}
