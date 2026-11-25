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

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TelemetryMessageTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void getterSetterAndSerialization() throws Exception {
        TelemetryMessage msg = new TelemetryMessage();
        msg.setUuid("uuid-123");
        msg.setType("mqtt_osd");
        msg.setTs(1700000000000L);
        msg.setField("location");
        msg.setData(Map.of("latitude", 22.5, "longitude", 113.9));

        assertThat(msg.getUuid()).isEqualTo("uuid-123");
        assertThat(msg.getType()).isEqualTo("mqtt_osd");
        assertThat(msg.getTs()).isEqualTo(1700000000000L);
        assertThat(msg.getField()).isEqualTo("location");
        assertThat(msg.getData()).isEqualTo(Map.of("latitude", 22.5, "longitude", 113.9));

        String json = objectMapper.writeValueAsString(msg);
        TelemetryMessage deserialized = objectMapper.readValue(json, TelemetryMessage.class);

        assertThat(deserialized.getUuid()).isEqualTo(msg.getUuid());
        assertThat(deserialized.getType()).isEqualTo(msg.getType());
        assertThat(deserialized.getTs()).isEqualTo(msg.getTs());
        assertThat(deserialized.getField()).isEqualTo(msg.getField());
        assertThat(deserialized).isEqualTo(msg);
        assertThat(deserialized.hashCode()).isEqualTo(msg.hashCode());
        assertThat(msg.toString()).contains("uuid-123", "mqtt_osd", "location");
    }
}
