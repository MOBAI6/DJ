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
import { ref } from 'vue'
import { Calendar, History } from 'lucide-vue-next'
import FlightTaskList from '@/components/flight-task/FlightTaskList.vue'
import FlightRecordList from '@/components/flight-record/FlightRecordList.vue'

type TaskTab = 'tasks' | 'records'
const activeTab = ref<TaskTab>('tasks')
</script>

<template>
  <div class="flight-task-view">
    <!-- 顶部导航 Tab 栏 -->
    <div class="task-tabs-header">
      <div class="tabs-nav" role="tablist">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'tasks' }"
          role="tab"
          :aria-selected="activeTab === 'tasks'"
          data-testid="tab-flight-tasks"
          @click="activeTab = 'tasks'"
        >
          <Calendar :size="15" />
          <span>航线任务</span>
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'records' }"
          role="tab"
          :aria-selected="activeTab === 'records'"
          data-testid="tab-flight-records"
          @click="activeTab = 'records'"
        >
          <History :size="15" />
          <span>飞行记录</span>
        </button>
      </div>
    </div>

    <!-- Tab 对应内容 -->
    <div class="task-tabs-content">
      <FlightTaskList v-if="activeTab === 'tasks'" />
      <FlightRecordList v-else-if="activeTab === 'records'" />
    </div>
  </div>
</template>

<style scoped>
.flight-task-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--app-bg);
  overflow: hidden;
}

.task-tabs-header {
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: var(--app-bg-surface);
  border-bottom: 1px solid var(--app-border);
  flex-shrink: 0;
}

.tabs-nav {
  display: flex;
  gap: 24px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  border: none;
  background: transparent;
  color: var(--app-text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
  transition: all var(--transition-base);
}

.tab-btn:hover {
  color: var(--app-text);
}

.tab-btn.active {
  color: var(--app-primary);
  font-weight: 600;
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--app-primary);
  border-radius: 2px 2px 0 0;
}

.task-tabs-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
