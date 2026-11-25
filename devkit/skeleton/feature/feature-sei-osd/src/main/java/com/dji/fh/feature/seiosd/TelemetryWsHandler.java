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

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * 遥测 WebSocket 处理器（仅服务端下行推送）。
 */
public class TelemetryWsHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(TelemetryWsHandler.class);

    private final ConcurrentHashMap<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), session);
        log.info("Telemetry WS connected: sessionId={}, remoteAddress={}", session.getId(), session.getRemoteAddress());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
        log.info("Telemetry WS closed: sessionId={}, status={}", session.getId(), status);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.warn("Telemetry WS transport error: sessionId={}, error={}", session.getId(), exception.getMessage());
        sessions.remove(session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        // 仅单向下行推送，忽略客户端发送的消息
    }

    /**
     * 向所有在线的客户端广播 JSON 字符串。
     *
     * @param json 序列化后的 JSON 字符串
     */
    public void broadcastJson(String json) {
        if (json == null || sessions.isEmpty()) {
            return;
        }
        TextMessage textMessage = new TextMessage(json);
        for (WebSocketSession session : sessions.values()) {
            if (session.isOpen()) {
                try {
                    session.sendMessage(textMessage);
                } catch (IOException e) {
                    log.warn("Failed to send WebSocket message to session {}, removing session: {}",
                            session.getId(), e.getMessage());
                    sessions.remove(session.getId());
                    try {
                        session.close(CloseStatus.SERVER_ERROR);
                    } catch (IOException ignored) {
                        // ignore
                    }
                }
            } else {
                sessions.remove(session.getId());
            }
        }
    }

    public ConcurrentHashMap<String, WebSocketSession> getSessions() {
        return sessions;
    }

    public int sessionCount() {
        return sessions.size();
    }
}
