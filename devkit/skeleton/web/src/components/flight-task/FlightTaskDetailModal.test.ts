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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FlightTaskDetailModal from './FlightTaskDetailModal.vue'
import type { FlightTaskDetail } from '@/types/flightTask'

const { mockPush, mockFetchDetail, mockPause, mockResume } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockFetchDetail: vi.fn(),
  mockPause: vi.fn(),
  mockResume: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/api/flightTask', () => ({
  fetchFlightTaskDetail: (...args: unknown[]) => mockFetchDetail(...args),
  pauseFlightTask: (...args: unknown[]) => mockPause(...args),
  resumeFlightTask: (...args: unknown[]) => mockResume(...args),
}))

function buildDetail(overrides: Partial<FlightTaskDetail> = {}): FlightTaskDetail {
  return {
    taskUuid: 'task-uuid-1234',
    name: '常规巡检任务',
    sn: 'DOCK-SN-999',
    deviceName: '1号机场',
    status: 'EXECUTING',
    taskType: 1,
    waylineUuid: 'wayline-uuid-5678',
    waylineName: '主变电站巡检航线',
    beginAt: 1721030400,
    endAt: 1721034000,
    rthAltitude: 120,
    rthMode: 1,
    outOfControlActionInFlight: 1,
    waylinePrecisionType: 1,
    minBatteryCapacity: 30,
    isBreakPointResume: true,
    ...overrides,
  }
}

describe('FlightTaskDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders_shouldNotRender_whenVisibleIsFalse', () => {
    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: false, taskUuid: 'task-uuid-1234' },
    })

    expect(wrapper.find('.detail-modal-overlay').exists()).toBe(false)
  })

  it('renders_shouldFetchAndDisplayDetails_whenVisibleIsTrue', async () => {
    const detailData = buildDetail()
    mockFetchDetail.mockResolvedValue(detailData)

    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: true, taskUuid: 'task-uuid-1234' },
    })
    await flushPromises()

    expect(mockFetchDetail).toHaveBeenCalledWith('task-uuid-1234')
    expect(wrapper.text()).toContain('常规巡检任务')
    expect(wrapper.text()).toContain('task-uuid-1234')
    expect(wrapper.text()).toContain('DOCK-SN-999')
    expect(wrapper.text()).toContain('1号机场')
    expect(wrapper.text()).toContain('wayline-uuid-5678')
    expect(wrapper.text()).toContain('主变电站巡检航线')
    expect(wrapper.text()).toContain('120 m')
    expect(wrapper.text()).toContain('返航') // outOfControlActionInFlight: 1
    expect(wrapper.text()).toContain('30%')
    expect(wrapper.text()).toContain('是') // isBreakPointResume: true
  })

  it('renders_shouldDisplayAlternativeActions_forOutOfControlAndBreakPoint', async () => {
    const detailData = buildDetail({
      outOfControlActionInFlight: 0,
      isBreakPointResume: false,
      minBatteryCapacity: 0,
    })
    mockFetchDetail.mockResolvedValue(detailData)

    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: true, taskUuid: 'task-uuid-1234' },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('继续执行') // outOfControlActionInFlight: 0
    expect(wrapper.text()).toContain('否') // isBreakPointResume: false
    expect(wrapper.text()).toContain('未设置') // minBatteryCapacity: 0
  })

  it('actions_shouldShowPauseButton_andHandlePause_whenExecuting', async () => {
    const detailData = buildDetail({ status: 'EXECUTING' })
    mockFetchDetail.mockResolvedValue(detailData)
    mockPause.mockResolvedValue(undefined)

    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: true, taskUuid: 'task-uuid-1234' },
    })
    await flushPromises()

    const pauseBtn = wrapper.find('.btn-pause')
    expect(pauseBtn.exists()).toBe(true)
    expect(pauseBtn.text()).toContain('暂停')

    await pauseBtn.trigger('click')
    expect(mockPause).toHaveBeenCalledWith('task-uuid-1234')
    expect(wrapper.emitted('pause')).toBeTruthy()
    expect(wrapper.emitted('pause')![0]).toEqual(['task-uuid-1234'])
  })

  it('actions_shouldShowResumeButton_andHandleResume_whenPaused', async () => {
    const detailData = buildDetail({ status: 'PAUSED' })
    mockFetchDetail.mockResolvedValue(detailData)
    mockResume.mockResolvedValue(undefined)

    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: true, taskUuid: 'task-uuid-1234' },
    })
    await flushPromises()

    const resumeBtn = wrapper.find('.btn-resume')
    expect(resumeBtn.exists()).toBe(true)
    expect(resumeBtn.text()).toContain('恢复')

    await resumeBtn.trigger('click')
    expect(mockResume).toHaveBeenCalledWith('task-uuid-1234')
    expect(wrapper.emitted('resume')).toBeTruthy()
    expect(wrapper.emitted('resume')![0]).toEqual(['task-uuid-1234'])
  })

  it('actions_shouldShowReplayButton_andNavigate_whenSuccessOrFailed', async () => {
    const detailData = buildDetail({ status: 'SUCCESS' })
    mockFetchDetail.mockResolvedValue(detailData)

    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: true, taskUuid: 'task-uuid-1234' },
    })
    await flushPromises()

    const replayBtn = wrapper.find('.btn-replay')
    expect(replayBtn.exists()).toBe(true)
    expect(replayBtn.text()).toContain('查看飞行记录')

    await replayBtn.trigger('click')
    expect(mockPush).toHaveBeenCalledWith({
      path: '/flight-replay',
      query: { task_id: 'task-uuid-1234', wayline_uuid: 'wayline-uuid-5678' },
    })
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false])
  })

  it('actions_shouldShowEditButton_andNavigate_whenCreated', async () => {
    const detailData = buildDetail({ status: 'CREATED' })
    mockFetchDetail.mockResolvedValue(detailData)

    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: true, taskUuid: 'task-uuid-1234' },
    })
    await flushPromises()

    const editBtn = wrapper.find('.btn-edit')
    expect(editBtn.exists()).toBe(true)
    expect(editBtn.text()).toContain('编辑')

    await editBtn.trigger('click')
    expect(mockPush).toHaveBeenCalledWith({
      path: '/flight-tasks/create',
      query: { taskUuid: 'task-uuid-1234' },
    })
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false])
  })

  it('close_shouldEmitUpdateVisible_whenCloseButtonClicked', async () => {
    const detailData = buildDetail()
    mockFetchDetail.mockResolvedValue(detailData)

    const wrapper = mount(FlightTaskDetailModal, {
      props: { visible: true, taskUuid: 'task-uuid-1234' },
    })
    await flushPromises()

    const closeBtn = wrapper.find('.btn-close')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('update:visible')?.[0]).toEqual([false])
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
