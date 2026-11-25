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

import com.dji.fh.kernel.spi.event.DockOsdData;
import com.dji.fh.kernel.spi.event.DockOsdUpdateEvent;
import com.dji.fh.kernel.spi.event.OsdData;
import com.dji.fh.kernel.spi.event.OsdUpdateEvent;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OsdWsBroadcasterTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private List<String> broadcastedJsons;
    private TelemetryWsHandler wsHandler;
    private OsdWsBroadcaster broadcaster;

    @BeforeEach
    void setUp() {
        broadcastedJsons = new ArrayList<>();
        wsHandler = new TelemetryWsHandler() {
            @Override
            public void broadcastJson(String json) {
                broadcastedJsons.add(json);
            }
        };
        broadcaster = new OsdWsBroadcaster(objectMapper, wsHandler);
    }

    @Test
    void onOsdUpdate_shouldBroadcastGroupedFields_withStandardKeys() throws Exception {
        Map<String, Object> rawAttrs = Map.ofEntries(
                Map.entry("latitude", 22.5401),
                Map.entry("longitude", 113.9345),
                Map.entry("height", 88.5),
                Map.entry("elevation", 120.0),
                Map.entry("attitudeHead", 45.0),
                Map.entry("attitudePitch", -10.0),
                Map.entry("attitudeRoll", 2.0),
                Map.entry("horizontalSpeed", 5.6),
                Map.entry("verticalSpeed", 1.2),
                Map.entry("capacityPercent", 80),
                Map.entry("remainFlightTime", 1200),
                Map.entry("returnHomePower", 20),
                Map.entry("landingPower", 10)
        );

        OsdUpdateEvent event = new OsdUpdateEvent("test", "DRONE-SN-1", new OsdData(rawAttrs));
        broadcaster.onOsdUpdate(event);

        assertThat(broadcastedJsons).hasSize(4);

        Map<String, TelemetryMessage> messagesByField = parseMessagesByField(broadcastedJsons);
        assertThat(messagesByField).containsOnlyKeys("location", "attitude", "speed", "battery");

        // 验证 location
        TelemetryMessage locMsg = messagesByField.get("location");
        assertThat(locMsg.getType()).isEqualTo("mqtt_osd");
        assertThat(locMsg.getUuid()).isNotBlank();
        assertThat(locMsg.getTs()).isPositive();
        @SuppressWarnings("unchecked")
        Map<String, Object> locData = (Map<String, Object>) locMsg.getData();
        assertThat(locData.get("latitude")).isEqualTo(22.5401);
        assertThat(locData.get("longitude")).isEqualTo(113.9345);
        assertThat(locData.get("height")).isEqualTo(88.5);
        assertThat(locData.get("elevation")).isEqualTo(120.0);

        // 验证 attitude
        TelemetryMessage attMsg = messagesByField.get("attitude");
        @SuppressWarnings("unchecked")
        Map<String, Object> attData = (Map<String, Object>) attMsg.getData();
        assertThat(attData.get("attitudeHead")).isEqualTo(45.0);
        assertThat(attData.get("attitudePitch")).isEqualTo(-10.0);
        assertThat(attData.get("attitudeRoll")).isEqualTo(2.0);

        // 验证 speed
        TelemetryMessage speedMsg = messagesByField.get("speed");
        @SuppressWarnings("unchecked")
        Map<String, Object> speedData = (Map<String, Object>) speedMsg.getData();
        assertThat(speedData.get("horizontalSpeed")).isEqualTo(5.6);
        assertThat(speedData.get("verticalSpeed")).isEqualTo(1.2);

        // 验证 battery
        TelemetryMessage battMsg = messagesByField.get("battery");
        @SuppressWarnings("unchecked")
        Map<String, Object> battData = (Map<String, Object>) battMsg.getData();
        assertThat(battData.get("capacityPercent")).isEqualTo(80);
        assertThat(battData.get("remainFlightTime")).isEqualTo(1200);
        assertThat(battData.get("returnHomePower")).isEqualTo(20);
        assertThat(battData.get("landingPower")).isEqualTo(10);
    }

    @Test
    void onOsdUpdate_shouldSupportAliasedKeysFromKernelAggregator() throws Exception {
        Map<String, Object> rawAttrs = Map.of(
                "lat", 30.123,
                "lng", 120.456,
                "head", 90.0,
                "speed", 8.0,
                "battery_percent", 75
        );

        OsdUpdateEvent event = new OsdUpdateEvent("test", "DRONE-SN-2", new OsdData(rawAttrs));
        broadcaster.onOsdUpdate(event);

        Map<String, TelemetryMessage> messagesByField = parseMessagesByField(broadcastedJsons);
        assertThat(messagesByField).containsOnlyKeys("location", "attitude", "speed", "battery");

        @SuppressWarnings("unchecked")
        Map<String, Object> locData = (Map<String, Object>) messagesByField.get("location").getData();
        assertThat(locData.get("latitude")).isEqualTo(30.123);
        assertThat(locData.get("longitude")).isEqualTo(120.456);

        @SuppressWarnings("unchecked")
        Map<String, Object> attData = (Map<String, Object>) messagesByField.get("attitude").getData();
        assertThat(attData.get("attitudeHead")).isEqualTo(90.0);

        @SuppressWarnings("unchecked")
        Map<String, Object> speedData = (Map<String, Object>) messagesByField.get("speed").getData();
        assertThat(speedData.get("horizontalSpeed")).isEqualTo(8.0);

        @SuppressWarnings("unchecked")
        Map<String, Object> battData = (Map<String, Object>) messagesByField.get("battery").getData();
        assertThat(battData.get("capacityPercent")).isEqualTo(75);
    }

    @Test
    void onDockOsdUpdate_shouldBroadcastDockLocation() throws Exception {
        Map<String, Object> dockAttrs = Map.of(
                "latitude", 31.23,
                "longitude", 121.47,
                "height", 5.0,
                "heading", 180.0
        );

        DockOsdUpdateEvent event = new DockOsdUpdateEvent("test", "DOCK-SN-1", new DockOsdData(dockAttrs));
        broadcaster.onDockOsdUpdate(event);

        assertThat(broadcastedJsons).hasSize(1);
        TelemetryMessage msg = objectMapper.readValue(broadcastedJsons.get(0), TelemetryMessage.class);

        assertThat(msg.getType()).isEqualTo("mqtt_osd");
        assertThat(msg.getField()).isEqualTo("dockLocation");
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) msg.getData();
        assertThat(data.get("latitude")).isEqualTo(31.23);
        assertThat(data.get("longitude")).isEqualTo(121.47);
        assertThat(data.get("height")).isEqualTo(5.0);
        assertThat(data.get("heading")).isEqualTo(180.0);
    }

    @Test
    void onOsdUpdate_emptyOrNull_shouldNotBroadcast() {
        broadcaster.onOsdUpdate(null);
        broadcaster.onOsdUpdate(new OsdUpdateEvent("test", "SN", new OsdData(Map.of())));
        broadcaster.onDockOsdUpdate(null);
        broadcaster.onDockOsdUpdate(new DockOsdUpdateEvent("test", "SN", new DockOsdData(Map.of())));

        assertThat(broadcastedJsons).isEmpty();
    }

    private Map<String, TelemetryMessage> parseMessagesByField(List<String> jsons) throws Exception {
        Map<String, TelemetryMessage> result = new java.util.HashMap<>();
        for (String json : jsons) {
            TelemetryMessage msg = objectMapper.readValue(json, TelemetryMessage.class);
            result.put(msg.getField(), msg);
        }
        return result;
    }
}
