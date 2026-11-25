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
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { X, RefreshCw, Play, Pause, Pencil, FileText } from 'lucide-vue-next'
import type { FlightTaskDetail, FlightTaskInfo } from '@/types/flightTask'
import {
  FLIGHT_TASK_STATUS_COLORS as STATUS_COLORS,
  FLIGHT_TASK_STATUS_LABELS as STATUS_LABELS,
} from '@/types/flightTask'
import { fetchFlightTaskDetail, pauseFlightTask, resumeFlightTask } from '@/api/flightTask'
import { formatDateTime } from '@/utils/format'
import TaskTypeLabel from './TaskTypeLabel.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    taskUuid?: string
    task?: FlightTaskDetail | FlightTaskInfo | null
  }>(),
  {
    visible: false,
    taskUuid: undefined,
    task: null,
  },
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  close: []
  pause: [taskUuid: string]
  resume: [taskUuid: string]
  replay: [task: { taskUuid: string; waylineUuid: string }]
  edit: [taskUuid: string]
  refresh: []
}>()

const router = useRouter()

const loading = ref(false)
const error = ref<string | null>(null)
const actionLoading = ref(false)
const detail = ref<FlightTaskDetail | null>(null)

function close(): void {
  emit('update:visible', false)
  emit('close')
}

function onKeydown(e: KeyboardEvent): void {
  if (props.visible && e.key === 'Escape') {
    close()
  }
}

async function loadDetail(): Promise<void> {
  const uuid = props.taskUuid || props.task?.taskUuid
  if (!uuid) {
    if (props.task) {
      detail.value = {
        beginAt: 0,
        endAt: 0,
        rthAltitude: 100,
        rthMode: 0,
        outOfControlActionInFlight: 1,
        waylinePrecisionType: 0,
        deviceName: null,
        waylineName: null,
        ...props.task,
      } as FlightTaskDetail
    }
    return
  }

  // 若传入了初始 task 对象，先赋初始值保证骨架有数据
  if (props.task && props.task.taskUuid === uuid) {
    detail.value = {
      beginAt: 0,
      endAt: 0,
      rthAltitude: 100,
      rthMode: 0,
      outOfControlActionInFlight: 1,
      waylinePrecisionType: 0,
      deviceName: null,
      waylineName: null,
      ...props.task,
    } as FlightTaskDetail
  }

  loading.value = true
  error.value = null
  try {
    const res = await fetchFlightTaskDetail(uuid)
    detail.value = res
  } catch (err) {
    error.value = err instanceof Error ? err.message : '获取任务详情失败'
  } finally {
    loading.value = false
  }
}

async function handlePause(): Promise<void> {
  const uuid = detail.value?.taskUuid || props.taskUuid || props.task?.taskUuid
  if (!uuid) return
  actionLoading.value = true
  try {
    await pauseFlightTask(uuid)
    emit('pause', uuid)
    emit('refresh')
    if (detail.value) {
      detail.value.status = 'PAUSED'
    }
    await loadDetail()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '暂停任务失败'
  } finally {
    actionLoading.value = false
  }
}

async function handleResume(): Promise<void> {
  const uuid = detail.value?.taskUuid || props.taskUuid || props.task?.taskUuid
  if (!uuid) return
  actionLoading.value = true
  try {
    await resumeFlightTask(uuid)
    emit('resume', uuid)
    emit('refresh')
    if (detail.value) {
      detail.value.status = 'EXECUTING'
    }
    await loadDetail()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '恢复任务失败'
  } finally {
    actionLoading.value = false
  }
}

function handleReplay(): void {
  const uuid = detail.value?.taskUuid || props.taskUuid || props.task?.taskUuid
  const waylineUuid = detail.value?.waylineUuid || (props.task as FlightTaskInfo)?.waylineUuid || ''
  if (!uuid) return
  close()
  emit('replay', { taskUuid: uuid, waylineUuid })
  if (router) {
    router.push({
      path: '/flight-replay',
      query: { task_id: uuid, wayline_uuid: waylineUuid },
    })
  }
}

function handleEdit(): void {
  const uuid = detail.value?.taskUuid || props.taskUuid || props.task?.taskUuid
  if (!uuid) return
  close()
  emit('edit', uuid)
  if (router) {
    router.push({
      path: '/flight-tasks/create',
      query: { taskUuid: uuid },
    })
  }
}

watch(
  () => props.visible,
  (val) => {
    if (val) {
      loadDetail()
    } else {
      error.value = null
    }
  },
  { immediate: true },
)

watch(
  () => props.taskUuid,
  (newUuid, oldUuid) => {
    if (props.visible && newUuid && newUuid !== oldUuid) {
      loadDetail()
    }
  },
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="visible" class="detail-modal-overlay" @click.self="close">
    <div class="detail-modal-panel">
      <!-- 头部 -->
      <div class="modal-header">
        <div class="modal-title-wrap">
          <FileText :size="18" class="header-icon" />
          <h3 class="modal-title">任务详情</h3>
        </div>
        <button class="modal-close" type="button" aria-label="关闭" @click="close">
          <X :size="18" />
        </button>
      </div>

      <!-- 内容区 -->
      <div class="modal-body">
        <!-- 错误提示 -->
        <div v-if="error" class="error-bar">
          <span>{{ error }}</span>
          <button class="retry-btn" type="button" @click="loadDetail">重试</button>
        </div>

        <!-- 加载中 -->
        <div v-if="loading && !detail" class="loading-state">
          <RefreshCw :size="24" class="spinning" />
          <span>正在加载任务详情…</span>
        </div>

        <!-- 详情网格 -->
        <div v-else-if="detail" class="detail-grid">
          <!-- 任务名称 -->
          <div class="detail-item full-width">
            <span class="detail-label">任务名称</span>
            <span class="detail-value task-name">{{ detail.name || '-' }}</span>
          </div>

          <!-- 任务 UUID -->
          <div class="detail-item full-width">
            <span class="detail-label">任务 UUID</span>
            <code class="detail-value uuid-code">{{ detail.taskUuid || '-' }}</code>
          </div>

          <!-- 任务状态 -->
          <div class="detail-item">
            <span class="detail-label">任务状态</span>
            <div class="detail-value">
              <span
                v-if="detail.status"
                class="status-badge"
                :style="{ '--badge-color': STATUS_COLORS[detail.status] }"
              >
                {{ STATUS_LABELS[detail.status] || detail.status }}
              </span>
              <span v-else>-</span>
            </div>
          </div>

          <!-- 任务类型 -->
          <div class="detail-item">
            <span class="detail-label">任务策略 / 类型</span>
            <div class="detail-value">
              <TaskTypeLabel
                :task-type="detail.taskType"
                :min-battery-capacity="detail.minBatteryCapacity"
              />
            </div>
          </div>

          <!-- 设备 SN -->
          <div class="detail-item">
            <span class="detail-label">设备 SN</span>
            <code class="detail-value sn-code">{{ detail.sn || '-' }}</code>
          </div>

          <!-- 设备名称 -->
          <div class="detail-item">
            <span class="detail-label">设备名称</span>
            <span class="detail-value">{{ detail.deviceName || '未命名设备' }}</span>
          </div>

          <!-- 航线 UUID -->
          <div class="detail-item">
            <span class="detail-label">航线 UUID</span>
            <code class="detail-value uuid-code">{{ detail.waylineUuid || '-' }}</code>
          </div>

          <!-- 航线名称 -->
          <div class="detail-item">
            <span class="detail-label">航线名称</span>
            <span class="detail-value">{{ detail.waylineName || '未命名航线' }}</span>
          </div>

          <!-- 创建时间 -->
          <div v-if="detail.createdAt" class="detail-item">
            <span class="detail-label">创建时间</span>
            <span class="detail-value">{{ formatDateTime(detail.createdAt) }}</span>
          </div>

          <!-- 开始时间 -->
          <div class="detail-item">
            <span class="detail-label">开始时间</span>
            <span class="detail-value">{{ detail.beginAt ? formatDateTime(detail.beginAt) : '-' }}</span>
          </div>

          <!-- 结束时间 -->
          <div class="detail-item">
            <span class="detail-label">结束时间</span>
            <span class="detail-value">{{ detail.endAt ? formatDateTime(detail.endAt) : '-' }}</span>
          </div>

          <!-- 返航高度 -->
          <div class="detail-item">
            <span class="detail-label">安全返航高度</span>
            <span class="detail-value">{{ detail.rthAltitude != null ? `${detail.rthAltitude} m` : '-' }}</span>
          </div>

          <!-- 失联动作 -->
          <div class="detail-item">
            <span class="detail-label">失联动作</span>
            <span class="detail-value">{{ detail.outOfControlActionInFlight === 1 ? '返航' : '继续执行' }}</span>
          </div>

          <!-- 最低电量 -->
          <div class="detail-item">
            <span class="detail-label">最低起飞电量</span>
            <span class="detail-value">{{ detail.minBatteryCapacity ? `${detail.minBatteryCapacity}%` : '未设置' }}</span>
          </div>

          <!-- 断点续飞 -->
          <div class="detail-item">
            <span class="detail-label">断点续飞</span>
            <span class="detail-value">{{ detail.isBreakPointResume ? '是' : '否' }}</span>
          </div>
        </div>

        <div v-else class="empty-state">
          暂无任务详情数据
        </div>
      </div>

      <!-- 底部操作栏 -->
      <div class="modal-footer">
        <button class="btn btn-close" type="button" @click="close">
          关闭
        </button>

        <!-- CREATED: 编辑 -->
        <button
          v-if="detail?.status === 'CREATED'"
          class="btn btn-edit"
          type="button"
          @click="handleEdit"
        >
          <Pencil :size="14" />
          <span>编辑</span>
        </button>

        <!-- EXECUTING: 暂停 -->
        <button
          v-if="detail?.status === 'EXECUTING'"
          class="btn btn-pause"
          type="button"
          :disabled="actionLoading"
          @click="handlePause"
        >
          <Pause :size="14" />
          <span>{{ actionLoading ? '暂停中…' : '暂停' }}</span>
        </button>

        <!-- PAUSED: 恢复 -->
        <button
          v-if="detail?.status === 'PAUSED'"
          class="btn btn-resume"
          type="button"
          :disabled="actionLoading"
          @click="handleResume"
        >
          <Play :size="14" />
          <span>{{ actionLoading ? '恢复中…' : '恢复' }}</span>
        </button>

        <!-- SUCCESS / FAILED: 查看飞行记录 -->
        <button
          v-if="detail?.status === 'SUCCESS' || detail?.status === 'FAILED'"
          class="btn btn-replay"
          type="button"
          @click="handleReplay"
        >
          <Play :size="14" />
          <span>查看飞行记录</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-overlay, rgba(0, 0, 0, 0.6));
}

.detail-modal-panel {
  display: flex;
  flex-direction: column;
  width: 640px;
  max-width: 90vw;
  max-height: 85vh;
  border-radius: var(--radius-lg, 8px);
  background: var(--app-bg-panel, #282828);
  border: 1px solid var(--app-border, #3a3a3a);
  box-shadow: var(--shadow-lg, 0 10px 25px -5px rgba(0, 0, 0, 0.3));
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--app-border, #3a3a3a);
  flex-shrink: 0;
}

.modal-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  color: var(--app-primary, #1890ff);
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text, #ffffff);
  margin: 0;
}

.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--app-text-muted, #8c8c8c);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm, 4px);
  transition: all var(--transition-base, 0.2s);
}

.modal-close:hover {
  color: var(--app-text, #ffffff);
  background: var(--app-hover-bg, rgba(255, 255, 255, 0.08));
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--app-danger-bg, rgba(239, 83, 80, 0.15));
  color: var(--app-danger, #ef5350);
  border-radius: var(--radius-md, 6px);
  font-size: 13px;
  margin-bottom: 16px;
}

.retry-btn {
  border: 1px solid var(--app-danger, #ef5350);
  background: transparent;
  color: var(--app-danger, #ef5350);
  border-radius: var(--radius-sm, 4px);
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}

.retry-btn:hover {
  background: var(--app-danger, #ef5350);
  color: #ffffff;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  color: var(--app-text-muted, #8c8c8c);
  font-size: 14px;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px 20px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-item.full-width {
  grid-column: 1 / -1;
}

.detail-label {
  font-size: 12px;
  color: var(--app-text-secondary, #a0a0a0);
  font-weight: 500;
}

.detail-value {
  font-size: 13px;
  color: var(--app-text, #ffffff);
  word-break: break-all;
}

.task-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--app-text, #ffffff);
}

.uuid-code,
.sn-code {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  background: var(--app-bg-surface, rgba(255, 255, 255, 0.04));
  padding: 2px 6px;
  border-radius: var(--radius-sm, 4px);
  color: var(--app-text-secondary, #a0a0a0);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--badge-color);
  background: color-mix(in srgb, var(--badge-color) 15%, transparent);
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--app-border, #3a3a3a);
  flex-shrink: 0;
  background: var(--app-bg-panel, #282828);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: var(--radius-md, 6px);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-base, 0.2s);
  border: 1px solid transparent;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-close {
  border-color: var(--app-border, #3a3a3a);
  background: transparent;
  color: var(--app-text-secondary, #a0a0a0);
}

.btn-close:hover {
  background: var(--app-hover-bg, rgba(255, 255, 255, 0.08));
  color: var(--app-text, #ffffff);
}

.btn-edit {
  border-color: var(--app-primary, #1890ff);
  background: transparent;
  color: var(--app-primary, #1890ff);
}

.btn-edit:hover {
  background: var(--app-primary, #1890ff);
  color: #ffffff;
}

.btn-pause {
  border-color: var(--app-warning, #fb923c);
  background: transparent;
  color: var(--app-warning, #fb923c);
}

.btn-pause:hover:not(:disabled) {
  background: var(--app-warning, #fb923c);
  color: #ffffff;
}

.btn-resume {
  border-color: var(--app-success, #4ade80);
  background: transparent;
  color: var(--app-success, #4ade80);
}

.btn-resume:hover:not(:disabled) {
  background: var(--app-success, #4ade80);
  color: #ffffff;
}

.btn-replay {
  border-color: var(--app-primary, #1890ff);
  background: var(--app-primary, #1890ff);
  color: #ffffff;
}

.btn-replay:hover {
  background: var(--app-primary-hover, #40a9ff);
}
</style>
