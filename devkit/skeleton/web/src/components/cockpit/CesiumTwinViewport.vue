<!--
  Copyright 2025-2026 DJI. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as Cesium from 'cesium'
import {
  SeiMapLayer,
  connectTelemetry,
  disconnectTelemetry,
  type TelemetryMessage,
  computeSeiCameraWgs84,
  isSeiCameraReady,
} from '@/cesium/fov'
import { useFovStore } from '@/stores/fov'
import { fetchDevice } from '@/api/devices'
import { applyBaseImagery } from '@/utils/cesiumImagery'
import {
  Sliders,
  Crosshair,
  Layers,
  Eye,
  Video,
  Compass,
  Navigation,
  RotateCcw,
  Plane,
  Activity,
} from 'lucide-vue-next'

const props = defineProps<{
  gatewaySn?: string
  droneSn?: string
}>()

const fovStore = useFovStore()

const cesiumContainer = ref<HTMLDivElement | null>(null)
let viewer: Cesium.Viewer | null = null
let seiLayer: SeiMapLayer | null = null
let droneEntity: Cesium.Entity | null = null
let dockEntity: Cesium.Entity | null = null
let targetMarkerEntity: Cesium.Entity | null = null

// 遥测与位姿状态 (默认基准深圳湾大疆总部或默认坐标，若有设备遥测则实时覆盖)
const droneState = ref({
  lat: 22.5765,
  lng: 113.9425,
  height: 120,
  heading: 45,
  pitch: 0,
  roll: 0,
  speed: 0,
})

const dockState = ref({
  lat: 22.5762,
  lng: 113.9420,
  height: 10,
})

const cameraAttitude = ref({
  yaw: 45,
  pitch: -35,
  roll: 0,
  fovH: 60,
  fovV: 45,
  focalLength: 4500,
})

const hasReceivedRealTelemetry = ref(false)
const showControlPanel = ref(true)
const showFreqPanel = ref(false)

// 模型常量
const AIRCRAFT_MODEL_URI = `${import.meta.env.BASE_URL}models/Cesium_Air.glb`
const AIRCRAFT_MODEL_HEADING_OFFSET = Cesium.Math.toRadians(90 + 180)

function aircraftOrientation(position: Cesium.Cartesian3, heading: number, pitch: number, roll: number) {
  return Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(heading) + AIRCRAFT_MODEL_HEADING_OFFSET,
      Cesium.Math.toRadians(pitch),
      Cesium.Math.toRadians(roll),
    ),
  )
}

function initCesium() {
  if (!cesiumContainer.value) return

  // 创建轻量高效的三维地球
  viewer = new Cesium.Viewer(cesiumContainer.value, {
    animation: false,
    baseLayer: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: false,
    useDefaultRenderLoop: true,
  })

  // 注入卫星底图
  applyBaseImagery(viewer).catch((err) => {
    console.warn('[CesiumTwinViewport] 底图加载失败，回退离线底图', err)
  })

  // 开启深度检测以支持贴地视场角求交
  viewer.scene.globe.depthTestAgainstTerrain = true

  // 初始化 FOV 空间几何图层
  seiLayer = new SeiMapLayer(viewer, {
    showFrustum: fovStore.showFrustum,
    showFootprint: fovStore.showFootprint,
    showOpticalAxis: fovStore.showOpticalAxis,
    showCameraAxes: fovStore.showCameraAxes,
    fillAlpha: fovStore.frustumFillAlpha,
    outlineAlpha: fovStore.frustumOutlineAlpha,
  })

  // 创建光轴地面交点落点指示实体
  targetMarkerEntity = viewer.entities.add({
    name: 'fov-target-hit',
    position: Cesium.Cartesian3.fromDegrees(droneState.value.lng, droneState.value.lat, 0),
    point: {
      pixelSize: 12,
      color: Cesium.Color.ORANGE,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: 'FOV 目标落点',
      font: '12px "SF Pro Text", -apple-system, sans-serif',
      fillColor: Cesium.Color.fromCssColorString('#f59e0b'),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('rgba(15, 23, 42, 0.8)'),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      pixelOffset: new Cesium.Cartesian2(0, -18),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })

  // 创建机场标记实体
  dockEntity = viewer.entities.add({
    name: 'dock-base',
    position: Cesium.Cartesian3.fromDegrees(dockState.value.lng, dockState.value.lat, dockState.value.height),
    point: {
      pixelSize: 14,
      color: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    },
    label: {
      text: props.gatewaySn ? `机场 [${props.gatewaySn.slice(-4)}]` : '无人机机场',
      font: '12px "SF Pro Text", sans-serif',
      fillColor: Cesium.Color.CYAN,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('rgba(15, 23, 42, 0.8)'),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      pixelOffset: new Cesium.Cartesian2(0, -18),
    },
  })

  // 创建飞机 3D 模型实体
  const initialDronePos = Cesium.Cartesian3.fromDegrees(
    droneState.value.lng,
    droneState.value.lat,
    droneState.value.height,
  )
  droneEntity = viewer.entities.add({
    name: 'drone-aircraft',
    position: initialDronePos,
    orientation: aircraftOrientation(
      initialDronePos,
      droneState.value.heading,
      droneState.value.pitch,
      droneState.value.roll,
    ),
    model: {
      uri: AIRCRAFT_MODEL_URI,
      minimumPixelSize: 56,
      scale: 1.8,
      silhouetteColor: Cesium.Color.CYAN.withAlpha(0.6),
      silhouetteSize: 1,
    },
  })

  // 视角默认飞行至无人机斜后方
  flyToDrone()

  // 启动动态渲染与同步循环
  startRenderLoop()
}

/** 镜头聚焦平滑飞行到无人机 */
function flyToDrone() {
  if (!viewer) return
  const targetLon = droneState.value.lng
  const targetLat = droneState.value.lat
  const targetHeight = droneState.value.height

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(targetLon, targetLat - 0.0035, targetHeight + 260),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-32),
      roll: 0,
    },
    duration: 1.5,
  })
}

/** 垂直俯视鸟瞰视角 */
function flyToTopDown() {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      droneState.value.lng,
      droneState.value.lat,
      droneState.value.height + 650,
    ),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-89),
      roll: 0,
    },
    duration: 1.2,
  })
}

/** 视角重置 */
function resetView() {
  flyToDrone()
}

// 模拟动画时钟与循环
let animFrameId: number | null = null
let simTime = 0

function updateFovGeometry() {
  if (!viewer || !seiLayer) return

  const lon = droneState.value.lng
  const lat = droneState.value.lat
  const height = droneState.value.height
  const heading = droneState.value.heading
  const pitch = droneState.value.pitch
  const roll = droneState.value.roll

  // 1. 更新无人机模型实体位置与姿态
  const dronePos = Cesium.Cartesian3.fromDegrees(lon, lat, height)
  if (droneEntity) {
    if (droneEntity.position instanceof Cesium.ConstantPositionProperty) {
      droneEntity.position.setValue(dronePos)
    } else {
      droneEntity.position = new Cesium.ConstantPositionProperty(dronePos)
    }
    droneEntity.orientation = new Cesium.ConstantProperty(
      aircraftOrientation(dronePos, heading, pitch, roll),
    )
  }

  // 2. 更新机场实体位置
  if (dockEntity) {
    const dockPos = Cesium.Cartesian3.fromDegrees(dockState.value.lng, dockState.value.lat, dockState.value.height)
    if (dockEntity.position instanceof Cesium.ConstantPositionProperty) {
      dockEntity.position.setValue(dockPos)
    }
  }

  // 3. 解算相机姿态与视锥体
  const camYaw = cameraAttitude.value.yaw
  const camPitch = cameraAttitude.value.pitch
  const camRoll = cameraAttitude.value.roll

  // 更新相机本体系三轴
  seiLayer.updateCameraAxes(lon, lat, height, camYaw, camPitch, camRoll)

  // 更新光轴射线
  seiLayer.updateSeiOpticalAxis(lon, lat, height, camYaw, camPitch, camRoll)

  // 传感器尺寸推算 FOV (μm)
  const sensorFovH = 6400
  const sensorFovV = 4800
  const focalUm = cameraAttitude.value.focalLength || 4500

  // 动态更新四棱锥视锥体与地表视场多边形
  seiLayer.updateFrustum(
    lon,
    lat,
    height,
    camYaw,
    camPitch,
    camRoll,
    sensorFovH,
    sensorFovV,
    focalUm,
    fovStore.frustumFar,
  )

  // 4. 计算光轴中心落点与地表交点
  const hit = seiLayer.opticalAxisHit(lon, lat, height, camYaw, camPitch, camRoll)
  if (hit) {
    const hitCartesian = Cesium.Cartesian3.fromDegrees(hit.lng, hit.lat, hit.height)
    if (targetMarkerEntity) {
      if (targetMarkerEntity.position instanceof Cesium.ConstantPositionProperty) {
        targetMarkerEntity.position.setValue(hitCartesian)
      } else {
        targetMarkerEntity.position = new Cesium.ConstantPositionProperty(hitCartesian)
      }
      targetMarkerEntity.show = fovStore.showOpticalAxis
    }

    // 计算斜距
    const slantDist = Cesium.Cartesian3.distance(dronePos, hitCartesian)

    fovStore.setOpticalAxisHit({
      lat: Number(hit.lat.toFixed(6)),
      lng: Number(hit.lng.toFixed(6)),
      height: Number(hit.height.toFixed(1)),
      distance: Number(slantDist.toFixed(1)),
    })
  } else {
    if (targetMarkerEntity) {
      targetMarkerEntity.show = false
    }
    fovStore.setOpticalAxisHit(null)
  }
}

function startRenderLoop() {
  function loop() {
    // 若未收到实时外部遥测，提供微动展示动态四棱锥
    if (!hasReceivedRealTelemetry.value) {
      simTime += 0.02
      // 航向轻微摇摆、云台俯仰动态调整
      cameraAttitude.value.yaw = 45 + Math.sin(simTime * 0.5) * 12
      cameraAttitude.value.pitch = -35 + Math.cos(simTime * 0.7) * 8
      droneState.value.heading = 45 + Math.sin(simTime * 0.5) * 6
      droneState.value.roll = Math.sin(simTime * 0.5) * 2
    }

    updateFovGeometry()
    animFrameId = requestAnimationFrame(loop)
  }
  loop()
}

// 遥测数据分发处理
function handleTelemetry(msg: TelemetryMessage) {
  if (msg.type === 'mqtt_osd') {
    const d = msg.data
    if (msg.field === 'location') {
      const lat = Number(d.latitude ?? d.lat)
      const lng = Number(d.longitude ?? d.lng)
      const h = Number(d.height ?? d.altitude)
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        droneState.value.lat = lat
        droneState.value.lng = lng
        if (Number.isFinite(h)) droneState.value.height = h
        hasReceivedRealTelemetry.value = true
      }
    } else if (msg.field === 'attitude') {
      droneState.value.heading = Number(d.attitudeHead ?? droneState.value.heading)
      droneState.value.pitch = Number(d.attitudePitch ?? droneState.value.pitch)
      droneState.value.roll = Number(d.attitudeRoll ?? droneState.value.roll)
      hasReceivedRealTelemetry.value = true
    } else if (msg.field === 'dockLocation') {
      const dLat = Number(d.latitude ?? d.lat)
      const dLng = Number(d.longitude ?? d.lng)
      if (Number.isFinite(dLat) && Number.isFinite(dLng) && (dLat !== 0 || dLng !== 0)) {
        dockState.value.lat = dLat
        dockState.value.lng = dLng
      }
    } else if (msg.field === 'gimbalAttitude') {
      const payloads = (d.payloads as Array<{ gimbalPitch?: number; gimbalYaw?: number; gimbalRoll?: number }>) ?? []
      if (payloads.length > 0 && payloads[0]) {
        cameraAttitude.value.pitch = Number(payloads[0].gimbalPitch ?? cameraAttitude.value.pitch)
        cameraAttitude.value.yaw = Number(payloads[0].gimbalYaw ?? cameraAttitude.value.yaw)
        cameraAttitude.value.roll = Number(payloads[0].gimbalRoll ?? cameraAttitude.value.roll)
        hasReceivedRealTelemetry.value = true
      }
    }
  } else if (msg.type === 'sei') {
    // 直播高频 SEI 元数据
    const s = msg.data as Record<string, number>
    if (isSeiCameraReady(s)) {
      cameraAttitude.value.yaw = Number(s.cameraYaw ?? cameraAttitude.value.yaw)
      cameraAttitude.value.pitch = Number(s.cameraPitch ?? cameraAttitude.value.pitch)
      cameraAttitude.value.roll = Number(s.cameraRoll ?? cameraAttitude.value.roll)

      // 若携带相机相对机场或飞机的毫米级偏移
      const wgs = computeSeiCameraWgs84(
        dockState.value.lat,
        dockState.value.lng,
        dockState.value.height,
        s.cameraPosX,
        s.cameraPosY,
        s.altitude,
        {
          lat: droneState.value.lat,
          lng: droneState.value.lng,
          height: droneState.value.height,
        },
      )
      if (wgs) {
        droneState.value.lat = wgs.lat
        droneState.value.lng = wgs.lng
        droneState.value.height = wgs.height
      }
      hasReceivedRealTelemetry.value = true
    }
  }
}

// 监听 Store 变化即时反映到 Cesium 图层
watch(() => fovStore.showFrustum, (v) => seiLayer?.setFrustumVisible(v))
watch(() => fovStore.showFootprint, (v) => seiLayer?.setFootprintVisible(v))
watch(() => fovStore.showOpticalAxis, (v) => seiLayer?.setOpticalAxisVisible(v))
watch(() => fovStore.showCameraAxes, (v) => seiLayer?.setCameraAxesVisible(v))
watch(() => fovStore.enableVideoProjection, (v) => seiLayer?.setVideoProjectionEnabled(v))
watch([() => fovStore.frustumFillAlpha, () => fovStore.frustumOutlineAlpha], ([fill, outline]) => {
  seiLayer?.setFrustumAlpha(fill, outline)
})

async function fetchInitialDevicePosition() {
  const targetSn = props.droneSn || props.gatewaySn
  if (!targetSn) return
  try {
    const dev = await fetchDevice(targetSn)
    if (dev?.lastOsd?.attributes) {
      const attrs = dev.lastOsd.attributes
      const lat = Number(attrs.latitude ?? attrs.lat)
      const lng = Number(attrs.longitude ?? attrs.lng)
      const h = Number(attrs.height ?? attrs.altitude)
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        droneState.value.lat = lat
        droneState.value.lng = lng
        if (Number.isFinite(h)) droneState.value.height = h
        hasReceivedRealTelemetry.value = true
        dockState.value.lat = lat - 0.0003
        dockState.value.lng = lng - 0.0005
        flyToDrone()
      }
    }
  } catch {
    // 允许离线或模拟演示回退
  }
}

onMounted(() => {
  initCesium()
  void fetchInitialDevicePosition()
  connectTelemetry(handleTelemetry).catch(() => {
    // 允许 WebSocket 离线时走自适应驱动
  })
})

onUnmounted(() => {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
  disconnectTelemetry(handleTelemetry)
  if (seiLayer) {
    seiLayer.destroy()
    seiLayer = null
  }
  if (viewer && !viewer.isDestroyed()) {
    viewer.destroy()
    viewer = null
  }
})
</script>

<template>
  <div class="twin-cockpit-wrapper">
    <!-- Cesium 3D 地球视口 -->
    <div ref="cesiumContainer" class="twin-cesium-viewport" />

    <!-- 顶部状态指示条 -->
    <div class="twin-hud-bar">
      <div class="twin-badge-group">
        <span class="status-indicator" :class="{ 'is-live': hasReceivedRealTelemetry }">
          <span class="pulse-dot" />
          {{ hasReceivedRealTelemetry ? '实时遥测同步中' : '模拟姿态演练中' }}
        </span>
        <span class="device-tag">
          <Plane class="icon-sm" />
          {{ droneSn || gatewaySn || 'DJI-DRONE-50H3' }}
        </span>
      </div>

      <div class="hud-quick-actions">
        <button class="hud-action-btn" title="聚焦无人机" @click="flyToDrone">
          <Navigation class="icon-sm" />
          追机视角
        </button>
        <button class="hud-action-btn" title="垂直俯视" @click="flyToTopDown">
          <Compass class="icon-sm" />
          俯视视角
        </button>
        <button class="hud-action-btn" title="重置视角" @click="resetView">
          <RotateCcw class="icon-sm" />
          重置
        </button>
        <button
          class="hud-action-btn"
          :class="{ active: showControlPanel }"
          title="切换控制台"
          @click="showControlPanel = !showControlPanel"
        >
          <Sliders class="icon-sm" />
          控制台
        </button>
      </div>
    </div>

    <!-- 右上角：FOV 视场角与数字孪生态势控制台 -->
    <transition name="slide-fade">
      <div v-if="showControlPanel" class="twin-control-panel">
        <div class="panel-header">
          <div class="header-title">
            <Layers class="icon-md text-primary" />
            <span>FOV 视场角态势控制</span>
          </div>
          <span class="panel-tag">3D Cesium</span>
        </div>

        <div class="panel-section">
          <div class="section-label">图层与空间几何开关</div>
          <div class="toggle-grid">
            <button
              class="toggle-card"
              :class="{ active: fovStore.showFrustum }"
              @click="fovStore.setShowFrustum(!fovStore.showFrustum)"
            >
              <Eye class="icon-sm" />
              <span>四棱锥视锥体</span>
            </button>

            <button
              class="toggle-card"
              :class="{ active: fovStore.showFootprint }"
              @click="fovStore.setShowFootprint(!fovStore.showFootprint)"
            >
              <Crosshair class="icon-sm" />
              <span>地面足迹四边形</span>
            </button>

            <button
              class="toggle-card"
              :class="{ active: fovStore.showOpticalAxis }"
              @click="fovStore.setShowOpticalAxis(!fovStore.showOpticalAxis)"
            >
              <Navigation class="icon-sm" />
              <span>中心光轴射线</span>
            </button>

            <button
              class="toggle-card"
              :class="{ active: fovStore.enableVideoProjection }"
              @click="fovStore.setEnableVideoProjection(!fovStore.enableVideoProjection)"
            >
              <Video class="icon-sm" />
              <span>视频贴地投影</span>
            </button>
          </div>
        </div>

        <div class="panel-section">
          <div class="slider-group">
            <div class="slider-header">
              <span>视锥填充透明度</span>
              <span class="slider-value">{{ Math.round(fovStore.frustumFillAlpha * 100) }}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="fovStore.frustumFillAlpha"
              class="twin-range-slider"
              @input="fovStore.setFrustumFillAlpha(Number(($event.target as HTMLInputElement).value))"
            />
          </div>

          <div class="slider-group">
            <div class="slider-header">
              <span>视锥延伸视距 (Far)</span>
              <span class="slider-value">{{ fovStore.frustumFar }} m</span>
            </div>
            <input
              type="range"
              min="500"
              max="3000"
              step="100"
              :value="fovStore.frustumFar"
              class="twin-range-slider"
              @input="fovStore.setFrustumFar(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>

        <!-- 飞机状态摘要 -->
        <div class="panel-section status-section">
          <div class="section-label">无人机空间位姿</div>
          <div class="stat-columns">
            <div class="stat-col">
              <span class="stat-label">海拔高度</span>
              <span class="stat-num">{{ droneState.height.toFixed(1) }} m</span>
            </div>
            <div class="stat-col">
              <span class="stat-label">航向角 Yaw</span>
              <span class="stat-num">{{ Math.round(droneState.heading) }}°</span>
            </div>
            <div class="stat-col">
              <span class="stat-label">云台俯仰</span>
              <span class="stat-num">{{ Math.round(cameraAttitude.pitch) }}°</span>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- 右下角：遥测通道频率对照折叠面板 -->
    <div class="twin-osd-freq-panel">
      <div class="freq-panel-header" @click="showFreqPanel = !showFreqPanel">
        <div class="header-title">
          <Activity class="icon-sm text-primary" />
          <span>遥测通道频率对照</span>
        </div>
        <button
          class="hud-action-btn freq-toggle-btn"
          :class="{ active: showFreqPanel }"
          title="切换遥测通道频率对照面板"
          @click.stop="showFreqPanel = !showFreqPanel"
        >
          {{ showFreqPanel ? '收起' : '展开' }}
        </button>
      </div>

      <div v-show="showFreqPanel" class="freq-panel-body">
        <table class="freq-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>MQTT OSD (0.5Hz)</th>
              <th>SEI (~30fps)</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="col-field">坐标</td>
              <td class="col-val">{{ droneState.lat.toFixed(4) }}, {{ droneState.lng.toFixed(4) }}</td>
              <td class="col-val">—</td>
              <td class="col-desc">MQTT 慢通道 2s/次</td>
            </tr>
            <tr>
              <td class="col-field">高度</td>
              <td class="col-val">{{ droneState.height.toFixed(1) }} m</td>
              <td class="col-val">—</td>
              <td class="col-desc">椭球高度 WGS84</td>
            </tr>
            <tr>
              <td class="col-field">偏航 Yaw</td>
              <td class="col-val">{{ droneState.heading.toFixed(1) }}°</td>
              <td class="col-val">{{ cameraAttitude.yaw.toFixed(1) }}°</td>
              <td class="col-desc">机体/相机</td>
            </tr>
            <tr>
              <td class="col-field">俯仰 Pitch</td>
              <td class="col-val">—</td>
              <td class="col-val">{{ cameraAttitude.pitch.toFixed(1) }}°</td>
              <td class="col-desc">相机云台</td>
            </tr>
            <tr>
              <td class="col-field">横滚 Roll</td>
              <td class="col-val">—</td>
              <td class="col-val">{{ cameraAttitude.roll.toFixed(1) }}°</td>
              <td class="col-desc">相机</td>
            </tr>
            <tr>
              <td class="col-field">FOV 水平</td>
              <td class="col-val">—</td>
              <td class="col-val">{{ cameraAttitude.fovH.toFixed(1) }}°</td>
              <td class="col-desc">SEI 传感器计算</td>
            </tr>
          </tbody>
        </table>
        <div class="freq-footer-note">
          MQTT OSD ≈ 0.5 Hz · SEI ≈ 30 fps（帧级同步）
        </div>
      </div>
    </div>

    <!-- 左下角：光轴瞄准与地表交点态势信息 -->
    <div v-if="fovStore.opticalAxisHit" class="twin-telemetry-hud">
      <div class="telemetry-header">
        <Crosshair class="icon-sm text-warning" />
        <span>中心光轴地表交点 (Ground Target Hit)</span>
      </div>
      <div class="telemetry-grid">
        <div class="telem-item">
          <span class="telem-label">目标经度</span>
          <span class="telem-val">{{ fovStore.opticalAxisHit.lng.toFixed(6) }}°</span>
        </div>
        <div class="telem-item">
          <span class="telem-label">目标纬度</span>
          <span class="telem-val">{{ fovStore.opticalAxisHit.lat.toFixed(6) }}°</span>
        </div>
        <div class="telem-item">
          <span class="telem-label">落点海拔</span>
          <span class="telem-val">{{ fovStore.opticalAxisHit.height.toFixed(1) }} m</span>
        </div>
        <div class="telem-item" v-if="fovStore.opticalAxisHit.distance">
          <span class="telem-label">视线斜距</span>
          <span class="telem-val highlight">{{ fovStore.opticalAxisHit.distance.toFixed(1) }} m</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.twin-cockpit-wrapper {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #0b0f19;
}

.twin-cesium-viewport {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}

/* 顶部 HUD */
.twin-hud-bar {
  position: absolute;
  top: 14px;
  right: 18px;
  z-index: 90;
  display: flex;
  align-items: center;
  gap: 12px;
}

.twin-badge-group {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(12px);
  padding: 6px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #94a3b8;
}

.status-indicator.is-live {
  color: #10b981;
}

.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: #f59e0b;
}

.status-indicator.is-live .pulse-dot {
  background-color: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: pulse-ring 1.8s infinite;
}

@keyframes pulse-ring {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}

.device-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-family: monospace;
  color: #38bdf8;
  border-left: 1px solid rgba(255, 255, 255, 0.15);
  padding-left: 8px;
}

.hud-quick-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hud-action-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: all 0.2s ease;
}

.hud-action-btn:hover {
  background: rgba(30, 41, 59, 0.9);
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

.hud-action-btn.active {
  background: rgba(14, 165, 233, 0.2);
  border-color: #0ea5e9;
  color: #38bdf8;
}

/* 控制台悬浮面板 */
.twin-control-panel {
  position: absolute;
  top: 64px;
  right: 18px;
  width: 320px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 16px;
  color: #f1f5f9;
  z-index: 85;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.panel-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
}

.panel-section {
  margin-bottom: 16px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.toggle-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.toggle-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  font-size: 12px;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.toggle-card:hover {
  background: rgba(51, 65, 85, 0.8);
  color: #f1f5f9;
}

.toggle-card.active {
  background: rgba(14, 165, 233, 0.15);
  border-color: rgba(56, 189, 248, 0.6);
  color: #38bdf8;
  font-weight: 500;
}

.slider-group {
  margin-top: 10px;
}

.slider-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #cbd5e1;
  margin-bottom: 4px;
}

.slider-value {
  font-family: monospace;
  color: #38bdf8;
  font-weight: 600;
}

.twin-range-slider {
  width: 100%;
  accent-color: #0ea5e9;
  cursor: pointer;
}

.status-section {
  background: rgba(30, 41, 59, 0.4);
  padding: 10px;
  border-radius: 8px;
  margin-bottom: 0;
}

.stat-columns {
  display: flex;
  justify-content: space-between;
}

.stat-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 10px;
  color: #94a3b8;
}

.stat-num {
  font-size: 13px;
  font-weight: 600;
  font-family: monospace;
  color: #f8fafc;
}

/* 左下角遥测 HUD */
.twin-telemetry-hud {
  position: absolute;
  bottom: 24px;
  left: 24px;
  z-index: 85;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 12px 16px;
  min-width: 280px;
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.35);
}

.telemetry-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #cbd5e1;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.telemetry-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 14px;
}

.telem-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.telem-label {
  font-size: 10px;
  color: #94a3b8;
}

.telem-val {
  font-size: 12px;
  font-weight: 600;
  font-family: monospace;
  color: #e2e8f0;
}

.telem-val.highlight {
  color: #f59e0b;
}

/* 图标与通用工具类 */
.icon-sm {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.icon-md {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.text-primary {
  color: #38bdf8;
}

.text-warning {
  color: #f59e0b;
}

/* 动效 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* 遥测通道频率对照折叠面板 */
.twin-osd-freq-panel {
  position: absolute;
  bottom: 24px;
  right: 18px;
  width: 320px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px 14px;
  color: #f1f5f9;
  z-index: 85;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
}

.freq-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}

.freq-panel-header .header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: #f1f5f9;
}

.freq-toggle-btn {
  padding: 3px 8px;
  font-size: 11px;
}

.freq-panel-body {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.freq-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.freq-table th {
  text-align: left;
  padding: 4px 4px;
  color: #94a3b8;
  font-weight: 600;
  font-size: 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
}

.freq-table td {
  padding: 4px 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

.freq-table tr:last-child td {
  border-bottom: none;
}

.freq-table .col-field {
  color: #cbd5e1;
  font-weight: 500;
  white-space: nowrap;
}

.freq-table .col-val {
  font-family: monospace;
  color: #e2e8f0;
  font-size: 11px;
}

.freq-table .col-desc {
  color: #94a3b8;
  font-size: 10px;
}

.freq-footer-note {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
  font-size: 10px;
  color: #64748b;
  text-align: center;
}
</style>
