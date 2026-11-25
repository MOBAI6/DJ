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
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class SeiOsdAutoConfigurationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(SeiOsdAutoConfiguration.class));

    @Test
    void shouldRegisterAllBeans_whenDefaultProperties() {
        runner.run(ctx -> {
            assertThat(ctx).hasSingleBean(TelemetryWsHandler.class);
            assertThat(ctx).hasSingleBean(OsdWsBroadcaster.class);
            assertThat(ctx).hasSingleBean(ObjectMapper.class);
        });
    }

    @Test
    void shouldNotRegisterBeans_whenEnabledFalse() {
        runner.withPropertyValues("fh.skeleton.feature.sei-osd.enabled=false")
                .run(ctx -> {
                    assertThat(ctx).doesNotHaveBean(TelemetryWsHandler.class);
                    assertThat(ctx).doesNotHaveBean(OsdWsBroadcaster.class);
                });
    }

    @Test
    void shouldAllowCustomObjectMapperOverride() {
        ObjectMapper customMapper = new ObjectMapper();
        runner.withBean(ObjectMapper.class, () -> customMapper)
                .run(ctx -> {
                    assertThat(ctx.getBean(ObjectMapper.class)).isSameAs(customMapper);
                    assertThat(ctx).hasSingleBean(TelemetryWsHandler.class);
                    assertThat(ctx).hasSingleBean(OsdWsBroadcaster.class);
                });
    }
}
