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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CockpitView from './CockpitView.vue'
import { useFovStore } from '@/stores/fov'
import type { FH2CockpitConfig } from '@/types/fh2'

let mockRouteQuery = {
  gateway_sn: 'PFOTS6SUPQQWM6',
  drone_sn: 'PF0CSAAT79T5ZCBE50H3',
  mode: '',
}

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: mockRouteQuery }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/composables/useFH2', () => ({
  ensureFH2Init: vi.fn().mockResolvedValue(undefined),
}))

describe('CockpitView.vue (Session 04)', () => {
  let loadCockpitMock: ReturnType<typeof vi.fn>
  let capturedCockpitConfig: FH2CockpitConfig | null = null

  beforeEach(() => {
    setActivePinia(createPinia())
    mockRouteQuery = {
      gateway_sn: 'PFOTS6SUPQQWM6',
      drone_sn: 'PF0CSAAT79T5ZCBE50H3',
      mode: '',
    }
    capturedCockpitConfig = null

    loadCockpitMock = vi.fn((domId: string, config: FH2CockpitConfig) => {
      capturedCockpitConfig = config
    })

    const win = window as Record<string, unknown>
    win.FH2 = {
      loadCockpit: loadCockpitMock,
      destroyCockpit: vi.fn(),
      subscribe: vi.fn((event: string, cb: () => void) => {
        if (event === 'cockpit:mounted') cb()
      }),
      unsubscribe: vi.fn(),
    }
  })

  afterEach(() => {
    delete (window as Record<string, unknown>).FH2
  })

  it('调用 window.FH2.loadCockpit 时正确注入双自定义按钮与配置 (Session 04)', async () => {
    const wrapper = mount(CockpitView, {
      global: {
        stubs: {
          SDKLoadingMask: true,
          DeviceSelector: true,
          CesiumTwinViewport: true,
        },
      },
    })
    await flushPromises()

    expect(loadCockpitMock).toHaveBeenCalledTimes(1)
    expect(capturedCockpitConfig).not.toBeNull()

    // 验证 TopBar customButtons
    const topBarBtns = capturedCockpitConfig?.cockpitConfig?.modules?.topBar?.features?.customButtons
    expect(topBarBtns).toBeDefined()
    expect(topBarBtns).toHaveLength(1)
    expect(topBarBtns![0].id).toBe('isv-topbar-inspect')
    expect(topBarBtns![0].name).toBe('巡检简报')

    // 验证 mainLive footerItems customButtons
    const toolBtns = capturedCockpitConfig?.cockpitConfig?.modules?.mainLive?.features?.footerItems?.customButtons
    expect(toolBtns).toBeDefined()
    expect(toolBtns).toHaveLength(1)
    expect(toolBtns![0].id).toBe('isv-toolbar-ai')
    expect(toolBtns![0].name).toBe('AI 标定')
  })

  it('点击「巡检简报」或触发回调弹出架次巡检简报与航巡进度弹窗', async () => {
    const wrapper = mount(CockpitView, {
      global: {
        stubs: {
          SDKLoadingMask: true,
          DeviceSelector: true,
          CesiumTwinViewport: true,
        },
      },
    })
    await flushPromises()

    // 触发 SDK 注入的 customButton cb
    const topBarBtn = capturedCockpitConfig?.cockpitConfig?.modules?.topBar?.features?.customButtons?.[0]
    expect(topBarBtn).toBeDefined()
    topBarBtn!.cb()
    await flushPromises()

    // 弹窗出现
    expect(wrapper.find('.cockpit-modal-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('架次巡检简报与航巡进度')
    expect(wrapper.text()).toContain('巡检任务信息')
    expect(wrapper.text()).toContain('18 / 24 点位已巡检 (75%)')
    expect(wrapper.text()).toContain('电池健康度评估 (SOH)')
    expect(wrapper.text()).toContain('00:18:42 / 4.8 km')

    // 点击关闭按钮可无缝关闭
    const closeBtn = wrapper.find('.modal-close-btn')
    await closeBtn.trigger('click')
    await flushPromises()

    expect(wrapper.find('.cockpit-modal-card').exists()).toBe(false)
  })

  it('点击「AI 标定」或触发回调弹出地面目标实时 AI 标定控制台弹窗', async () => {
    const wrapper = mount(CockpitView, {
      global: {
        stubs: {
          SDKLoadingMask: true,
          DeviceSelector: true,
          CesiumTwinViewport: true,
        },
      },
    })
    await flushPromises()

    // 触发 SDK 注入的 customButton cb
    const aiBtn = capturedCockpitConfig?.cockpitConfig?.modules?.mainLive?.features?.footerItems?.customButtons?.[0]
    expect(aiBtn).toBeDefined()
    aiBtn!.cb()
    await flushPromises()

    // 弹窗出现
    expect(wrapper.find('.cockpit-modal-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('地面目标实时 AI 标定控制台')
    expect(wrapper.text()).toContain('3 个活动目标')
    expect(wrapper.text()).toContain('作业工程车辆 (Vehicle)')
    expect(wrapper.text()).toContain('红外测温')
    expect(wrapper.text()).toContain('142.8 m')
    expect(wrapper.text()).toContain('22.57831°N, 113.94230°E')

    // 按 Esc 键也可关闭弹窗
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.find('.cockpit-modal-card').exists()).toBe(false)
  })

  it('从态势跳转带 mode=twin 时自动激活 Cesium 视口', async () => {
    mockRouteQuery.mode = 'twin'
    const wrapper = mount(CockpitView, {
      global: {
        stubs: {
          SDKLoadingMask: true,
          DeviceSelector: true,
          CesiumTwinViewport: true,
        },
      },
    })
    await flushPromises()

    const fovStore = useFovStore()
    expect(fovStore.mode).toBe('twin')
  })
})
