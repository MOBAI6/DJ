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
import DevicesView from './DevicesView.vue'
import type { DeviceState } from '@/types/api'

const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockFetchDevices = vi.fn()
const mockFetchListenIds = vi.fn()
const mockFetchDockSnapshot = vi.fn()

vi.mock('@/api/devices', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/devices')
  return {
    ...actual,
    fetchDevices: () => mockFetchDevices(),
    fetchListenIds: () => mockFetchListenIds(),
    fetchDockSnapshot: (sn: string) => mockFetchDockSnapshot(sn),
  }
})

describe('DevicesView.vue (Session 03)', () => {
  const testDevices: DeviceState[] = [
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
        },
      },
      lastOsdAt: new Date().toISOString(),
      recentHms: [],
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
              battery_percent: 88,
              heading: 142.5,
              pitch: -12.3,
              roll: 1.8,
              speed: 4.2,
              satellites: 24,
            },
          },
          recentHms: [],
        },
      ],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchDevices.mockResolvedValue(testDevices)
    mockFetchListenIds.mockResolvedValue({
      workspaceListenId: 0,
      topoListenId: 1,
      statusText: 'SDK 双通道事件监听已激活',
    })
    mockFetchDockSnapshot.mockResolvedValue({
      sn: 'PFOTS6SUPQQWM6',
      environmentTemperature: 24.6,
      internalTemperature: 26.2,
      humidity: 48,
      rainfall: 0.0,
      windSpeed: 2.1,
      powerSupply: '正常供电 (AC 220V)',
      alternateLandPoint: '已就绪 (就近备降点 #1 正常)',
    })
  })

  it('测试服务器返回空列表时平滑呈现示范拓扑与示范设备', async () => {
    mockFetchDevices.mockResolvedValue([])
    const wrapper = mount(DevicesView)
    await flushPromises()

    // 示范拓扑节点依然正常渲染
    expect(wrapper.text()).toContain('设备拓扑树')
    expect(wrapper.text()).toContain('PFOTS6SUPQQWM6')
    expect(wrapper.text()).toContain('DJI Dock 2')
    expect(wrapper.text()).toContain('PF0CSAAT79T5ZCBE50H3')
    expect(wrapper.text()).toContain('Matrice 3TD 巡检机')
  })

  it('顶部显著展示 SDK 双通道事件监听状态与两个 ListenId 徽标', async () => {
    const wrapper = mount(DevicesView)
    await flushPromises()

    expect(wrapper.text()).toContain('SDK 双通道事件监听已激活')
    expect(wrapper.text()).toContain('workspaceListenId: 0')
    expect(wrapper.text()).toContain('topoListenId: 1')
  })

  it('左侧拓扑树正确渲染机场及下挂子设备无人机', async () => {
    const wrapper = mount(DevicesView)
    await flushPromises()

    // 拓扑树标题与节点
    expect(wrapper.find('.topology-tree-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('设备拓扑树')
    expect(wrapper.text()).toContain('PFOTS6SUPQQWM6')
    expect(wrapper.text()).toContain('DJI Dock 2')
    expect(wrapper.text()).toContain('PF0CSAAT79T5ZCBE50H3')
    expect(wrapper.text()).toContain('M4TD')
  })

  it('支持展开/折叠树节点与切换选中设备', async () => {
    const wrapper = mount(DevicesView)
    await flushPromises()

    // 点击折叠按钮
    const collapseBtn = wrapper.find('.tree-action-btn:nth-child(3)')
    if (collapseBtn.exists()) {
      await collapseBtn.trigger('click')
    }

    // 点击选择机场节点
    const dockNode = wrapper.find('.tree-node--dock')
    expect(dockNode.exists()).toBe(true)
    await dockNode.trigger('click')
    await flushPromises()

    // 右侧详情切换为选中机场
    expect(wrapper.find('.active-device-header').text()).toContain('PFOTS6SUPQQWM6')
  })

  it('右侧正确展示机场状态快照卡片与指标', async () => {
    const wrapper = mount(DevicesView)
    await flushPromises()

    const snapshotCard = wrapper.find('.dock-snapshot-card')
    expect(snapshotCard.exists()).toBe(true)
    expect(snapshotCard.text()).toContain('机场运行与环境快照')
    expect(snapshotCard.text()).toContain('24.6 ℃')
    expect(snapshotCard.text()).toContain('48 %')
    expect(snapshotCard.text()).toContain('2.1 m/s')
    expect(snapshotCard.text()).toContain('正常供电')
  })

  it('右侧正确展示实时 OSD 遥测网格', async () => {
    const wrapper = mount(DevicesView)
    await flushPromises()

    const osdCard = wrapper.find('.osd-grid-card')
    expect(osdCard.exists()).toBe(true)
    expect(osdCard.text()).toContain('实时 OSD 遥测数据网格')
    expect(osdCard.text()).toContain('113.94318°')
    expect(osdCard.text()).toContain('22.57885°')
    expect(osdCard.text()).toContain('124.5 m')
    expect(osdCard.text()).toContain('88%')
    expect(osdCard.text()).toContain('142.5°')
  })

  it('提供清空 OSD 变更记录按钮', async () => {
    const wrapper = mount(DevicesView)
    await flushPromises()

    const changeLogCard = wrapper.find('.change-log-card')
    expect(changeLogCard.exists()).toBe(true)
    expect(changeLogCard.text()).toContain('OSD 变更记录历史')

    const clearBtn = wrapper.find('.btn-clear-logs')
    expect(clearBtn.exists()).toBe(true)
  })

  it('点击「进入驾驶舱」及「数字孪生态势」一键跳转', async () => {
    const wrapper = mount(DevicesView)
    await flushPromises()

    const cockpitBtn = wrapper.find('.btn-action--cockpit')
    expect(cockpitBtn.exists()).toBe(true)
    await cockpitBtn.trigger('click')
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/cockpit',
        query: expect.objectContaining({
          drone_sn: 'PF0CSAAT79T5ZCBE50H3',
        }),
      }),
    )

    const twinBtn = wrapper.find('.btn-action--twin')
    expect(twinBtn.exists()).toBe(true)
    await twinBtn.trigger('click')
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/cockpit',
        query: expect.objectContaining({
          mode: 'twin',
        }),
      }),
    )
  })
})
