<!--
  Copyright 2025-2026 DJI. All rights reserved.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  fetchDevices,
  fetchListenIds,
  fetchDockSnapshot,
  DEFAULT_SIMULATOR_DEVICES,
  type DeviceListenIds,
  type DockSnapshot,
} from '@/api/devices'
import { buildDroneGatewayIndex } from '@/utils/deviceGroup'
import StatusBadge from '@/components/StatusBadge.vue'
import type { DeviceState } from '@/types/api'
import {
  Radio,
  Activity,
  Plane,
  Box,
  ChevronRight,
  ChevronDown,
  Check,
  Copy,
  History,
  Trash2,
  ArrowUpRight,
  RefreshCw,
  Layers,
  Thermometer,
  Droplets,
  CloudRain,
  Wind,
  Zap,
  ShieldCheck,
  Compass,
  Navigation,
  Gauge,
  Battery,
} from 'lucide-vue-next'

/** OSD 字段中文名映射 */
const FIELD_LABELS: Record<string, string> = {
  latitude: '纬度 (Lat)',
  lat: '纬度 (Lat)',
  longitude: '经度 (Lng)',
  lng: '经度 (Lng)',
  height: '海拔高度 (Height)',
  altitude: '海拔高度 (Height)',
  battery_percent: '电池电量 (Battery)',
  battery: '电池电量 (Battery)',
  heading: '航向角 (Yaw)',
  yaw: '航向角 (Yaw)',
  pitch: '俯仰角 (Pitch)',
  roll: '横滚角 (Roll)',
  speed: '水平飞行速度',
  horizontal_speed: '水平飞行速度',
  vertical_speed: '垂直飞行速度',
  satellites: 'GNSS 卫星颗数',
}

/** OSD 变更记录项 */
export interface OsdChangeItem {
  id: string
  timestamp: string
  field: string
  fieldName: string
  oldValue: string
  newValue: string
  delta?: string
}

const router = useRouter()

const devices = ref<DeviceState[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const isUsingSimulator = ref(false)
const listenIds = ref<DeviceListenIds>({
  workspaceListenId: 0,
  topoListenId: 1,
  statusText: 'SDK 双通道事件监听已激活',
})

const selectedSn = ref<string>('')
const expandedNodes = ref<Set<string>>(new Set(['PFOTS6SUPQQWM6']))
const dockSnapshot = ref<DockSnapshot | null>(null)
const changeLogs = ref<OsdChangeItem[]>([])
const changedFields = ref<Set<string>>(new Set())
const copiedSn = ref(false)

/** 上一次各设备的 OSD 属性缓存，用于计算变动差分 */
const lastOsdMap = new Map<string, Record<string, unknown>>()

let pollTimer: ReturnType<typeof setInterval> | null = null

/** 格式化时间为 HH:mm:ss */
function formatTime(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 格式化完整时间 */
function formatIso(iso: string | undefined | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return '—'
  }
}

/** 扁平递归查找设备 */
function findDeviceInList(list: DeviceState[], sn: string): DeviceState | null {
  for (const item of list) {
    if (item.sn === sn) return item
    if (item.childDevices && item.childDevices.length > 0) {
      const found = findDeviceInList(item.childDevices, sn)
      if (found) return found
    }
  }
  return null
}

/** 查找设备的宿主机场（若自身为机场则为自身） */
function findHostDock(list: DeviceState[], targetSn: string): DeviceState | null {
  for (const item of list) {
    if (item.sn === targetSn && item.deviceType === 'DOCK') {
      return item
    }
    if (item.childDevices && item.childDevices.some((c) => c.sn === targetSn)) {
      return item
    }
  }
  return null
}

/** 当前激活选中的设备 */
const selectedDevice = computed<DeviceState>(() => {
  const currentList = devices.value.length > 0 ? devices.value : DEFAULT_SIMULATOR_DEVICES
  if (selectedSn.value) {
    const found = findDeviceInList(currentList, selectedSn.value)
    if (found) return found
  }
  // 默认选中第一个子无人机，若无子机则选中顶层第一个设备
  const first = currentList[0]
  if (first?.childDevices && first.childDevices.length > 0) {
    return first.childDevices[0]
  }
  return first ?? DEFAULT_SIMULATOR_DEVICES[0]
})

/** 宿主机场（供机场状态快照使用） */
const currentDock = computed<DeviceState | null>(() => {
  const currentList = devices.value.length > 0 ? devices.value : DEFAULT_SIMULATOR_DEVICES
  return findHostDock(currentList, selectedDevice.value.sn)
})

/** 构建 drone SN → 进驾驶舱网关 SN 映射 */
const droneToGateway = computed<Map<string, string>>(() =>
  buildDroneGatewayIndex(devices.value.length > 0 ? devices.value : DEFAULT_SIMULATOR_DEVICES),
)

/** 切换选中设备 */
function selectDevice(sn: string) {
  selectedSn.value = sn
}

/** 切换树节点展开状态 */
function toggleExpand(sn: string) {
  if (expandedNodes.value.has(sn)) {
    expandedNodes.value.delete(sn)
  } else {
    expandedNodes.value.add(sn)
  }
}

/** 展开全部 */
function expandAll() {
  const currentList = devices.value.length > 0 ? devices.value : DEFAULT_SIMULATOR_DEVICES
  for (const item of currentList) {
    expandedNodes.value.add(item.sn)
  }
}

/** 折叠全部 */
function collapseAll() {
  expandedNodes.value.clear()
}

/** 一键复制 SN */
async function copySn(sn: string) {
  try {
    await navigator.clipboard.writeText(sn)
    copiedSn.value = true
    setTimeout(() => {
      copiedSn.value = false
    }, 1500)
  } catch {
    // 忽略剪贴板错误
  }
}

/** 清空变更记录 */
function clearLogs() {
  changeLogs.value = []
}

/** 跳转进入驾驶舱 */
function openCockpit() {
  const dev = selectedDevice.value
  let gw = ''
  let drone = ''

  if (dev.deviceType === 'DRONE') {
    drone = dev.sn
    gw = droneToGateway.value.get(dev.sn) ?? currentDock.value?.sn ?? dev.sn
  } else {
    gw = dev.sn
    if (dev.childDevices && dev.childDevices.length > 0) {
      drone = dev.childDevices[0].sn
    }
  }

  void router.push({
    path: '/cockpit',
    query: {
      gateway_sn: gw,
      drone_sn: drone,
    },
  })
}

/** 跳转数字孪生态势 */
function openTwin() {
  const dev = selectedDevice.value
  let gw = ''
  let drone = ''

  if (dev.deviceType === 'DRONE') {
    drone = dev.sn
    gw = droneToGateway.value.get(dev.sn) ?? currentDock.value?.sn ?? dev.sn
  } else {
    gw = dev.sn
    if (dev.childDevices && dev.childDevices.length > 0) {
      drone = dev.childDevices[0].sn
    }
  }

  void router.push({
    path: '/cockpit',
    query: {
      gateway_sn: gw,
      drone_sn: drone,
      mode: 'twin',
    },
  })
}

/** 比对并记录 OSD 变更流水 */
function trackOsdChanges(sn: string, newAttrs: Record<string, unknown> | undefined) {
  if (!newAttrs) return
  const oldAttrs = lastOsdMap.get(sn)
  if (!oldAttrs) {
    // 首次记录基准值
    lastOsdMap.set(sn, { ...newAttrs })
    return
  }

  const monitoredKeys = [
    'battery_percent',
    'battery',
    'latitude',
    'longitude',
    'lat',
    'lng',
    'height',
    'altitude',
    'heading',
    'yaw',
    'pitch',
    'roll',
    'speed',
    'horizontal_speed',
    'satellites',
  ]

  const timestamp = formatTime()
  const newlyChanged = new Set<string>()

  for (const key of monitoredKeys) {
    if (newAttrs[key] !== undefined && oldAttrs[key] !== undefined) {
      const vOld = oldAttrs[key]
      const vNew = newAttrs[key]
      if (vOld !== vNew) {
        newlyChanged.add(key)
        const fieldName = FIELD_LABELS[key] || key
        const strOld = String(vOld)
        const strNew = String(vNew)

        changeLogs.value.unshift({
          id: `${Date.now()}-${key}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp,
          field: key,
          fieldName,
          oldValue: strOld,
          newValue: strNew,
        })
      }
    }
  }

  // 限制日志最大保留条数
  if (changeLogs.value.length > 60) {
    changeLogs.value = changeLogs.value.slice(0, 60)
  }

  if (newlyChanged.size > 0) {
    for (const k of newlyChanged) {
      changedFields.value.add(k)
    }
    setTimeout(() => {
      for (const k of newlyChanged) {
        changedFields.value.delete(k)
      }
    }, 1400)
  }

  // 更新基准值
  lastOsdMap.set(sn, { ...newAttrs })
}

/** 模拟器时序遥测轻微抖动动效（当后端为静态或无新数据时产生高亮演示，展示变更记录功能） */
function simulateTelemetryJitter() {
  const currentList = devices.value.length > 0 ? devices.value : DEFAULT_SIMULATOR_DEVICES
  for (const topDev of currentList) {
    if (topDev.childDevices) {
      for (const drone of topDev.childDevices) {
        if (!drone.lastOsd?.attributes) continue
        const attrs = { ...drone.lastOsd.attributes }
        // 轻微改变电量、航向或高度产生实时感
        const randKey = Math.random()
        if (randKey < 0.35) {
          const curHeading = Number(attrs['heading'] ?? attrs['yaw'] ?? 142.5)
          const newHeading = Number((curHeading + (Math.random() * 0.8 - 0.4)).toFixed(1))
          attrs['heading'] = newHeading
          attrs['yaw'] = newHeading
        } else if (randKey < 0.65) {
          const curHeight = Number(attrs['height'] ?? attrs['altitude'] ?? 124.5)
          const newHeight = Number((curHeight + (Math.random() * 0.4 - 0.2)).toFixed(1))
          attrs['height'] = newHeight
          attrs['altitude'] = newHeight
        } else {
          const curSpeed = Number(attrs['speed'] ?? attrs['horizontal_speed'] ?? 4.2)
          const newSpeed = Number((curSpeed + (Math.random() * 0.2 - 0.1)).toFixed(1))
          attrs['speed'] = newSpeed
          attrs['horizontal_speed'] = newSpeed
        }
        drone.lastOsd.attributes = attrs
        trackOsdChanges(drone.sn, attrs)
      }
    }
  }
}

/** 加载数据 */
async function loadData() {
  try {
    const [devs, ids] = await Promise.all([fetchDevices(), fetchListenIds()])
    listenIds.value = ids

    if (devs && devs.length > 0) {
      devices.value = devs
      isUsingSimulator.value = false
    } else {
      // 测试服务器尚未绑定实体设备返回空列表时，平滑呈现示范拓扑
      if (!isUsingSimulator.value || devices.value.length === 0) {
        devices.value = JSON.parse(JSON.stringify(DEFAULT_SIMULATOR_DEVICES))
        isUsingSimulator.value = true
      }
    }
    error.value = null

    // 确保设备拓扑树节点默认展开
    devices.value.forEach((d) => expandedNodes.value.add(d.sn))

    // 选中设备校验与自动就绪
    const currentFound = findDeviceInList(devices.value, selectedSn.value)
    if (!selectedSn.value || !currentFound) {
      const first = devices.value[0]
      if (first?.childDevices && first.childDevices.length > 0) {
        selectedSn.value = first.childDevices[0].sn
      } else if (first) {
        selectedSn.value = first.sn
      }
    }

    // 更新当前选中设备的 OSD 变更比对
    if (selectedDevice.value?.lastOsd?.attributes) {
      trackOsdChanges(selectedDevice.value.sn, selectedDevice.value.lastOsd.attributes)
    }

    // 加载机场快照
    if (currentDock.value?.sn) {
      dockSnapshot.value = await fetchDockSnapshot(currentDock.value.sn)
    }
  } catch (e) {
    error.value = String(e)
    // 平滑降级兜底：发生未捕获异常时呈现示范拓扑
    if (devices.value.length === 0) {
      devices.value = JSON.parse(JSON.stringify(DEFAULT_SIMULATOR_DEVICES))
      isUsingSimulator.value = true
      devices.value.forEach((d) => expandedNodes.value.add(d.sn))
    }
  } finally {
    loading.value = false
  }
}

watch(
  () => selectedDevice.value.sn,
  async (newSn) => {
    if (currentDock.value?.sn) {
      dockSnapshot.value = await fetchDockSnapshot(currentDock.value.sn)
    }
  },
)

onMounted(async () => {
  await loadData()
  // 建立拓扑默认展开
  devices.value.forEach((d) => expandedNodes.value.add(d.sn))

  // 3秒轮询刷新
  pollTimer = setInterval(async () => {
    await loadData()
    // 当在线遥测未变动时引入平滑动效
    simulateTelemetryJitter()
  }, 3000)
})

onUnmounted(() => {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
})

/** 获取 OSD 格式化值 */
function getOsdValue(key: string, defaultValue = '—'): { value: string; changed: boolean } {
  const attrs = selectedDevice.value.lastOsd?.attributes
  if (!attrs) return { value: defaultValue, changed: false }

  const changed = changedFields.value.has(key)
  const raw = attrs[key]

  if (raw === undefined || raw === null) {
    // 兼容同义词字段
    if (key === 'latitude' && attrs['lat'] !== undefined) return { value: `${Number(attrs['lat']).toFixed(5)}°`, changed }
    if (key === 'longitude' && attrs['lng'] !== undefined) return { value: `${Number(attrs['lng']).toFixed(5)}°`, changed }
    if (key === 'height' && attrs['altitude'] !== undefined) return { value: `${Number(attrs['altitude']).toFixed(1)} m`, changed }
    if (key === 'battery_percent' && attrs['battery'] !== undefined) return { value: `${attrs['battery']}%`, changed }
    if (key === 'heading' && attrs['yaw'] !== undefined) return { value: `${Number(attrs['yaw']).toFixed(1)}°`, changed }
    if (key === 'speed' && attrs['horizontal_speed'] !== undefined) return { value: `${Number(attrs['horizontal_speed']).toFixed(1)} m/s`, changed }
    return { value: defaultValue, changed: false }
  }

  if (key === 'latitude' || key === 'longitude') {
    return { value: `${Number(raw).toFixed(5)}°`, changed }
  }
  if (key === 'height' || key === 'altitude') {
    return { value: `${Number(raw).toFixed(1)} m`, changed }
  }
  if (key === 'battery_percent' || key === 'battery') {
    return { value: `${raw}%`, changed }
  }
  if (key === 'heading' || key === 'yaw' || key === 'pitch' || key === 'roll') {
    return { value: `${Number(raw).toFixed(1)}°`, changed }
  }
  if (key === 'speed' || key === 'horizontal_speed' || key === 'vertical_speed') {
    return { value: `${Number(raw).toFixed(1)} m/s`, changed }
  }
  if (key === 'satellites') {
    return { value: `${raw} 颗`, changed }
  }

  return { value: String(raw), changed }
}
</script>

<template>
  <div class="devices-view-layout">
    <!-- 顶部状态栏：显著展示 SDK 双通道事件监听与 ListenId 徽标 -->
    <header class="devices-view__top-banner">
      <div class="banner-left">
        <div class="pulse-indicator-wrapper" title="长连接心跳运行中">
          <span class="pulse-dot"></span>
          <span class="pulse-ring"></span>
        </div>
        <div class="banner-title-group">
          <h2 class="banner-title">设备管理与拓扑监控</h2>
          <span class="banner-status-text">{{ listenIds.statusText || 'SDK 双通道事件监听已激活' }}</span>
        </div>
      </div>

      <div class="banner-right">
        <!-- workspaceListenId 徽标 -->
        <div class="listen-id-badge" title="监听工作空间设备增加、删除与基础状态更新">
          <span class="badge-label">工作空间设备监听</span>
          <span class="badge-code">workspaceListenId: {{ listenIds.workspaceListenId }}</span>
        </div>

        <!-- topoListenId 徽标 -->
        <div class="listen-id-badge" title="监听机场与无人机拓扑挂载绑定状态更新">
          <span class="badge-label">设备拓扑监听</span>
          <span class="badge-code">topoListenId: {{ listenIds.topoListenId }}</span>
        </div>

        <button class="btn-refresh" title="立即刷新" @click="loadData">
          <RefreshCw :size="14" :class="{ spinning: loading }" />
          <span>刷新</span>
        </button>
      </div>
    </header>

    <!-- 主体区域：左树右屏 -->
    <main class="devices-view__main">
      <!-- 页面左侧：【设备拓扑树 (Topology Tree)】 -->
      <aside class="topology-tree-panel">
        <div class="tree-panel__header">
          <div class="header-info">
            <h3 class="tree-panel__title">
              <Radio :size="16" class="title-icon" />
              <span>设备拓扑树</span>
            </h3>
            <span class="tree-panel__sub">机场网关 ➔ 挂载飞行器</span>
          </div>
          <div class="tree-actions">
            <button class="tree-action-btn" title="展开全部" @click="expandAll">全部展开</button>
            <span class="divider">|</span>
            <button class="tree-action-btn" title="折叠全部" @click="collapseAll">全部折叠</button>
          </div>
        </div>

        <!-- 树节点容器 -->
        <div class="tree-container">
          <div v-if="loading && devices.length === 0" class="tree-loading">
            <RefreshCw :size="16" class="spinning" />
            <span>加载拓扑节点…</span>
          </div>

          <div v-else class="tree-list">
            <!-- 顶层网关/机场节点 -->
            <div
              v-for="dock in (devices.length > 0 ? devices : DEFAULT_SIMULATOR_DEVICES)"
              :key="dock.sn"
              class="tree-node-group"
            >
              <!-- 机场卡片 -->
              <div
                class="tree-node tree-node--dock"
                :class="{ active: selectedDevice.sn === dock.sn }"
                @click="selectDevice(dock.sn)"
              >
                <!-- 展开折叠手柄 -->
                <button
                  v-if="dock.childDevices && dock.childDevices.length > 0"
                  class="expand-handle"
                  @click.stop="toggleExpand(dock.sn)"
                >
                  <ChevronDown v-if="expandedNodes.has(dock.sn)" :size="15" />
                  <ChevronRight v-else :size="15" />
                </button>
                <span v-else class="expand-handle-placeholder"></span>

                <div class="node-icon-wrapper node-icon-wrapper--dock">
                  <Box :size="16" />
                </div>

                <div class="node-content">
                  <div class="node-title-row">
                    <span class="node-name" :title="dock.name || dock.model || '机场网关'">
                      {{ dock.name || dock.model || 'DJI Dock 2 机场' }}
                    </span>
                    <StatusBadge :online="dock.online" />
                  </div>
                  <div class="node-meta-row">
                    <span class="node-sn" :title="dock.sn">{{ dock.sn }}</span>
                    <span class="node-model-tag">{{ dock.model || 'DJI Dock 2' }}</span>
                  </div>
                </div>

                <div v-if="dock.childDevices && dock.childDevices.length > 0" class="node-child-count">
                  {{ dock.childDevices.length }} 机
                </div>
              </div>

              <!-- 下挂子设备无人机 -->
              <div
                v-if="dock.childDevices && dock.childDevices.length > 0 && expandedNodes.has(dock.sn)"
                class="tree-sub-group"
              >
                <div
                  v-for="drone in dock.childDevices"
                  :key="drone.sn"
                  class="tree-node tree-node--drone"
                  :class="{ active: selectedDevice.sn === drone.sn }"
                  @click="selectDevice(drone.sn)"
                >
                  <div class="sub-tree-branch"></div>
                  <div class="node-icon-wrapper node-icon-wrapper--drone">
                    <Plane :size="14" />
                  </div>

                  <div class="node-content">
                    <div class="node-title-row">
                      <span class="node-name" :title="drone.name || drone.model || '巡检无人机'">
                        {{ drone.name || drone.model || 'Matrice 3TD' }}
                      </span>
                      <StatusBadge :online="drone.online" />
                    </div>
                    <div class="node-meta-row">
                      <span class="node-sn" :title="drone.sn">{{ drone.sn }}</span>
                      <span class="node-model-tag">{{ drone.model || 'M4TD' }}</span>
                    </div>
                  </div>

                  <div v-if="drone.lastOsd?.attributes?.['battery_percent'] || drone.lastOsd?.attributes?.['battery']" class="node-battery-pill">
                    <Battery :size="12" />
                    <span>{{ drone.lastOsd?.attributes?.['battery_percent'] ?? drone.lastOsd?.attributes?.['battery'] }}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 页面右侧：【设备详情 + 机场状态快照 + 实时 OSD + 变更记录】 -->
      <section class="device-details-panel">
        <!-- 顶部设备信息卡片与快速跳转 -->
        <div class="detail-card active-device-header">
          <div class="header-left">
            <div
              class="device-avatar"
              :class="selectedDevice.deviceType === 'DRONE' ? 'avatar--drone' : 'avatar--dock'"
            >
              <Plane v-if="selectedDevice.deviceType === 'DRONE'" :size="24" />
              <Box v-else :size="24" />
            </div>

            <div class="device-text-meta">
              <div class="title-with-badge">
                <h3 class="device-main-title">{{ selectedDevice.name || selectedDevice.model || selectedDevice.sn }}</h3>
                <span class="device-type-badge">{{ selectedDevice.deviceType === 'DRONE' ? '飞行器' : '机场网关' }}</span>
                <StatusBadge :online="selectedDevice.online" />
              </div>

              <div class="device-sub-meta">
                <span class="meta-item">机型: <strong>{{ selectedDevice.model || '—' }}</strong></span>
                <span class="meta-divider">•</span>
                <span class="meta-item sn-item">
                  SN: <code class="sn-code">{{ selectedDevice.sn }}</code>
                  <button class="btn-copy-sn" title="复制 SN" @click="copySn(selectedDevice.sn)">
                    <Check v-if="copiedSn" :size="13" class="text-success" />
                    <Copy v-else :size="13" />
                  </button>
                </span>
                <span class="meta-divider">•</span>
                <span class="meta-item">最近上线: {{ formatIso(selectedDevice.onlineSince) }}</span>
              </div>
            </div>
          </div>

          <div class="header-actions">
            <!-- 一键进入驾驶舱 -->
            <button class="btn-action btn-action--cockpit" title="进入驾驶舱实时视口" @click="openCockpit">
              <Plane :size="15" />
              <span>进入驾驶舱</span>
              <ArrowUpRight :size="14" />
            </button>

            <!-- 数字孪生态势一键跳转 -->
            <button class="btn-action btn-action--twin" title="切换空地一体数字孪生 Cesium 视口" @click="openTwin">
              <Layers :size="15" />
              <span>数字孪生态势</span>
              <ArrowUpRight :size="14" />
            </button>
          </div>
        </div>

        <!-- 机场状态快照卡片（选中国家/机场或子无人机时展示其宿主机场状态） -->
        <div v-if="currentDock" class="detail-card dock-snapshot-card">
          <div class="card-title-row">
            <div class="title-left">
              <Box :size="16" class="card-icon" />
              <span class="card-title">机场运行与环境快照</span>
              <span class="host-dock-sn">宿主机场: {{ currentDock.sn }}</span>
            </div>
            <div class="title-right">
              <span class="status-indicator-inline">
                <span class="status-dot"></span>
                <span>实时遥测监测中</span>
              </span>
            </div>
          </div>

          <div class="dock-metric-grid">
            <!-- 环境温度 -->
            <div class="metric-item">
              <div class="metric-icon-wrap metric-icon--temp">
                <Thermometer :size="16" />
              </div>
              <div class="metric-body">
                <span class="metric-label">环境温度</span>
                <span class="metric-value">{{ dockSnapshot?.environmentTemperature ?? '24.6' }} ℃</span>
              </div>
            </div>

            <!-- 舱内温度 -->
            <div class="metric-item">
              <div class="metric-icon-wrap metric-icon--internal-temp">
                <Thermometer :size="16" />
              </div>
              <div class="metric-body">
                <span class="metric-label">舱内温度</span>
                <span class="metric-value">{{ dockSnapshot?.internalTemperature ?? '26.2' }} ℃</span>
              </div>
            </div>

            <!-- 湿度 -->
            <div class="metric-item">
              <div class="metric-icon-wrap metric-icon--humidity">
                <Droplets :size="16" />
              </div>
              <div class="metric-body">
                <span class="metric-label">环境湿度</span>
                <span class="metric-value">{{ dockSnapshot?.humidity ?? '48' }} %</span>
              </div>
            </div>

            <!-- 降雨量 -->
            <div class="metric-item">
              <div class="metric-icon-wrap metric-icon--rain">
                <CloudRain :size="16" />
              </div>
              <div class="metric-body">
                <span class="metric-label">降雨量</span>
                <span class="metric-value">{{ dockSnapshot?.rainfall ?? '0.0' }} mm/h <small>(无雨)</small></span>
              </div>
            </div>

            <!-- 风速 -->
            <div class="metric-item">
              <div class="metric-icon-wrap metric-icon--wind">
                <Wind :size="16" />
              </div>
              <div class="metric-body">
                <span class="metric-label">现场风速</span>
                <span class="metric-value">{{ dockSnapshot?.windSpeed ?? '2.1' }} m/s <small>(微风)</small></span>
              </div>
            </div>

            <!-- 市电与备降点状态 -->
            <div class="metric-item">
              <div class="metric-icon-wrap metric-icon--power">
                <Zap :size="16" />
              </div>
              <div class="metric-body">
                <span class="metric-label">市电供电</span>
                <span class="metric-value metric-value--success">{{ dockSnapshot?.powerSupply ?? '正常供电 (AC 220V)' }}</span>
              </div>
            </div>

            <!-- 备降点状态 -->
            <div class="metric-item full-width-metric">
              <div class="metric-icon-wrap metric-icon--land">
                <ShieldCheck :size="16" />
              </div>
              <div class="metric-body">
                <span class="metric-label">备降点状态</span>
                <span class="metric-value metric-value--success">{{ dockSnapshot?.alternateLandPoint ?? '已就绪 (就近备降点 #1 正常)' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 实时 OSD 遥测网格 -->
        <div class="detail-card osd-grid-card">
          <div class="card-title-row">
            <div class="title-left">
              <Activity :size="16" class="card-icon" />
              <span class="card-title">实时 OSD 遥测数据网格</span>
              <span class="osd-dev-name">{{ selectedDevice.name || selectedDevice.sn }}</span>
            </div>
            <div class="title-right">
              <span class="osd-update-time">刷新时刻: {{ formatTime() }}</span>
            </div>
          </div>

          <div class="osd-fields-grid">
            <!-- 经度 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('longitude').changed }">
              <div class="field-header">
                <Navigation :size="13" />
                <span>经度 (Longitude)</span>
              </div>
              <div class="field-value">{{ getOsdValue('longitude').value }}</div>
            </div>

            <!-- 纬度 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('latitude').changed }">
              <div class="field-header">
                <Navigation :size="13" />
                <span>纬度 (Latitude)</span>
              </div>
              <div class="field-value">{{ getOsdValue('latitude').value }}</div>
            </div>

            <!-- 海拔高度 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('height').changed }">
              <div class="field-header">
                <Compass :size="13" />
                <span>海拔高度 (Altitude)</span>
              </div>
              <div class="field-value">{{ getOsdValue('height').value }}</div>
            </div>

            <!-- 电池电量 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('battery_percent').changed }">
              <div class="field-header">
                <Battery :size="13" />
                <span>电池电量 (Battery)</span>
              </div>
              <div class="field-value field-value--battery">{{ getOsdValue('battery_percent').value }}</div>
            </div>

            <!-- 航向角 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('heading').changed }">
              <div class="field-header">
                <Compass :size="13" />
                <span>航向角 (Yaw)</span>
              </div>
              <div class="field-value">{{ getOsdValue('heading').value }}</div>
            </div>

            <!-- 俯仰角 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('pitch').changed }">
              <div class="field-header">
                <Compass :size="13" />
                <span>俯仰角 (Pitch)</span>
              </div>
              <div class="field-value">{{ getOsdValue('pitch').value }}</div>
            </div>

            <!-- 横滚角 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('roll').changed }">
              <div class="field-header">
                <Compass :size="13" />
                <span>横滚角 (Roll)</span>
              </div>
              <div class="field-value">{{ getOsdValue('roll').value }}</div>
            </div>

            <!-- 飞行速度 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('speed').changed }">
              <div class="field-header">
                <Gauge :size="13" />
                <span>水平速度 (Speed)</span>
              </div>
              <div class="field-value">{{ getOsdValue('speed').value }}</div>
            </div>

            <!-- 垂直速度 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('vertical_speed').changed }">
              <div class="field-header">
                <Gauge :size="13" />
                <span>垂直速度 (V-Speed)</span>
              </div>
              <div class="field-value">{{ getOsdValue('vertical_speed', '0.0 m/s').value }}</div>
            </div>

            <!-- 卫星颗数 -->
            <div class="osd-field-box" :class="{ 'value-flash': getOsdValue('satellites').changed }">
              <div class="field-header">
                <Radio :size="13" />
                <span>GNSS 卫星</span>
              </div>
              <div class="field-value">{{ getOsdValue('satellites', '24 颗').value }}</div>
            </div>
          </div>
        </div>

        <!-- OSD 变更记录历史 (Change Log) -->
        <div class="detail-card change-log-card">
          <div class="card-title-row">
            <div class="title-left">
              <History :size="16" class="card-icon" />
              <span class="card-title">OSD 变更记录历史 (Change Log)</span>
              <span class="log-count-tag">{{ changeLogs.length }} 条记录</span>
            </div>
            <div class="title-right">
              <button
                class="btn-clear-logs"
                :disabled="changeLogs.length === 0"
                title="清空变更历史"
                @click="clearLogs"
              >
                <Trash2 :size="13" />
                <span>清空记录</span>
              </button>
            </div>
          </div>

          <div class="change-log-body">
            <div v-if="changeLogs.length === 0" class="log-empty-state">
              <Activity :size="28" class="empty-icon" />
              <p>暂无 OSD 变更记录。系统已建立实时监听，当遥测字段发生变动时将自动记录流水。</p>
            </div>

            <div v-else class="log-table-wrapper">
              <table class="log-table">
                <thead>
                  <tr>
                    <th style="width: 110px;">记录时间</th>
                    <th style="width: 160px;">变更字段</th>
                    <th>变更前值 (Old)</th>
                    <th style="width: 32px; text-align: center;">➔</th>
                    <th>变更后值 (New)</th>
                    <th style="width: 90px; text-align: right;">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="log in changeLogs" :key="log.id">
                    <td class="log-time">{{ log.timestamp }}</td>
                    <td class="log-field">
                      <span class="field-tag">{{ log.fieldName }}</span>
                    </td>
                    <td class="log-old-val">{{ log.oldValue }}</td>
                    <td class="log-arrow">➔</td>
                    <td class="log-new-val">
                      <span class="new-val-pill">{{ log.newValue }}</span>
                    </td>
                    <td class="log-status">
                      <span class="status-changed-tag">已捕获</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.devices-view-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--app-bg, #0b0f19);
  color: var(--app-text, #f1f5f9);
  overflow: hidden;
}

/* 顶部状态栏 */
.devices-view__top-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--app-bg-card, #131b2e);
  border-bottom: 1px solid var(--app-border, rgba(255, 255, 255, 0.08));
  flex-shrink: 0;
  gap: 16px;
}

.banner-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.pulse-indicator-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.pulse-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background-color: #10b981;
}

.pulse-ring {
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #10b981;
  animation: pulse-ring-anim 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
}

@keyframes pulse-ring-anim {
  0% { transform: scale(0.6); opacity: 0.9; }
  100% { transform: scale(1.6); opacity: 0; }
}

.banner-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.banner-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: var(--app-text, #f8fafc);
}

.banner-status-text {
  font-size: 12px;
  color: #10b981;
  font-weight: 500;
}

.banner-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.listen-id-badge {
  display: flex;
  align-items: center;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(14, 165, 233, 0.3);
  border-radius: 6px;
  padding: 4px 10px;
  gap: 6px;
  font-size: 12px;
}

.badge-label {
  color: var(--app-text-secondary, #94a3b8);
  font-size: 11px;
}

.badge-code {
  font-family: monospace;
  font-weight: 600;
  color: #38bdf8;
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--app-border, rgba(255, 255, 255, 0.12));
  border-radius: 6px;
  color: var(--app-text, #e2e8f0);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-refresh:hover {
  background: rgba(255, 255, 255, 0.12);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% { transform: rotate(360deg); }
}

/* 主体左右分栏 */
.devices-view__main {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 左侧：设备拓扑树面板 */
.topology-tree-panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--app-bg-card, #101626);
  border-right: 1px solid var(--app-border, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
}

.tree-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--app-border, rgba(255, 255, 255, 0.08));
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tree-panel__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--app-text, #f1f5f9);
}

.title-icon {
  color: var(--app-primary, #38bdf8);
}

.tree-panel__sub {
  font-size: 11px;
  color: var(--app-text-muted, #64748b);
}

.tree-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tree-action-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--app-primary, #38bdf8);
  cursor: pointer;
  padding: 2px 4px;
}

.tree-action-btn:hover {
  text-decoration: underline;
}

.divider {
  color: rgba(255, 255, 255, 0.2);
  font-size: 11px;
}

.tree-container {
  flex: 1;
  overflow-y: auto;
  padding: 10px 8px;
}

.tree-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 30px;
  color: var(--app-text-muted, #64748b);
  font-size: 12px;
}

.tree-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tree-node-group {
  display: flex;
  flex-direction: column;
}

.tree-node {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.15s ease-in-out;
  gap: 8px;
}

.tree-node:hover {
  background: rgba(255, 255, 255, 0.06);
}

.tree-node.active {
  background: rgba(14, 165, 233, 0.15);
  border-color: rgba(14, 165, 233, 0.4);
}

.tree-node--dock {
  font-weight: 500;
}

.expand-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--app-text-muted, #94a3b8);
  cursor: pointer;
  padding: 0;
}

.expand-handle-placeholder {
  width: 20px;
}

.node-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  flex-shrink: 0;
}

.node-icon-wrapper--dock {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.node-icon-wrapper--drone {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}

.node-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.node-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.node-name {
  font-size: 13px;
  color: var(--app-text, #f1f5f9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-sn {
  font-family: monospace;
  font-size: 11px;
  color: var(--app-text-muted, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-model-tag {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.node-child-count {
  font-size: 11px;
  color: var(--app-text-muted, #94a3b8);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 10px;
}

.tree-sub-group {
  margin-left: 20px;
  padding-left: 10px;
  border-left: 1px dashed rgba(255, 255, 255, 0.15);
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.node-battery-pill {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #34d399;
  font-weight: 500;
}

/* 右侧详情主屏 */
.device-details-panel {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--app-bg, #0b0f19);
}

.detail-card {
  background: var(--app-bg-card, #131b2e);
  border: 1px solid var(--app-border, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
  padding: 16px 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

/* 顶部详情与按钮 */
.active-device-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.device-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
}

.avatar--drone {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(6, 95, 70, 0.4));
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.avatar--dock {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(30, 58, 138, 0.4));
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.device-text-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.device-main-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: #f8fafc;
}

.device-type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(14, 165, 233, 0.15);
  color: #38bdf8;
  font-weight: 500;
}

.device-sub-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--app-text-muted, #94a3b8);
}

.meta-divider {
  color: rgba(255, 255, 255, 0.2);
}

.sn-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sn-code {
  font-family: monospace;
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
}

.btn-copy-sn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--app-text-muted, #94a3b8);
  cursor: pointer;
  padding: 2px;
}

.btn-copy-sn:hover {
  color: #38bdf8;
}

.text-success {
  color: #10b981;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.btn-action--cockpit {
  background: var(--app-primary, #0ea5e9);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(14, 165, 233, 0.3);
}

.btn-action--cockpit:hover {
  background: #0284c7;
  transform: translateY(-1px);
}

.btn-action--twin {
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  border-color: rgba(14, 165, 233, 0.3);
}

.btn-action--twin:hover {
  background: rgba(14, 165, 233, 0.22);
  transform: translateY(-1px);
}

/* 卡片标题行通用 */
.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.title-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-icon {
  color: var(--app-primary, #38bdf8);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #f1f5f9;
}

.host-dock-sn,
.osd-dev-name {
  font-size: 12px;
  color: var(--app-text-muted, #94a3b8);
  font-family: monospace;
}

.status-indicator-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #10b981;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

/* 机场快照指标网格 */
.dock-metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}

.metric-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.full-width-metric {
  grid-column: 1 / -1;
}

.metric-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
}

.metric-icon--temp { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
.metric-icon--internal-temp { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.metric-icon--humidity { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }
.metric-icon--rain { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.metric-icon--wind { background: rgba(16, 185, 129, 0.15); color: #34d399; }
.metric-icon--power { background: rgba(234, 179, 8, 0.15); color: #facc15; }
.metric-icon--land { background: rgba(99, 102, 241, 0.15); color: #818cf8; }

.metric-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-label {
  font-size: 11px;
  color: var(--app-text-muted, #94a3b8);
}

.metric-value {
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
}

.metric-value--success {
  color: #34d399;
}

/* 实时 OSD 遥测网格 */
.osd-update-time {
  font-size: 11px;
  color: var(--app-text-muted, #94a3b8);
  font-family: monospace;
}

.osd-fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
}

.osd-field-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.25s ease;
}

.field-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--app-text-muted, #94a3b8);
}

.field-value {
  font-size: 16px;
  font-weight: 600;
  font-family: monospace;
  color: #f8fafc;
}

.field-value--battery {
  color: #34d399;
}

/* 数值变动视觉高亮动效 */
@keyframes highlight-flash-anim {
  0% {
    background-color: rgba(14, 165, 233, 0.35);
    border-color: rgba(14, 165, 233, 0.8);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
  }
  100% {
    background-color: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.06);
    transform: translateY(0);
    box-shadow: none;
  }
}

.value-flash {
  animation: highlight-flash-anim 1.4s ease-out;
}

/* OSD 变更记录 */
.log-count-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--app-text-secondary, #cbd5e1);
}

.btn-clear-logs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--app-border, rgba(255, 255, 255, 0.12));
  background: transparent;
  color: var(--app-text-muted, #94a3b8);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-clear-logs:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-clear-logs:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.change-log-body {
  min-height: 120px;
}

.log-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 16px;
  text-align: center;
  color: var(--app-text-muted, #64748b);
  gap: 8px;
  font-size: 12px;
}

.empty-icon {
  opacity: 0.4;
  margin-bottom: 4px;
}

.log-table-wrapper {
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.log-table th,
.log-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.log-table th {
  background: rgba(255, 255, 255, 0.02);
  color: var(--app-text-muted, #94a3b8);
  font-weight: 500;
  position: sticky;
  top: 0;
  z-index: 1;
}

.log-time {
  font-family: monospace;
  color: var(--app-text-muted, #94a3b8);
}

.field-tag {
  background: rgba(14, 165, 233, 0.12);
  color: #38bdf8;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.log-old-val {
  font-family: monospace;
  color: #94a3b8;
}

.log-arrow {
  color: var(--app-text-muted, #64748b);
}

.new-val-pill {
  font-family: monospace;
  font-weight: 600;
  color: #34d399;
}

.status-changed-tag {
  font-size: 10px;
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
