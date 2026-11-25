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

import com.dji.fh.kernel.spi.event.DockOsdUpdateEvent;
import com.dji.fh.kernel.spi.event.OsdUpdateEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;

/**
 * 监听 OSD 事件并经由 WebSocket 广播。
 */
public class OsdWsBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(OsdWsBroadcaster.class);
    private static final String TYPE_MQTT_OSD = "mqtt_osd";

    private final ObjectMapper objectMapper;
    private final TelemetryWsHandler wsHandler;

    public OsdWsBroadcaster(ObjectMapper objectMapper, TelemetryWsHandler wsHandler) {
        this.objectMapper = objectMapper;
        this.wsHandler = wsHandler;
    }

    @EventListener
    public void onOsdUpdate(OsdUpdateEvent event) {
        if (event == null || event.osd() == null) {
            return;
        }
        Map<String, Object> attrs = event.osd().attributes();
        if (attrs == null || attrs.isEmpty()) {
            return;
        }

        broadcastFieldIfPresent("location", extractLocation(attrs));
        broadcastFieldIfPresent("attitude", extractAttitude(attrs));
        broadcastFieldIfPresent("speed", extractSpeed(attrs));
        broadcastFieldIfPresent("battery", extractBattery(attrs));
    }

    @EventListener
    public void onDockOsdUpdate(DockOsdUpdateEvent event) {
        if (event == null || event.dockOsd() == null) {
            return;
        }
        Map<String, Object> attrs = event.dockOsd().attributes();
        if (attrs == null || attrs.isEmpty()) {
            return;
        }

        broadcastFieldIfPresent("dockLocation", extractDockLocation(attrs));
    }

    private void broadcastFieldIfPresent(String field, Map<String, Object> data) {
        if (data == null || data.isEmpty()) {
            return;
        }
        TelemetryMessage msg = new TelemetryMessage();
        msg.setUuid(UUID.randomUUID().toString());
        msg.setType(TYPE_MQTT_OSD);
        msg.setTs(System.currentTimeMillis());
        msg.setField(field);
        msg.setData(data);

        try {
            String json = objectMapper.writeValueAsString(msg);
            wsHandler.broadcastJson(json);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize TelemetryMessage for field={}", field, e);
        }
    }

    private Map<String, Object> extractLocation(Map<String, Object> attrs) {
        Map<String, Object> data = new LinkedHashMap<>();
        putIfPresent(data, "latitude", getFirst(attrs, "latitude", "lat"));
        putIfPresent(data, "longitude", getFirst(attrs, "longitude", "lng"));
        putIfPresent(data, "height", getFirst(attrs, "height", "altitude"));
        putIfPresent(data, "elevation", getFirst(attrs, "elevation"));
        return data;
    }

    private Map<String, Object> extractAttitude(Map<String, Object> attrs) {
        Map<String, Object> data = new LinkedHashMap<>();
        putIfPresent(data, "attitudeHead", getFirst(attrs, "attitudeHead", "head"));
        putIfPresent(data, "attitudePitch", getFirst(attrs, "attitudePitch", "pitch"));
        putIfPresent(data, "attitudeRoll", getFirst(attrs, "attitudeRoll", "roll"));
        return data;
    }

    private Map<String, Object> extractSpeed(Map<String, Object> attrs) {
        Map<String, Object> data = new LinkedHashMap<>();
        putIfPresent(data, "horizontalSpeed", getFirst(attrs, "horizontalSpeed", "speed"));
        putIfPresent(data, "verticalSpeed", getFirst(attrs, "verticalSpeed"));
        return data;
    }

    private Map<String, Object> extractBattery(Map<String, Object> attrs) {
        Map<String, Object> data = new LinkedHashMap<>();
        putIfPresent(data, "capacityPercent", getFirst(attrs, "capacityPercent", "battery_percent"));
        putIfPresent(data, "remainFlightTime", getFirst(attrs, "remainFlightTime", "battery_remain_flight_time"));
        putIfPresent(data, "returnHomePower", getFirst(attrs, "returnHomePower", "battery_return_home_power"));
        putIfPresent(data, "landingPower", getFirst(attrs, "landingPower", "battery_landing_power"));
        return data;
    }

    private Map<String, Object> extractDockLocation(Map<String, Object> attrs) {
        Map<String, Object> data = new LinkedHashMap<>();
        putIfPresent(data, "latitude", getFirst(attrs, "latitude", "lat"));
        putIfPresent(data, "longitude", getFirst(attrs, "longitude", "lng"));
        putIfPresent(data, "height", getFirst(attrs, "height", "altitude"));
        putIfPresent(data, "heading", getFirst(attrs, "heading"));
        return data;
    }

    private static Object getFirst(Map<String, Object> map, String... keys) {
        for (String key : keys) {
            Object val = map.get(key);
            if (val != null) {
                return val;
            }
        }
        return null;
    }

    private static void putIfPresent(Map<String, Object> map, String key, Object value) {
        if (value != null) {
            map.put(key, value);
        }
    }
}
