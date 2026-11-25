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

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * SEI 与 OSD 遥测 WebSocket 自动配置类。
 */
@AutoConfiguration
@ConditionalOnProperty(name = "fh.skeleton.feature.sei-osd.enabled", havingValue = "true", matchIfMissing = true)
@EnableWebSocket
public class SeiOsdAutoConfiguration implements WebSocketConfigurer {

    private final ObjectProvider<TelemetryWsHandler> telemetryWsHandlerProvider;

    public SeiOsdAutoConfiguration(ObjectProvider<TelemetryWsHandler> telemetryWsHandlerProvider) {
        this.telemetryWsHandlerProvider = telemetryWsHandlerProvider;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        TelemetryWsHandler handler = telemetryWsHandlerProvider.getIfAvailable();
        if (handler != null) {
            registry.addHandler(handler, "/api/v1/ws/telemetry")
                    .setAllowedOrigins("*");
        }
    }

    @Bean
    @ConditionalOnMissingBean
    public TelemetryWsHandler telemetryWsHandler() {
        return new TelemetryWsHandler();
    }

    @Bean
    @ConditionalOnMissingBean
    public OsdWsBroadcaster osdWsBroadcaster(ObjectMapper objectMapper, TelemetryWsHandler wsHandler) {
        return new OsdWsBroadcaster(objectMapper, wsHandler);
    }

    @Bean
    @ConditionalOnMissingBean
    public ObjectMapper fovObjectMapper() {
        return new ObjectMapper();
    }
}
