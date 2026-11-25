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
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ensureFH2Init } from '@/composables/useFH2'
import { useSDKLoader } from '@/composables/useSDKLoader'
import { useFovStore } from '@/stores/fov'
import SDKLoadingMask from '@/components/SDKLoadingMask.vue'
import DeviceSelector from '@/components/DeviceSelector.vue'
import type { DeviceWindowInstance } from '@/types/fh2'
import { ClipboardCheck, FileText, Crosshair, X, ShieldCheck } from 'lucide-vue-next'

const CesiumTwinViewport = defineAsyncComponent(
  () => import('@/components/cockpit/CesiumTwinViewport.vue'),
)

const route = useRoute()
const router = useRouter()
const { status, errorMsg, markReady, markError } = useSDKLoader()
const fovStore = useFovStore()

/** 自定义业务弹窗状态：'inspection' (巡检简报) | 'ai' (AI 标定) | null (未打开) */
const activeModal = ref<'inspection' | 'ai' | null>(null)

function openModal(type: 'inspection' | 'ai'): void {
  activeModal.value = type
}

function closeModal(): void {
  activeModal.value = null
}

/** 响应式路由参数：同路由导航（/cockpit?drone_sn=AAA → BBB）也会触发更新 */
const gatewaySn = computed(() => String(route.query.gateway_sn ?? ''))
const droneSn   = computed(() => String(route.query.drone_sn ?? ''))

/** 是否已选择设备（至少有 gateway_sn） */
const hasDeviceSelected = computed(() => Boolean(gatewaySn.value))

/** 超时计时器 ID，组件卸载时需清理 */
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

function handleDeviceSelect(gateway: string, drone: string): void {
  void router.push({
    path: '/cockpit',
    query: { gateway_sn: gateway, drone_sn: drone },
  })
}

function handleBackToSelector(): void {
  clearFallbackTimer()
  destroyCockpit()
  void router.push({ path: '/cockpit' })
}

function destroyCockpit(): void {
  try {
    window.FH2?.unsubscribe('cockpit:mounted')
    window.FH2?.unsubscribe('cockpit:drone-take-off')
    window.FH2?.destroyCockpit()
  } catch {
    // 忽略卸载阶段异常
  }
}

async function launchCockpit(): Promise<void> {
  if (!hasDeviceSelected.value) {
    return
  }

  status.value = 'loading'
  errorMsg.value = ''

  try {
    await ensureFH2Init()

    window.FH2.loadCockpit('cockpit-app-container', {
      gateway_sn: gatewaySn.value,
      drone_sn:   droneSn.value,
      cockpitConfig: {
        modules: {
          topBar: {
            features: {
              customButtons: [
                {
                  id: 'isv-topbar-inspect',
                  name: '巡检简报',
                  tips: '查看当前架次巡检简报',
                  cb: () => {
                    openModal('inspection')
                  },
                },
              ],
            },
          },
          mainLive: {
            features: {
              footerItems: {
                customButtons: [
                  {
                    id: 'isv-toolbar-ai',
                    name: 'AI 标定',
                    tips: '打开地面目标 AI 标定控制台',
                    cb: () => {
                      openModal('ai')
                    },
                  },
                ],
              },
            },
          },
        },
      },
    })

    window.FH2.subscribe('cockpit:mounted', () => {
      clearFallbackTimer()
      markReady()
    })

    window.FH2.subscribe('cockpit:drone-take-off', (...args: unknown[]) => {
      console.error('[Cockpit] drone-take-off', ...args)
    })

    fallbackTimer = setTimeout(() => {
      if (status.value === 'loading') { markReady() }
    }, 10000)
  } catch (e: unknown) {
    clearFallbackTimer()
    markError(e)
  }
}

function clearFallbackTimer(): void {
  if (fallbackTimer !== null) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
}

/* ── 设备小窗弹窗 ── */
const showDeviceWindow = ref(false)
const dwGatewaySn = ref('')
const dwDroneSn = ref('')
const dwInstances = ref<DeviceWindowInstance[]>([])
const dwLoading = ref(false)
const dwError = ref('')

async function handleDeviceWindow(gatewaySn: string, droneSn: string): Promise<void> {
  dwGatewaySn.value = gatewaySn
  dwDroneSn.value = droneSn
  showDeviceWindow.value = true
  dwLoading.value = true
  dwError.value = ''

  try {
    await ensureFH2Init()

    // 340 组网拓扑下网关 SN 即飞行器 SN，去重避免传出 "SN,SN"
    const devices = droneSn && droneSn !== gatewaySn ? `${gatewaySn},${droneSn}` : gatewaySn
    const windows = await window.FH2.loadDeviceWindow('real-time-app-container', {
      devices,
      map: true,
    })

    dwInstances.value = windows
  } catch (e: unknown) {
    dwError.value = e instanceof Error ? e.message : String(e)
  } finally {
    dwLoading.value = false
  }
}

function closeDeviceWindow(): void {
  try {
    window.FH2?.destroyDeviceWindow()
  } catch {
    // 忽略卸载异常
  }
  dwInstances.value = []
  showDeviceWindow.value = false
  dwLoading.value = false
  dwError.value = ''
}

function onEscKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (activeModal.value) {
      closeModal()
      return
    }
    if (showDeviceWindow.value) {
      closeDeviceWindow()
    }
  }
}

onMounted(() => {
  if (route.query.mode === 'twin') {
    fovStore.setMode('twin')
  }
  if (hasDeviceSelected.value) {
    void launchCockpit()
  }
  window.addEventListener('keydown', onEscKey)
})

watch(() => route.query.mode, (mode) => {
  if (mode === 'twin') {
    fovStore.setMode('twin')
  } else if (mode === 'standard') {
    fovStore.setMode('standard')
  }
})

watch([gatewaySn, droneSn], ([newGw, newDrone], [oldGw, oldDrone]) => {
  if (!newGw) {
    clearFallbackTimer()
    destroyCockpit()
    return
  }
  if (newGw === oldGw && newDrone === oldDrone) {
    return
  }
  destroyCockpit()
  clearFallbackTimer()
  void launchCockpit()
})

onUnmounted(() => {
  clearFallbackTimer()
  destroyCockpit()
  if (showDeviceWindow.value) {
    closeDeviceWindow()
  }
  window.removeEventListener('keydown', onEscKey)
})
</script>

<template>
  <div class="cockpit-root">
    <!-- 模式 1：未选择设备 → 显示设备选择面板 -->
    <div v-if="!hasDeviceSelected" class="cockpit-selector-page">
    <!--
      SDK 容器布局与 DeviceWindowView 完全对齐：
      - flex:1 + position:relative（不用 absolute + z-index，避免创建隔离层叠上下文）
      - 覆盖层放在容器内部（与 DeviceWindowView 的 .dw-guide 同层级）
    -->
    <div class="dw-sdk-container">
      <div id="map-app-global" class="dw-map-layer" />
      <div id="project-app-container" style="display: none;" />
      <div id="real-time-app-container" class="dw-realtime-layer" />

      <!-- 设备选择器覆盖层：未打开小窗时遮住 SDK 容器 -->
      <div v-if="!showDeviceWindow" class="dw-selector-cover">
        <DeviceSelector
          @select="handleDeviceSelect"
          @device-window="handleDeviceWindow"
        />
      </div>

      <!-- 设备小窗打开时：标题栏 + 状态层（SDK 容器在底层渲染） -->
      <div v-if="showDeviceWindow" class="dw-overlay-header">
        <span class="dw-overlay-title">设备小窗</span>
        <button class="dw-overlay-close" title="关闭" @click="closeDeviceWindow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div v-if="dwLoading" class="dw-overlay-state">
        <span class="dw-loading-dot" />
        加载中…
      </div>

      <div v-if="!dwLoading && dwError" class="dw-overlay-state dw-overlay-state--error">
        {{ dwError }}
      </div>
    </div>
  </div>

  <!-- 模式 2：已选择设备 → 加载驾驶舱 -->
  <div v-else class="cockpit-page">
    <SDKLoadingMask
      v-if="fovStore.mode === 'standard'"
      :status="status"
      :error-msg="errorMsg"
      loading-text="正在加载驾驶舱…"
    />

    <!-- 顶部控制条：返回按钮 + 模式切换控制器 -->
    <div class="cockpit-top-bar">
      <button class="btn-back" title="返回设备列表" @click="handleBackToSelector">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        切换设备
      </button>

      <!-- 驾驶舱模式切换控制器 -->
      <div class="cockpit-mode-segmented">
        <button
          class="mode-switch-btn"
          :class="{ active: fovStore.mode === 'standard' }"
          @click="fovStore.setMode('standard')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          官方标准驾驶舱
        </button>
        <button
          class="mode-switch-btn"
          :class="{ active: fovStore.mode === 'twin' }"
          @click="fovStore.setMode('twin')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          数字孪生 FOV 驾驶舱
        </button>
      </div>

      <!-- 自定义扩展按钮（巡检简报 / AI 标定） -->
      <div v-show="fovStore.mode === 'standard'" class="cockpit-custom-btn-group">
        <button
          class="custom-nav-btn"
          title="查看当前架次巡检简报"
          @click="openModal('inspection')"
        >
          <FileText :size="13" />
          <span>巡检简报</span>
        </button>
        <button
          class="custom-nav-btn custom-nav-btn--ai"
          title="打开地面目标 AI 标定控制台"
          @click="openModal('ai')"
        >
          <Crosshair :size="13" />
          <span>AI 标定</span>
        </button>
      </div>
    </div>

    <!--
      FH2 SDK 官方 DOM 结构：必须预先存在于页面中，SDK 内部通过 getElementById 查找。
      不要修改 id 名称，顺序也需与参考项目保持一致。
    -->
    <div v-show="fovStore.mode === 'standard' && status !== 'error'" class="fh2-container">
      <div id="cockpit-header-container" />
      <div class="project-details router-cockpit">
        <div id="project-app-container" />
        <div id="project-middle-container" />
        <div id="project-right-micro-app" class="right-micro-app">
          <div class="maps-micro-app">
            <div class="cockpit-left-border-container" />
            <div id="project-map-app-placeholder" class="map-app-placeholder">
              <div class="cockpit-dock-live-container" />
              <div id="map-app-global" class="map-app-container" />
              <div class="cockpit-bottom-border-container" />
            </div>
          </div>
          <div class="project-right">
            <div id="cockpit-app-container" />
          </div>
        </div>
      </div>
    </div>

    <!-- 空地一体数字孪生 Cesium 视口 -->
    <CesiumTwinViewport
      v-if="fovStore.mode === 'twin'"
      :gateway-sn="gatewaySn"
      :drone-sn="droneSn"
    />

    <slot name="cockpit-overlay" />
    <div v-show="fovStore.mode === 'standard'" class="cockpit-footer-bar">
      <slot name="cockpit-footer" />
    </div>

    <!-- 模态框 1：架次巡检简报与航巡进度弹窗 (Session 04) -->
    <Transition name="modal-fade">
      <div v-if="activeModal === 'inspection'" class="cockpit-modal-backdrop" @click.self="closeModal">
        <div class="cockpit-modal-card">
          <div class="modal-card-header">
            <div class="modal-title-wrap">
              <ClipboardCheck :size="18" class="text-primary" />
              <h3 class="modal-title">架次巡检简报与航巡进度</h3>
            </div>
            <button class="modal-close-btn" title="关闭 (Esc)" @click="closeModal">
              <X :size="16" />
            </button>
          </div>

          <div class="modal-card-body">
            <!-- 任务概况 -->
            <div class="briefing-section">
              <div class="section-title">巡检任务信息</div>
              <div class="briefing-info-grid">
                <div class="info-block">
                  <span class="label">任务名称</span>
                  <span class="val font-semibold">特高压输电线路与光伏方阵巡视 #20261123-01</span>
                </div>
                <div class="info-block">
                  <span class="label">执行状态</span>
                  <span class="val text-success">执行中 · 自动巡航中</span>
                </div>
                <div class="info-block">
                  <span class="label">飞行器 / 机场</span>
                  <span class="val font-mono">{{ droneSn || 'PF0CSAAT79T5ZCBE50H3' }} / {{ gatewaySn || 'PFOTS6SUPQQWM6' }}</span>
                </div>
                <div class="info-block">
                  <span class="label">任务用时 / 里程</span>
                  <span class="val">00:18:42 / 4.8 km (均速 4.2 m/s)</span>
                </div>
              </div>
            </div>

            <!-- 航巡点位进度 -->
            <div class="briefing-section">
              <div class="section-title-between">
                <span class="section-title">巡检点完成率</span>
                <span class="progress-ratio">18 / 24 点位已巡检 (75%)</span>
              </div>
              <div class="progress-bar-track">
                <div class="progress-bar-fill" style="width: 75%;"></div>
              </div>
            </div>

            <!-- 电池健康度与系统评估 -->
            <div class="briefing-section">
              <div class="section-title">电池健康度评估 (SOH)</div>
              <div class="battery-health-grid">
                <div class="health-card">
                  <span class="card-num text-success">98%</span>
                  <span class="card-desc">健康度 SOH</span>
                </div>
                <div class="health-card">
                  <span class="card-num">42 次</span>
                  <span class="card-desc">充放电循环</span>
                </div>
                <div class="health-card">
                  <span class="card-num text-success">0.2 ℃</span>
                  <span class="card-desc">电芯温差 (优良)</span>
                </div>
                <div class="health-card">
                  <span class="card-num">1.2 C</span>
                  <span class="card-desc">当前放电倍率</span>
                </div>
              </div>
            </div>

            <!-- 异常与发现摘要 -->
            <div class="briefing-section">
              <div class="section-title">关键缺陷与异常发现</div>
              <div class="finding-alert-box">
                <ShieldCheck :size="16" class="text-success" />
                <span>当前架次未发现结构性缺陷，航线点位对齐正常，记录 1 处微弱热点已自动同步至红外台账。</span>
              </div>
            </div>
          </div>

          <div class="modal-card-footer">
            <button class="modal-btn modal-btn--secondary" @click="closeModal">关闭</button>
            <button class="modal-btn modal-btn--primary" @click="closeModal">确认并同步到台账</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 模态框 2：地面目标实时 AI 标定控制台弹窗 (Session 04) -->
    <Transition name="modal-fade">
      <div v-if="activeModal === 'ai'" class="cockpit-modal-backdrop" @click.self="closeModal">
        <div class="cockpit-modal-card cockpit-modal-card--wide">
          <div class="modal-card-header">
            <div class="modal-title-wrap">
              <Crosshair :size="18" class="text-primary" />
              <h3 class="modal-title">地面目标实时 AI 标定控制台</h3>
            </div>
            <button class="modal-close-btn" title="关闭 (Esc)" @click="closeModal">
              <X :size="16" />
            </button>
          </div>

          <div class="modal-card-body">
            <!-- 算法与标定状态 -->
            <div class="ai-metrics-bar">
              <div class="ai-metric-item">
                <span class="ai-metric-label">检测目标数量</span>
                <span class="ai-metric-val font-mono">3 个活动目标</span>
              </div>
              <div class="ai-metric-item">
                <span class="ai-metric-label">识别算法模型</span>
                <span class="ai-metric-val">YOLOv8-Aerial v2.4</span>
              </div>
              <div class="ai-metric-item">
                <span class="ai-metric-label">实时推理时延</span>
                <span class="ai-metric-val font-mono text-success">38 ms (26 FPS)</span>
              </div>
              <div class="ai-metric-item">
                <span class="ai-metric-label">测距传感器状态</span>
                <span class="ai-metric-val font-mono text-primary">激光测距仪 (已校准锁定)</span>
              </div>
            </div>

            <!-- 标定目标清单 -->
            <div class="ai-targets-list">
              <div class="target-item-card">
                <div class="target-header">
                  <div class="target-id-badge">#01</div>
                  <div class="target-type-name">作业工程车辆 (Vehicle)</div>
                  <div class="confidence-tag">置信度: 96.4%</div>
                </div>
                <div class="target-details-grid">
                  <div class="detail-cell">
                    <span class="clabel">红外测温:</span>
                    <span class="cval text-warning">38.5 ℃ (发动机正常)</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">激光测距:</span>
                    <span class="cval font-mono">142.8 m</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">目标经纬度:</span>
                    <span class="cval font-mono">22.57831°N, 113.94230°E</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">标定状态:</span>
                    <span class="cval text-success">已锁定标定</span>
                  </div>
                </div>
              </div>

              <div class="target-item-card">
                <div class="target-header">
                  <div class="target-id-badge">#02</div>
                  <div class="target-type-name">巡视作业人员 (Person)</div>
                  <div class="confidence-tag">置信度: 94.1%</div>
                </div>
                <div class="target-details-grid">
                  <div class="detail-cell">
                    <span class="clabel">红外测温:</span>
                    <span class="cval">36.6 ℃ (人体体温)</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">激光测距:</span>
                    <span class="cval font-mono">98.2 m</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">目标经纬度:</span>
                    <span class="cval font-mono">22.57815°N, 113.94210°E</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">安全装备:</span>
                    <span class="cval text-success">反光衣 / 安全帽已识别</span>
                  </div>
                </div>
              </div>

              <div class="target-item-card">
                <div class="target-header">
                  <div class="target-id-badge">#03</div>
                  <div class="target-type-name">绝缘子变压器套管 (Equipment)</div>
                  <div class="confidence-tag">置信度: 98.7%</div>
                </div>
                <div class="target-details-grid">
                  <div class="detail-cell">
                    <span class="clabel">红外测温:</span>
                    <span class="cval text-danger">44.2 ℃ (轻微异常温升)</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">激光测距:</span>
                    <span class="cval font-mono">67.5 m</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">目标经纬度:</span>
                    <span class="cval font-mono">22.57802°N, 113.94255°E</span>
                  </div>
                  <div class="detail-cell">
                    <span class="clabel">告警处置:</span>
                    <span class="cval text-warning">自动抓拍建档中</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-card-footer">
            <button class="modal-btn modal-btn--secondary" @click="closeModal">关闭</button>
            <button class="modal-btn modal-btn--primary" @click="closeModal">保存并下发标定标注</button>
          </div>
        </div>
      </div>
    </Transition>
    </div>
  </div>
</template>

<style scoped>
.cockpit-root {
  width: 100%;
  height: 100%;
}

/* ── 设备选择页 ── */
.cockpit-selector-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-bg);
}

/* ── 驾驶舱页 ── */
.cockpit-page {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ── 顶部控制栏与模式切换器 ── */
.cockpit-top-bar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
}

.cockpit-mode-segmented {
  display: flex;
  align-items: center;
  background: var(--app-bg-card, rgba(15, 23, 42, 0.85));
  backdrop-filter: blur(12px);
  padding: 3px;
  border: 1px solid var(--app-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.mode-switch-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-secondary, #94a3b8);
  background: transparent;
  border: none;
  border-radius: calc(var(--radius-md, 8px) - 2px);
  cursor: pointer;
  transition: all var(--transition-base, 0.2s ease);
}

.mode-switch-btn:hover {
  color: var(--app-text, #f1f5f9);
}

.mode-switch-btn.active {
  color: #fff;
  background: var(--app-primary, #0ea5e9);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(14, 165, 233, 0.4);
}

/* ── 返回按钮 ── */
.btn-back {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px 6px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--app-text-secondary);
  background: var(--app-bg-card);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-base);
  backdrop-filter: blur(8px);
}

.btn-back:hover {
  color: var(--app-text);
  background: var(--app-bg-card-hover);
  border-color: var(--app-border-strong);
}

/* ── FH2 容器 ── */
.fh2-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.fh2-container .project-details {
  position: relative;
  width: 100%;
  display: flex;
  flex: 1;
  overflow: hidden;
}

.fh2-container .right-micro-app {
  position: relative;
  display: flex;
  flex: 1;
}

.fh2-container .maps-micro-app {
  display: flex;
  flex: 1;
  height: 100%;
}

.fh2-container .map-app-placeholder {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.fh2-container .map-app-container {
  height: 100%;
  min-height: 0;
}

.fh2-container .project-right {
  display: flex;
  flex-direction: column;
  height: 100%;
}

#cockpit-app-container {
  height: 100%;
}

/* qiankun 微应用容器高度修复 */
.fh2-container :deep(#__qiankun_microapp_wrapper_for_cockpit_app__),
.fh2-container :deep(#__qiankun_microapp_wrapper_for_cockpit_app__ > div) {
  height: 100% !important;
}

.fh2-container :deep(#project-app-container > div),
.fh2-container :deep(.map-app-container > div) {
  width: 100%;
  height: 100%;
}

.cockpit-footer-bar { flex-shrink: 0; min-height: 0; }

/* ── 设备小窗 SDK 容器（与 DeviceWindowView 对齐：flex:1 + position:relative） ── */
.dw-sdk-container {
  flex: 1;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.dw-map-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.dw-map-layer :deep(> div) {
  width: 100%;
  height: 100%;
}

.dw-realtime-layer {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
}

.dw-realtime-layer :deep(#__qiankun_microapp_wrapper_for_real_time_app__),
.dw-realtime-layer :deep(#__qiankun_microapp_wrapper_for_real_time_app__ > div) {
  height: 100% !important;
  pointer-events: none;
}

.dw-realtime-layer :deep(#__qiankun_microapp_wrapper_for_real_time_app__ .real-time-wrapper) {
  pointer-events: auto;
}

/* 设备选择器覆盖层：遮住底层 SDK 容器 */
.dw-selector-cover {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: var(--app-bg);
}

/* 设备小窗标题栏 */
.dw-overlay-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--app-bg-card, #1a1a2e);
  border-bottom: 1px solid var(--app-border);
}

.dw-overlay-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text);
}

.dw-overlay-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: all var(--transition-base);
}

.dw-overlay-close:hover {
  color: var(--app-text);
  background: var(--app-bg-card-hover, rgba(255, 255, 255, 0.08));
}

/* 状态遮罩层 */
.dw-overlay-state {
  position: absolute;
  inset: 0;
  z-index: 55;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  text-align: center;
  color: var(--app-text-muted);
  font-size: 13px;
  background: var(--app-bg, #0d0d1a);
}

.dw-overlay-state--error {
  color: var(--app-danger, #f56c6c);
}

.dw-loading-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--app-primary);
  margin-right: 8px;
  animation: dw-pulse 1s ease-in-out infinite;
}

@keyframes dw-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* ── 驾驶舱顶栏自定义扩展按钮 ── */
.cockpit-custom-btn-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-nav-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #f1f5f9;
  background: var(--app-bg-card, rgba(15, 23, 42, 0.85));
  border: 1px solid var(--app-border, rgba(255, 255, 255, 0.15));
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  transition: all var(--transition-base, 0.2s ease);
}

.custom-nav-btn:hover {
  background: rgba(14, 165, 233, 0.18);
  border-color: rgba(14, 165, 233, 0.5);
  color: #38bdf8;
  transform: translateY(-1px);
}

.custom-nav-btn--ai {
  border-color: rgba(16, 185, 129, 0.3);
}

.custom-nav-btn--ai:hover {
  background: rgba(16, 185, 129, 0.18);
  border-color: rgba(16, 185, 129, 0.6);
  color: #34d399;
}

/* ── 驾驶舱业务弹窗通用 ── */
.cockpit-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  padding: 20px;
}

.cockpit-modal-card {
  width: 580px;
  max-width: 95vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: #111827;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  color: #f3f4f6;
  overflow: hidden;
}

.cockpit-modal-card--wide {
  width: 680px;
}

.modal-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.modal-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #f9fafb;
}

.text-primary { color: #38bdf8; }
.text-success { color: #34d399; }
.text-warning { color: #fbbf24; }
.text-danger { color: #f87171; }
.font-mono { font-family: monospace; }
.font-semibold { font-weight: 600; }

.modal-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  transition: all 0.2s;
}

.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.modal-card-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.modal-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.modal-btn {
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.modal-btn--secondary {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #e5e7eb;
}

.modal-btn--secondary:hover {
  background: rgba(255, 255, 255, 0.14);
}

.modal-btn--primary {
  background: #0ea5e9;
  border: 1px solid transparent;
  color: #ffffff;
}

.modal-btn--primary:hover {
  background: #0284c7;
}

/* 巡检简报区块 */
.briefing-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
}

.section-title-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.progress-ratio {
  font-size: 12px;
  font-weight: 600;
  color: #38bdf8;
  font-family: monospace;
}

.progress-bar-track {
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #0ea5e9, #10b981);
  transition: width 0.3s ease;
}

.briefing-info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  background: rgba(255, 255, 255, 0.02);
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.info-block {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.info-block .label {
  font-size: 11px;
  color: #94a3b8;
}

.info-block .val {
  font-size: 12px;
  color: #f3f4f6;
}

.battery-health-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.health-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  gap: 2px;
}

.health-card .card-num {
  font-size: 15px;
  font-weight: 600;
  font-family: monospace;
}

.health-card .card-desc {
  font-size: 10px;
  color: #94a3b8;
}

.finding-alert-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
  font-size: 12px;
  color: #d1fae5;
}

/* AI 标定区块 */
.ai-metrics-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.ai-metric-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-metric-label {
  font-size: 10px;
  color: #94a3b8;
}

.ai-metric-val {
  font-size: 12px;
  font-weight: 500;
  color: #f3f4f6;
}

.ai-targets-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.target-item-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  gap: 8px;
}

.target-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.target-id-badge {
  font-size: 10px;
  font-family: monospace;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(14, 165, 233, 0.2);
  color: #38bdf8;
}

.target-type-name {
  font-size: 13px;
  font-weight: 600;
  color: #f3f4f6;
}

.confidence-tag {
  font-size: 11px;
  color: #34d399;
  font-family: monospace;
  margin-left: auto;
}

.target-details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px 14px;
}

.detail-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.detail-cell .clabel {
  color: #94a3b8;
  font-size: 11px;
}

.detail-cell .cval {
  color: #e5e7eb;
}

/* 弹窗过渡动效 */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
