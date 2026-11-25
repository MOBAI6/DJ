// Copyright (c) 2026 SZ DJI Technology Co., Ltd.
// SPDX-License-Identifier: Apache-2.0

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type CockpitMode = 'standard' | 'twin'

export interface OpticalAxisHitInfo {
  lat: number
  lng: number
  height: number
  distance?: number
}

export const useFovStore = defineStore('fov', () => {
  // 模式状态：standard（官方标准驾驶舱） | twin（空地一体数字孪生 FOV 驾驶舱）
  const mode = ref<CockpitMode>('standard')
  const isTwinMode = computed(() => mode.value === 'twin')

  // 视锥体线框可见性
  const showFrustum = ref(true)

  // 贴地足迹轮廓开关
  const showFootprint = ref(true)

  // 视频贴地投影开关
  const enableVideoProjection = ref(false)

  // 光轴射线开关
  const showOpticalAxis = ref(true)

  // 相机本体系三轴开关
  const showCameraAxes = ref(false)

  // 光轴中心地面交点
  const opticalAxisHit = ref<OpticalAxisHitInfo | null>(null)

  // 透明度配置
  const frustumFillAlpha = ref(0.15)
  const frustumOutlineAlpha = ref(0.85)

  // 视锥体远平面距离（米）
  const frustumFar = ref(1500)

  // 视角跟随无人机开关
  const trackDrone = ref(false)

  function setMode(newMode: CockpitMode) {
    mode.value = newMode
  }

  function toggleMode() {
    mode.value = mode.value === 'standard' ? 'twin' : 'standard'
  }

  function setShowFrustum(val: boolean) {
    showFrustum.value = val
  }

  function setShowFootprint(val: boolean) {
    showFootprint.value = val
  }

  function setEnableVideoProjection(val: boolean) {
    enableVideoProjection.value = val
  }

  function setShowOpticalAxis(val: boolean) {
    showOpticalAxis.value = val
  }

  function setShowCameraAxes(val: boolean) {
    showCameraAxes.value = val
  }

  function setOpticalAxisHit(hit: OpticalAxisHitInfo | null) {
    opticalAxisHit.value = hit
  }

  function setFrustumFillAlpha(alpha: number) {
    frustumFillAlpha.value = Math.max(0, Math.min(1, alpha))
  }

  function setFrustumOutlineAlpha(alpha: number) {
    frustumOutlineAlpha.value = Math.max(0, Math.min(1, alpha))
  }

  function setFrustumFar(far: number) {
    frustumFar.value = Math.max(100, far)
  }

  function reset() {
    showFrustum.value = true
    showFootprint.value = true
    enableVideoProjection.value = false
    showOpticalAxis.value = true
    showCameraAxes.value = false
    opticalAxisHit.value = null
    frustumFillAlpha.value = 0.15
    frustumOutlineAlpha.value = 0.85
    frustumFar.value = 1500
    trackDrone.value = false
  }

  return {
    mode,
    isTwinMode,
    showFrustum,
    showFootprint,
    enableVideoProjection,
    showOpticalAxis,
    showCameraAxes,
    opticalAxisHit,
    frustumFillAlpha,
    frustumOutlineAlpha,
    frustumFar,
    trackDrone,
    setMode,
    toggleMode,
    setShowFrustum,
    setShowFootprint,
    setEnableVideoProjection,
    setShowOpticalAxis,
    setShowCameraAxes,
    setOpticalAxisHit,
    setFrustumFillAlpha,
    setFrustumOutlineAlpha,
    setFrustumFar,
    reset,
  }
})
