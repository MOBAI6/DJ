/*
 * Copyright 2026 DJI. All rights reserved.
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

package com.dji.fh.feature.seiosd;

import java.util.Objects;

/**
 * 前端遥测 WebSocket 传输消息 POJO。
 */
public class TelemetryMessage {

    private String uuid;
    private String type;
    private long ts;
    private String field;
    private Object data;

    public TelemetryMessage() {
    }

    public TelemetryMessage(String uuid, String type, long ts, String field, Object data) {
        this.uuid = uuid;
        this.type = type;
        this.ts = ts;
        this.field = field;
        this.data = data;
    }

    public String getUuid() {
        return uuid;
    }

    public void setUuid(String uuid) {
        this.uuid = uuid;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public long getTs() {
        return ts;
    }

    public void setTs(long ts) {
        this.ts = ts;
    }

    public String getField() {
        return field;
    }

    public void setField(String field) {
        this.field = field;
    }

    public Object getData() {
        return data;
    }

    public void setData(Object data) {
        this.data = data;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TelemetryMessage that = (TelemetryMessage) o;
        return ts == that.ts &&
                Objects.equals(uuid, that.uuid) &&
                Objects.equals(type, that.type) &&
                Objects.equals(field, that.field) &&
                Objects.equals(data, that.data);
    }

    @Override
    public int hashCode() {
        return Objects.hash(uuid, type, ts, field, data);
    }

    @Override
    public String toString() {
        return "TelemetryMessage{" +
                "uuid='" + uuid + '\'' +
                ", type='" + type + '\'' +
                ", ts=" + ts +
                ", field='" + field + '\'' +
                ", data=" + data +
                '}';
    }
}
