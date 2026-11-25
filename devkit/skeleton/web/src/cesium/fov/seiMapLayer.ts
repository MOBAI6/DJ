// Copyright (c) 2026 SZ DJI Technology Co., Ltd.
// SPDX-License-Identifier: Apache-2.0

/**
 * SEI 相机三轴、光轴、视锥、测距连线、贴地四边形与视频投影 — Cesium Primitive 图层封装。
 */
import * as Cesium from 'cesium'
import {
  DynamicFrustum,
  DynamicGroundClosedPolyline,
  DynamicPolyline,
  type FrustumState,
} from './dynamicPrimitives'
import { GroundVideoFootprint } from './groundVideoFootprint'
import {
  DEFAULT_FAR_M,
  nedCameraFrustumOrientation,
  seiFovFromSensor,
} from './seiFrustum'
import {
  computeFrustumGroundFootprintFromState,
  type FrustumFootprintState,
} from './seiFrustumFootprint'
import { opticalAxisEllipsoidHit, opticalAxisSegment } from './seiRaycast'
import { nedAxisEndpoints } from './seiNed'

const CAMERA_AXIS_LENGTH = { x: 14, y: 10, z: 10 }

export interface MapLayerConfig {
  showFrustum?: boolean
  showFootprint?: boolean
  showOpticalAxis?: boolean
  showCameraAxes?: boolean
  fillAlpha?: number
  outlineAlpha?: number
}

export class SeiMapLayer {
  private readonly collection: Cesium.PrimitiveCollection
  private readonly axisX: DynamicPolyline
  private readonly axisY: DynamicPolyline
  private readonly axisZ: DynamicPolyline
  private readonly seiRay: DynamicPolyline
  private readonly fastLine: DynamicPolyline
  private readonly seiLine: DynamicPolyline
  private readonly frustum: DynamicFrustum
  private readonly footprintOutline: DynamicGroundClosedPolyline
  private readonly groundVideo: GroundVideoFootprint
  private liveVideo: HTMLVideoElement | null = null
  private lastFootprint: Cesium.Cartesian3[] | null = null
  private videoProjectionEnabled = false

  private showFrustum = true
  private showFootprint = true
  private showOpticalAxis = true
  private showCameraAxes = false
  private fillAlpha = 0.12
  private outlineAlpha = 0.85

  constructor(private readonly viewer: Cesium.Viewer, initialConfig?: MapLayerConfig) {
    this.collection = viewer.scene.primitives.add(new Cesium.PrimitiveCollection())
    this.axisX = new DynamicPolyline(this.collection, Cesium.Color.RED, 6)
    this.axisY = new DynamicPolyline(this.collection, Cesium.Color.LIME, 4)
    this.axisZ = new DynamicPolyline(this.collection, Cesium.Color.DODGERBLUE, 4)
    this.seiRay = new DynamicPolyline(this.collection, Cesium.Color.CYAN.withAlpha(0.75), 3)
    this.fastLine = new DynamicPolyline(this.collection, Cesium.Color.LIME.withAlpha(0.85), 3)
    this.seiLine = new DynamicPolyline(this.collection, Cesium.Color.ORANGE.withAlpha(0.85), 3)

    if (initialConfig?.fillAlpha !== undefined) this.fillAlpha = initialConfig.fillAlpha
    if (initialConfig?.outlineAlpha !== undefined) this.outlineAlpha = initialConfig.outlineAlpha
    if (initialConfig?.showFrustum !== undefined) this.showFrustum = initialConfig.showFrustum
    if (initialConfig?.showFootprint !== undefined) this.showFootprint = initialConfig.showFootprint
    if (initialConfig?.showOpticalAxis !== undefined) this.showOpticalAxis = initialConfig.showOpticalAxis
    if (initialConfig?.showCameraAxes !== undefined) this.showCameraAxes = initialConfig.showCameraAxes

    this.frustum = new DynamicFrustum(
      this.collection,
      Cesium.Color.CYAN.withAlpha(this.outlineAlpha),
      Cesium.Color.CYAN.withAlpha(this.fillAlpha),
    )
    this.footprintOutline = new DynamicGroundClosedPolyline(
      this.viewer,
      Cesium.Color.YELLOW.withAlpha(0.95),
      2,
    )
    this.groundVideo = new GroundVideoFootprint(this.collection, this.viewer)
  }

  setFrustumVisible(visible: boolean) {
    this.showFrustum = visible
    if (!visible) {
      this.frustum.hide()
    }
  }

  setFootprintVisible(visible: boolean) {
    this.showFootprint = visible
    if (!visible) {
      this.hideGroundFootprint()
    }
  }

  setOpticalAxisVisible(visible: boolean) {
    this.showOpticalAxis = visible
    if (!visible) {
      this.hideSeiOpticalAxis()
    }
  }

  setCameraAxesVisible(visible: boolean) {
    this.showCameraAxes = visible
    if (!visible) {
      this.hideCameraAxes()
    }
  }

  setFrustumAlpha(fillAlpha: number, outlineAlpha = 0.85) {
    this.fillAlpha = fillAlpha
    this.outlineAlpha = outlineAlpha
    this.frustum.setColors(
      Cesium.Color.CYAN.withAlpha(outlineAlpha),
      Cesium.Color.CYAN.withAlpha(fillAlpha),
    )
  }

  setVideoProjectionEnabled(enabled: boolean) {
    this.videoProjectionEnabled = enabled
    if (!enabled) {
      this.groundVideo.hide(this.viewer)
      return
    }
    if (this.lastFootprint && this.liveVideo) {
      this.groundVideo.update(this.viewer, this.lastFootprint, this.liveVideo)
    }
  }

  setLiveVideo(video: HTMLVideoElement | null) {
    this.liveVideo = video
    if (!video || !this.videoProjectionEnabled) {
      this.groundVideo.hide(this.viewer)
      return
    }
    this.groundVideo.bindVideo(video)
    if (this.lastFootprint) {
      this.groundVideo.update(this.viewer, this.lastFootprint, video)
    }
  }

  updateCameraAxes(
    lon: number,
    lat: number,
    height: number,
    yawDeg: number,
    pitchDeg: number,
    rollDeg: number,
  ) {
    if (!this.showCameraAxes) {
      this.hideCameraAxes()
      return
    }
    const { origin, endX, endY, endZ } = nedAxisEndpoints(
      lon, lat, height, yawDeg, pitchDeg, rollDeg, CAMERA_AXIS_LENGTH,
    )
    this.axisX.setEndpoints(origin, endX)
    this.axisY.setEndpoints(origin, endY)
    this.axisZ.setEndpoints(origin, endZ)
  }

  hideCameraAxes() {
    this.axisX.hide()
    this.axisY.hide()
    this.axisZ.hide()
  }

  updateSeiOpticalAxis(
    lon: number,
    lat: number,
    height: number,
    yawDeg: number,
    pitchDeg: number,
    rollDeg: number,
  ) {
    if (!this.showOpticalAxis) {
      this.hideSeiOpticalAxis()
      return
    }
    const { origin, end } = opticalAxisSegment(lon, lat, height, yawDeg, pitchDeg, rollDeg)
    this.seiRay.setEndpoints(origin, end)
  }

  hideSeiOpticalAxis() {
    this.seiRay.hide()
    this.seiLine.hide()
  }

  updateMeasureLine(
    id: 'fast' | 'sei',
    from: Cesium.Cartesian3,
    to: Cesium.Cartesian3,
  ) {
    const line = id === 'fast' ? this.fastLine : this.seiLine
    line.setEndpoints(from, to)
  }

  hideMeasureLine(id: 'fast' | 'sei') {
    if (id === 'fast') this.fastLine.hide()
    else this.seiLine.hide()
  }

  updateFrustum(
    lon: number,
    lat: number,
    height: number,
    yawDeg: number,
    pitchDeg: number,
    rollDeg: number,
    fovHorizontalUm?: number,
    fovVerticalUm?: number,
    focalLengthUm?: number,
    far = DEFAULT_FAR_M,
  ) {
    const origin = Cesium.Cartesian3.fromDegrees(lon, lat, height)
    const orientation = nedCameraFrustumOrientation(lon, lat, height, yawDeg, pitchDeg, rollDeg)
    const fov = seiFovFromSensor(fovHorizontalUm, fovVerticalUm, focalLengthUm)
    const state: FrustumState = { origin, orientation, fov, far }

    if (this.showFrustum) {
      this.frustum.update(state)
    } else {
      this.frustum.hide()
    }

    if (this.showFootprint) {
      this.updateFootprint(state)
    } else {
      this.hideGroundFootprint()
    }
  }

  private updateFootprint(state: FrustumFootprintState) {
    let footprint = computeFrustumGroundFootprintFromState(this.viewer, state)

    if (footprint) {
      this.lastFootprint = footprint.map((p) => Cesium.Cartesian3.clone(p))
    } else if (this.lastFootprint) {
      footprint = this.lastFootprint
    } else {
      this.footprintOutline.hide()
      this.hideGroundFootprint()
      return
    }

    this.footprintOutline.update(footprint)

    if (!this.videoProjectionEnabled) {
      this.groundVideo.hide(this.viewer)
      return
    }

    this.groundVideo.update(this.viewer, footprint, this.liveVideo)
  }

  hideFrustum() {
    this.frustum.hide()
    this.hideGroundFootprint()
  }

  hideGroundFootprint() {
    this.lastFootprint = null
    this.footprintOutline.hide()
    this.groundVideo.hide(this.viewer)
  }

  opticalAxisHit(
    lon: number,
    lat: number,
    height: number,
    yawDeg: number,
    pitchDeg: number,
    rollDeg: number,
  ) {
    return opticalAxisEllipsoidHit(lon, lat, height, yawDeg, pitchDeg, rollDeg)
  }

  hideAllSei() {
    this.hideCameraAxes()
    this.hideSeiOpticalAxis()
    this.hideFrustum()
  }

  reset() {
    this.hideAllSei()
    this.fastLine.hide()
  }

  destroy() {
    this.axisX.destroy()
    this.axisY.destroy()
    this.axisZ.destroy()
    this.seiRay.destroy()
    this.fastLine.destroy()
    this.seiLine.destroy()
    this.frustum.destroy()
    this.footprintOutline.destroy()
    this.groundVideo.destroy(this.viewer)
    if (!this.collection.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.collection)
    }
  }
}
