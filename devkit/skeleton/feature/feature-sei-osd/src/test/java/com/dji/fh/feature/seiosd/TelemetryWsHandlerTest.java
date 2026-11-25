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

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.security.Principal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketExtension;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;

class TelemetryWsHandlerTest {

    private TelemetryWsHandler handler;

    @BeforeEach
    void setUp() {
        handler = new TelemetryWsHandler();
    }

    @Test
    void sessionLifecycle_addAndRemove() throws Exception {
        TestWebSocketSession session = new TestWebSocketSession("session-1");

        handler.afterConnectionEstablished(session);
        assertThat(handler.sessionCount()).isEqualTo(1);
        assertThat(handler.getSessions()).containsKey("session-1");

        handler.afterConnectionClosed(session, CloseStatus.NORMAL);
        assertThat(handler.sessionCount()).isZero();
        assertThat(handler.getSessions()).isEmpty();
    }

    @Test
    void handleTransportError_shouldRemoveSession() throws Exception {
        TestWebSocketSession session = new TestWebSocketSession("session-err");
        handler.afterConnectionEstablished(session);
        assertThat(handler.sessionCount()).isEqualTo(1);

        handler.handleTransportError(session, new RuntimeException("connection reset"));
        assertThat(handler.sessionCount()).isZero();
    }

    @Test
    void broadcastJson_shouldDeliverToAllOpenSessions() throws Exception {
        TestWebSocketSession s1 = new TestWebSocketSession("s1");
        TestWebSocketSession s2 = new TestWebSocketSession("s2");

        handler.afterConnectionEstablished(s1);
        handler.afterConnectionEstablished(s2);

        handler.broadcastJson("{\"msg\":\"hello\"}");

        assertThat(s1.getSentMessages()).hasSize(1);
        assertThat(s1.getSentMessages().get(0).getPayload()).isEqualTo("{\"msg\":\"hello\"}");
        assertThat(s2.getSentMessages()).hasSize(1);
        assertThat(s2.getSentMessages().get(0).getPayload()).isEqualTo("{\"msg\":\"hello\"}");
    }

    @Test
    void broadcastJson_shouldRemoveFailedSessionWhenIOException() throws Exception {
        TestWebSocketSession normalSession = new TestWebSocketSession("normal");
        TestWebSocketSession brokenSession = new TestWebSocketSession("broken") {
            @Override
            public void sendMessage(WebSocketMessage<?> message) throws IOException {
                throw new IOException("network broken");
            }
        };

        handler.afterConnectionEstablished(normalSession);
        handler.afterConnectionEstablished(brokenSession);
        assertThat(handler.sessionCount()).isEqualTo(2);

        handler.broadcastJson("{\"msg\":\"test\"}");

        assertThat(normalSession.getSentMessages()).hasSize(1);
        assertThat(handler.sessionCount()).isEqualTo(1);
        assertThat(handler.getSessions()).containsKey("normal");
        assertThat(handler.getSessions()).doesNotContainKey("broken");
    }

    @Test
    void broadcastJson_nullOrEmptySessions_shouldNotFail() {
        handler.broadcastJson(null);
        handler.broadcastJson("{\"hello\":\"world\"}");
        assertThat(handler.sessionCount()).isZero();
    }

    private static class TestWebSocketSession implements WebSocketSession {
        private final String id;
        private boolean open = true;
        private final List<TextMessage> sentMessages = new ArrayList<>();
        private final Map<String, Object> attributes = new HashMap<>();

        public TestWebSocketSession(String id) {
            this.id = id;
        }

        public List<TextMessage> getSentMessages() {
            return sentMessages;
        }

        @Override public String getId() { return id; }
        @Override public URI getUri() { return URI.create("/api/v1/ws/telemetry"); }
        @Override public HttpHeaders getHandshakeHeaders() { return new HttpHeaders(); }
        @Override public Map<String, Object> getAttributes() { return attributes; }
        @Override public Principal getPrincipal() { return null; }
        @Override public InetSocketAddress getLocalAddress() { return null; }
        @Override public InetSocketAddress getRemoteAddress() { return new InetSocketAddress(8080); }
        @Override public String getAcceptedProtocol() { return null; }
        @Override public void setTextMessageSizeLimit(int messageSizeLimit) {}
        @Override public int getTextMessageSizeLimit() { return 65536; }
        @Override public void setBinaryMessageSizeLimit(int messageSizeLimit) {}
        @Override public int getBinaryMessageSizeLimit() { return 65536; }
        @Override public List<WebSocketExtension> getExtensions() { return Collections.emptyList(); }
        @Override public boolean isOpen() { return open; }
        @Override
        public void sendMessage(WebSocketMessage<?> message) throws IOException {
            if (message instanceof TextMessage tm) {
                sentMessages.add(tm);
            }
        }
        @Override public void close() { open = false; }
        @Override public void close(CloseStatus status) { open = false; }
    }
}
