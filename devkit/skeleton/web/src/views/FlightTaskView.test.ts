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

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FlightTaskView from './FlightTaskView.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('FlightTaskView 双 Tab 视图', () => {
  it('renders_shouldShowTwoTabs_withTasksDefaultActive', () => {
    const wrapper = mount(FlightTaskView, {
      global: {
        stubs: {
          FlightTaskList: { template: '<div class="flight-task-list-mock">TaskList</div>' },
          FlightRecordList: { template: '<div class="flight-record-list-mock">RecordList</div>' },
        },
      },
    })

    const tabs = wrapper.findAll('.tab-btn')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].text()).toContain('航线任务')
    expect(tabs[1].text()).toContain('飞行记录')

    // 默认展示航线任务 Tab
    expect(tabs[0].classes()).toContain('active')
    expect(tabs[1].classes()).not.toContain('active')
    expect(wrapper.find('.flight-task-list-mock').exists()).toBe(true)
    expect(wrapper.find('.flight-record-list-mock').exists()).toBe(false)
  })

  it('interaction_shouldSwitchToFlightRecordList_whenRecordTabClicked', async () => {
    const wrapper = mount(FlightTaskView, {
      global: {
        stubs: {
          FlightTaskList: { template: '<div class="flight-task-list-mock">TaskList</div>' },
          FlightRecordList: { template: '<div class="flight-record-list-mock">RecordList</div>' },
        },
      },
    })

    const tabs = wrapper.findAll('.tab-btn')
    await tabs[1].trigger('click')

    expect(tabs[1].classes()).toContain('active')
    expect(tabs[0].classes()).not.toContain('active')
    expect(wrapper.find('.flight-task-list-mock').exists()).toBe(false)
    expect(wrapper.find('.flight-record-list-mock').exists()).toBe(true)

    // 切回航线任务
    await tabs[0].trigger('click')
    expect(tabs[0].classes()).toContain('active')
    expect(wrapper.find('.flight-task-list-mock').exists()).toBe(true)
    expect(wrapper.find('.flight-record-list-mock').exists()).toBe(false)
  })
})
