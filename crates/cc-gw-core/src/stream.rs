use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::observability::UsageStats;
use crate::provider::ProviderProtocol;

#[derive(Debug, Clone, Default)]
struct UsageState {
    input_tokens: i64,
    output_tokens: i64,
    cached_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
}

impl UsageState {
    fn update_from_openai(&mut self, usage: Option<&Value>) {
        let Some(usage) = usage else { return };
        if let Some(value) = usage.get("prompt_tokens").and_then(Value::as_i64) {
            self.input_tokens = value;
        }
        if let Some(value) = usage.get("completion_tokens").and_then(Value::as_i64) {
            self.output_tokens = value;
        }
        if let Some(value) = usage.get("input_tokens").and_then(Value::as_i64) {
            self.input_tokens = value;
        }
        if let Some(value) = usage.get("output_tokens").and_then(Value::as_i64) {
            self.output_tokens = value;
        }
        if let Some(value) = usage.get("cached_tokens").and_then(Value::as_i64) {
            self.cached_tokens = value;
            self.cache_read_tokens = value;
        }
        if let Some(value) = usage
            .get("cache_read_tokens")
            .or_else(|| usage.get("cache_read_input_tokens"))
            .and_then(Value::as_i64)
        {
            self.cache_read_tokens = value;
        }
        if let Some(value) = usage
            .get("cache_creation_tokens")
            .or_else(|| usage.get("cache_creation_input_tokens"))
            .and_then(Value::as_i64)
        {
            self.cache_creation_tokens = value;
        }
        if let Some(value) = usage
            .get("prompt_tokens_details")
            .and_then(|details| details.get("cached_tokens"))
            .and_then(Value::as_i64)
        {
            self.cache_read_tokens = value;
        }
        if let Some(value) = usage
            .get("input_tokens_details")
            .and_then(|details| details.get("cached_tokens"))
            .and_then(Value::as_i64)
        {
            self.cache_read_tokens = value;
        }
        self.cached_tokens = self.cache_read_tokens + self.cache_creation_tokens;
    }

    fn update_from_anthropic(&mut self, usage: Option<&Value>) {
        let Some(usage) = usage else { return };
        if let Some(value) = usage.get("input_tokens").and_then(Value::as_i64) {
            self.input_tokens = value;
        }
        if let Some(value) = usage.get("output_tokens").and_then(Value::as_i64) {
            self.output_tokens = value;
        }
        if let Some(value) = usage.get("cache_read_input_tokens").and_then(Value::as_i64) {
            self.cache_read_tokens = value;
        }
        if let Some(value) = usage
            .get("cache_creation_input_tokens")
            .and_then(Value::as_i64)
        {
            self.cache_creation_tokens = value;
        }
        self.cached_tokens = self.cache_read_tokens + self.cache_creation_tokens;
    }

    fn to_usage_stats(&self) -> UsageStats {
        UsageStats {
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            cached_tokens: self.cached_tokens,
            cache_read_tokens: self.cache_read_tokens,
            cache_creation_tokens: self.cache_creation_tokens,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct StreamObservation {
    pub saw_first_token: bool,
}

#[derive(Debug, Clone)]
pub struct SseStreamObserver {
    protocol: ProviderProtocol,
    buffer: String,
    usage: UsageState,
    first_content_seen: bool,
}

impl SseStreamObserver {
    pub fn new(protocol: ProviderProtocol) -> Self {
        Self {
            protocol,
            buffer: String::new(),
            usage: UsageState::default(),
            first_content_seen: false,
        }
    }

    pub fn push(&mut self, chunk: &str) -> StreamObservation {
        self.buffer.push_str(chunk);
        let mut observation = StreamObservation::default();

        while let Some(boundary) = self.buffer.find("\n\n") {
            let raw_event = self.buffer[..boundary].to_string();
            self.buffer = self.buffer[boundary + 2..].to_string();
            self.observe_event_block(&raw_event, &mut observation);
        }

        observation
    }

    pub fn finish(&mut self) -> StreamObservation {
        let mut observation = StreamObservation::default();
        if !self.buffer.trim().is_empty() {
            let leftover = self.buffer.clone();
            self.buffer.clear();
            self.observe_event_block(&leftover, &mut observation);
        }
        observation
    }

    pub fn usage_stats(&self) -> UsageStats {
        self.usage.to_usage_stats()
    }

    fn observe_event_block(&mut self, block: &str, observation: &mut StreamObservation) {
        if block.trim().is_empty() {
            return;
        }

        let mut data_lines = Vec::new();
        for line in block.lines() {
            let trimmed = line.trim_end_matches('\r');
            if let Some(rest) = trimmed.strip_prefix("data:") {
                data_lines.push(rest.trim().to_string());
            }
        }

        let data = data_lines.join("\n");
        if data.is_empty() || data == "[DONE]" {
            return;
        }

        let Ok(event) = serde_json::from_str::<Value>(&data) else {
            return;
        };

        if !self.first_content_seen && self.detect_content(&event) {
            self.first_content_seen = true;
            observation.saw_first_token = true;
        }

        match self.protocol {
            ProviderProtocol::AnthropicMessages => {
                self.usage.update_from_anthropic(
                    event
                        .get("usage")
                        .or_else(|| event.get("delta").and_then(|value| value.get("usage"))),
                );
            }
            ProviderProtocol::OpenAiChatCompletions => {
                self.usage
                    .update_from_openai(event.get("usage").or_else(|| {
                        event.get("choices").and_then(|choices| {
                            choices
                                .as_array()
                                .and_then(|choices| choices.first())
                                .and_then(|choice| choice.get("delta"))
                                .and_then(|delta| delta.get("usage"))
                        })
                    }));
            }
            ProviderProtocol::OpenAiResponses => {
                self.usage
                    .update_from_openai(event.get("usage").or_else(|| {
                        event
                            .get("response")
                            .and_then(|response| response.get("usage"))
                    }));
            }
        }
    }

    fn detect_content(&self, event: &Value) -> bool {
        match self.protocol {
            ProviderProtocol::AnthropicMessages => {
                event.get("type").and_then(Value::as_str) == Some("content_block_delta")
                    && event
                        .get("delta")
                        .and_then(|delta| delta.get("type"))
                        .and_then(Value::as_str)
                        == Some("text_delta")
            }
            ProviderProtocol::OpenAiChatCompletions => event
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("delta"))
                .is_some_and(|delta| {
                    delta.get("content").is_some() || delta.get("reasoning_content").is_some()
                }),
            ProviderProtocol::OpenAiResponses => matches!(
                event.get("type").and_then(Value::as_str),
                Some("response.output_text.delta")
                    | Some("response.content_part.delta")
                    | Some("response.output_item.content_part.delta")
            ),
        }
    }
}

#[derive(Debug, Clone)]
struct OpenAiToolState {
    id: String,
    name: String,
    arguments: String,
    block_index: usize,
    stopped: bool,
}

#[derive(Debug, Clone)]
struct AnthropicToolState {
    id: String,
    name: String,
    arguments: String,
}

enum StreamMode {
    OpenAiChatToAnthropic,
    OpenAiResponsesToAnthropic,
    AnthropicToOpenAiChat,
    AnthropicToOpenAiResponses,
}

pub struct CrossProtocolStreamTransformer {
    mode: StreamMode,
    model: String,
    created: i64,
    buffer: String,
    message_id: String,
    response_id: String,
    response_output_id: String,
    message_started: bool,
    text_block_started: bool,
    text_block_stopped: bool,
    usage: UsageState,
    stop_reason: Option<String>,
    openai_tool_calls: BTreeMap<usize, OpenAiToolState>,
    anthropic_tools: BTreeMap<usize, AnthropicToolState>,
    responses_tool_names: BTreeMap<String, String>,
    responses_text: String,
    finished: bool,
}

impl CrossProtocolStreamTransformer {
    pub fn new(
        request_protocol: ProviderProtocol,
        target_protocol: ProviderProtocol,
        model: impl Into<String>,
    ) -> Self {
        let mode = match (request_protocol, target_protocol) {
            (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiChatCompletions) => {
                StreamMode::OpenAiChatToAnthropic
            }
            (ProviderProtocol::AnthropicMessages, ProviderProtocol::OpenAiResponses) => {
                StreamMode::OpenAiResponsesToAnthropic
            }
            (ProviderProtocol::OpenAiChatCompletions, ProviderProtocol::AnthropicMessages) => {
                StreamMode::AnthropicToOpenAiChat
            }
            (ProviderProtocol::OpenAiResponses, ProviderProtocol::AnthropicMessages) => {
                StreamMode::AnthropicToOpenAiResponses
            }
            _ => panic!("unsupported streaming cross-protocol conversion"),
        };

        let created = chrono::Utc::now().timestamp();
        Self {
            mode,
            model: model.into(),
            created,
            buffer: String::new(),
            message_id: format!("msg_{}", nanoid_like()),
            response_id: format!("resp_{}", nanoid_like()),
            response_output_id: format!("out_{}", nanoid_like()),
            message_started: false,
            text_block_started: false,
            text_block_stopped: false,
            usage: UsageState::default(),
            stop_reason: None,
            openai_tool_calls: BTreeMap::new(),
            anthropic_tools: BTreeMap::new(),
            responses_tool_names: BTreeMap::new(),
            responses_text: String::new(),
            finished: false,
        }
    }

    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buffer.push_str(chunk);
        let mut out = Vec::new();

        while let Some(boundary) = self.buffer.find("\n\n") {
            let raw_event = self.buffer[..boundary].to_string();
            self.buffer = self.buffer[boundary + 2..].to_string();
            if raw_event.trim().is_empty() {
                continue;
            }
            out.extend(self.transform_event_block(&raw_event));
        }

        out
    }

    pub fn finish(&mut self) -> Vec<String> {
        if self.finished {
            return Vec::new();
        }

        let mut out = Vec::new();
        if !self.buffer.trim().is_empty() {
            let leftover = self.buffer.clone();
            self.buffer.clear();
            out.extend(self.transform_event_block(&leftover));
        }
        out.extend(self.synthesize_finish());
        out
    }

    fn transform_event_block(&mut self, block: &str) -> Vec<String> {
        let mut event_name: Option<String> = None;
        let mut data_lines = Vec::new();

        for line in block.lines() {
            let trimmed = line.trim_end_matches('\r');
            if let Some(rest) = trimmed.strip_prefix("event:") {
                event_name = Some(rest.trim().to_string());
            } else if let Some(rest) = trimmed.strip_prefix("data:") {
                data_lines.push(rest.trim().to_string());
            }
        }

        let data = data_lines.join("\n");
        if data == "[DONE]" {
            return self.synthesize_finish();
        }
        if data.is_empty() {
            return Vec::new();
        }

        let parsed = match serde_json::from_str::<Value>(&data) {
            Ok(value) => value,
            Err(_) => return Vec::new(),
        };

        match self.mode {
            StreamMode::OpenAiChatToAnthropic => self.openai_chat_to_anthropic(parsed),
            StreamMode::OpenAiResponsesToAnthropic => self.openai_responses_to_anthropic(parsed),
            StreamMode::AnthropicToOpenAiChat => {
                self.anthropic_to_openai_chat(event_name.as_deref(), parsed)
            }
            StreamMode::AnthropicToOpenAiResponses => {
                self.anthropic_to_openai_responses(event_name.as_deref(), parsed)
            }
        }
    }

    fn openai_chat_to_anthropic(&mut self, event: Value) -> Vec<String> {
        let mut out = Vec::new();
        self.usage.update_from_openai(event.get("usage"));
        let choice = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .cloned()
            .unwrap_or_else(|| json!({}));
        let delta = choice.get("delta").cloned().unwrap_or_else(|| json!({}));

        if !self.message_started
            && (delta.get("content").is_some()
                || delta.get("tool_calls").is_some()
                || choice.get("finish_reason").is_some())
        {
            self.message_started = true;
            if let Some(id) = event.get("id").and_then(Value::as_str) {
                self.message_id = id.replace("chatcmpl", "msg");
            }
            out.push(anthropic_event(
                "message_start",
                json!({
                    "type": "message_start",
                    "message": {
                        "id": self.message_id,
                        "type": "message",
                        "role": "assistant",
                        "model": self.model,
                        "content": [],
                        "stop_reason": Value::Null,
                        "stop_sequence": Value::Null,
                        "usage": { "input_tokens": 0, "output_tokens": 0 }
                    }
                }),
            ));
        }

        if let Some(text) = delta.get("content").and_then(Value::as_str) {
            if !self.text_block_started {
                self.text_block_started = true;
                out.push(anthropic_event(
                    "content_block_start",
                    json!({
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": { "type": "text", "text": "" }
                    }),
                ));
            }
            out.push(anthropic_event(
                "content_block_delta",
                json!({
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": { "type": "text_delta", "text": text }
                }),
            ));
        }

        if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for tool_call in tool_calls {
                let index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let id = tool_call
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
                    .or_else(|| {
                        self.openai_tool_calls
                            .get(&index)
                            .map(|state| state.id.clone())
                    })
                    .unwrap_or_else(|| format!("call_{}", nanoid_like()));
                let name = tool_call
                    .get("function")
                    .and_then(|value| value.get("name"))
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
                    .or_else(|| {
                        self.openai_tool_calls
                            .get(&index)
                            .map(|state| state.name.clone())
                    })
                    .unwrap_or_else(|| "tool".to_string());
                let arguments = tool_call
                    .get("function")
                    .and_then(|value| value.get("arguments"))
                    .and_then(Value::as_str)
                    .unwrap_or("");

                let entry =
                    self.openai_tool_calls
                        .entry(index)
                        .or_insert_with(|| OpenAiToolState {
                            id: id.clone(),
                            name: name.clone(),
                            arguments: String::new(),
                            block_index: if self.text_block_started {
                                index + 1
                            } else {
                                index
                            },
                            stopped: false,
                        });
                entry.id = id.clone();
                entry.name = name.clone();

                if entry.arguments.is_empty() {
                    out.push(anthropic_event(
                        "content_block_start",
                        json!({
                            "type": "content_block_start",
                            "index": entry.block_index,
                            "content_block": {
                                "type": "tool_use",
                                "id": entry.id,
                                "name": entry.name,
                                "input": {}
                            }
                        }),
                    ));
                }

                if !arguments.is_empty() {
                    entry.arguments.push_str(arguments);
                    out.push(anthropic_event(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": entry.block_index,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": arguments
                            }
                        }),
                    ));
                }
            }
        }

        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.stop_reason = Some(reason.to_string());
            out.extend(self.synthesize_finish());
        }

        out
    }

    fn anthropic_to_openai_chat(&mut self, _event_name: Option<&str>, event: Value) -> Vec<String> {
        let mut out = Vec::new();
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "message_start" => {
                if let Some(id) = event
                    .get("message")
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_str)
                {
                    self.message_id = id.replace("msg_", "chatcmpl_");
                }
            }
            "content_block_start" => {
                if let Some(content_block) = event.get("content_block") {
                    if content_block.get("type").and_then(Value::as_str) == Some("tool_use") {
                        let index =
                            event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                        let id = content_block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("call")
                            .to_string();
                        let name = content_block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        self.anthropic_tools.insert(
                            index,
                            AnthropicToolState {
                                id: id.clone(),
                                name: name.clone(),
                                arguments: String::new(),
                            },
                        );
                        out.push(openai_chat_chunk(
                            &self.message_id,
                            self.created,
                            &self.model,
                            json!({
                                "tool_calls": [{
                                    "index": index,
                                    "id": id,
                                    "type": "function",
                                    "function": { "name": name, "arguments": "" }
                                }]
                            }),
                            Value::Null,
                            None,
                        ));
                    }
                }
            }
            "content_block_delta" => {
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let delta = event.get("delta").cloned().unwrap_or_else(|| json!({}));
                match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            out.push(openai_chat_chunk(
                                &self.message_id,
                                self.created,
                                &self.model,
                                json!({ "content": text }),
                                Value::Null,
                                None,
                            ));
                        }
                    }
                    "input_json_delta" => {
                        let partial = delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        if let Some(tool) = self.anthropic_tools.get_mut(&index) {
                            tool.arguments.push_str(partial);
                            out.push(openai_chat_chunk(
                                &self.message_id,
                                self.created,
                                &self.model,
                                json!({
                                    "tool_calls": [{
                                        "index": index,
                                        "id": tool.id,
                                        "type": "function",
                                        "function": { "name": tool.name, "arguments": partial }
                                    }]
                                }),
                                Value::Null,
                                None,
                            ));
                        }
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                self.usage.update_from_anthropic(
                    event
                        .get("usage")
                        .or_else(|| event.get("delta").and_then(|value| value.get("usage"))),
                );
                if let Some(reason) = event
                    .get("delta")
                    .and_then(|value| value.get("stop_reason"))
                    .and_then(Value::as_str)
                {
                    self.stop_reason = Some(reason.to_string());
                    out.push(openai_chat_chunk(
                        &self.message_id,
                        self.created,
                        &self.model,
                        json!({}),
                        json!(map_anthropic_stop_reason_to_openai_finish(reason)),
                        Some(json!({
                            "prompt_tokens": self.usage.input_tokens,
                            "completion_tokens": self.usage.output_tokens,
                            "total_tokens": self.usage.input_tokens + self.usage.output_tokens,
                            "cached_tokens": self.usage.cached_tokens
                        })),
                    ));
                }
            }
            "message_stop" => {
                out.extend(self.synthesize_finish());
            }
            _ => {}
        }
        out
    }

    fn openai_responses_to_anthropic(&mut self, event: Value) -> Vec<String> {
        let mut out = Vec::new();
        self.usage
            .update_from_openai(event.get("usage").or_else(|| {
                event
                    .get("response")
                    .and_then(|response| response.get("usage"))
            }));

        if !self.message_started {
            self.message_started = true;
            let id_hint = event
                .get("response")
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                .or_else(|| event.get("id").and_then(Value::as_str))
                .or_else(|| event.get("response_id").and_then(Value::as_str))
                .unwrap_or(&self.response_id);
            self.message_id = id_hint.replace("resp_", "msg_");
            out.push(anthropic_event(
                "message_start",
                json!({
                    "type": "message_start",
                    "message": {
                        "id": self.message_id,
                        "type": "message",
                        "role": "assistant",
                        "model": self.model,
                        "content": [],
                        "stop_reason": Value::Null,
                        "stop_sequence": Value::Null,
                        "usage": { "input_tokens": 0, "output_tokens": 0 }
                    }
                }),
            ));
        }

        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        match event_type {
            "response.output_text.delta" => {
                if let Some(text) = event.get("delta").and_then(Value::as_str) {
                    if !text.is_empty() {
                        if !self.text_block_started {
                            self.text_block_started = true;
                            out.push(anthropic_event(
                                "content_block_start",
                                json!({
                                    "type": "content_block_start",
                                    "index": 0,
                                    "content_block": { "type": "text", "text": "" }
                                }),
                            ));
                        }
                        out.push(anthropic_event(
                            "content_block_delta",
                            json!({
                                "type": "content_block_delta",
                                "index": 0,
                                "delta": { "type": "text_delta", "text": text }
                            }),
                        ));
                    }
                }
            }
            "response.content_part.delta" | "response.output_item.content_part.delta" => {
                if let Some(text) = event
                    .get("delta")
                    .and_then(|delta| delta.get("text"))
                    .and_then(Value::as_str)
                {
                    if !text.is_empty() {
                        if !self.text_block_started {
                            self.text_block_started = true;
                            out.push(anthropic_event(
                                "content_block_start",
                                json!({
                                    "type": "content_block_start",
                                    "index": 0,
                                    "content_block": { "type": "text", "text": "" }
                                }),
                            ));
                        }
                        out.push(anthropic_event(
                            "content_block_delta",
                            json!({
                                "type": "content_block_delta",
                                "index": 0,
                                "delta": { "type": "text_delta", "text": text }
                            }),
                        ));
                    }
                }
            }
            "response.output_item.added" => {
                if let Some(item) = event.get("item") {
                    if let (Some(id), Some(name)) = (
                        item.get("id").and_then(Value::as_str),
                        item.get("name").and_then(Value::as_str),
                    ) {
                        self.responses_tool_names
                            .insert(id.to_string(), name.to_string());
                    }
                }
            }
            "response.function_call_arguments.delta" => {
                let item_id = event.get("item_id").and_then(Value::as_str);
                let delta = event.get("delta").and_then(Value::as_str);
                if let (Some(item_id), Some(delta)) = (item_id, delta) {
                    let existing_index = self
                        .openai_tool_calls
                        .iter()
                        .find_map(|(index, state)| (state.id == item_id).then_some(*index));
                    let index = existing_index.unwrap_or(self.openai_tool_calls.len());
                    let state =
                        self.openai_tool_calls
                            .entry(index)
                            .or_insert_with(|| OpenAiToolState {
                                id: item_id.to_string(),
                                name: self
                                    .responses_tool_names
                                    .get(item_id)
                                    .cloned()
                                    .unwrap_or_else(|| "tool".to_string()),
                                arguments: String::new(),
                                block_index: if self.text_block_started {
                                    index + 1
                                } else {
                                    index
                                },
                                stopped: false,
                            });
                    if state.arguments.is_empty() {
                        out.push(anthropic_event(
                            "content_block_start",
                            json!({
                                "type": "content_block_start",
                                "index": state.block_index,
                                "content_block": {
                                    "type": "tool_use",
                                    "id": state.id,
                                    "name": state.name,
                                    "input": {}
                                }
                            }),
                        ));
                    }
                    state.arguments.push_str(delta);
                    out.push(anthropic_event(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": state.block_index,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": delta
                            }
                        }),
                    ));
                }
            }
            "response.completed" | "response.done" => {
                if self.stop_reason.is_none() {
                    self.stop_reason =
                        infer_openai_responses_stop_reason(&event).map(ToString::to_string);
                }
                out.extend(self.reconcile_openai_responses_completed_event(&event));
                out.extend(self.synthesize_finish());
            }
            _ => {}
        }

        out
    }

    fn reconcile_openai_responses_completed_event(&mut self, event: &Value) -> Vec<String> {
        let Some(output) = event
            .get("response")
            .and_then(|response| response.get("output"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };

        let mut out = Vec::new();
        let mut synthesized_tool_index = self.openai_tool_calls.len();
        for item in output {
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for block in content {
                    out.extend(self.reconcile_openai_responses_output_block(
                        block,
                        &mut synthesized_tool_index,
                    ));
                }
            } else {
                out.extend(
                    self.reconcile_openai_responses_output_block(item, &mut synthesized_tool_index),
                );
            }
        }

        out
    }

    fn reconcile_openai_responses_output_block(
        &mut self,
        block: &Value,
        synthesized_tool_index: &mut usize,
    ) -> Vec<String> {
        let mut out = Vec::new();
        match block.get("type").and_then(Value::as_str) {
            Some("output_text") | Some("text") => {
                let text = block
                    .get("text")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        block
                            .get("content")
                            .and_then(Value::as_array)
                            .and_then(|parts| parts.first())
                            .and_then(|part| part.get("text"))
                            .and_then(Value::as_str)
                    })
                    .unwrap_or("");
                if !text.is_empty() && !self.text_block_started {
                    self.text_block_started = true;
                    out.push(anthropic_event(
                        "content_block_start",
                        json!({
                            "type": "content_block_start",
                            "index": 0,
                            "content_block": { "type": "text", "text": "" }
                        }),
                    ));
                    out.push(anthropic_event(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": 0,
                            "delta": { "type": "text_delta", "text": text }
                        }),
                    ));
                }
            }
            Some("function_call") | Some("tool_use") => {
                let id = block
                    .get("id")
                    .or_else(|| block.get("call_id"))
                    .and_then(Value::as_str)
                    .unwrap_or("call");
                let already_seen = self
                    .openai_tool_calls
                    .values()
                    .any(|state| state.id == id || state.id == format!("fc_{id}"));
                if already_seen {
                    return out;
                }

                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .to_string();
                let arguments_value = block
                    .get("arguments")
                    .cloned()
                    .or_else(|| block.get("input").cloned())
                    .unwrap_or_else(|| json!({}));
                let arguments = match &arguments_value {
                    Value::String(value) => value.clone(),
                    _ => {
                        serde_json::to_string(&arguments_value).unwrap_or_else(|_| "{}".to_string())
                    }
                };
                let index = *synthesized_tool_index;
                *synthesized_tool_index += 1;
                let block_index = if self.text_block_started {
                    index + 1
                } else {
                    index
                };
                self.openai_tool_calls.insert(
                    index,
                    OpenAiToolState {
                        id: id.to_string(),
                        name: name.clone(),
                        arguments: arguments.clone(),
                        block_index,
                        stopped: false,
                    },
                );
                out.push(anthropic_event(
                    "content_block_start",
                    json!({
                        "type": "content_block_start",
                        "index": block_index,
                        "content_block": {
                            "type": "tool_use",
                            "id": id,
                            "name": name,
                            "input": {}
                        }
                    }),
                ));
                if !arguments.is_empty() {
                    out.push(anthropic_event(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": block_index,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": arguments
                            }
                        }),
                    ));
                }
            }
            _ => {}
        }
        out
    }

    fn anthropic_to_openai_responses(
        &mut self,
        _event_name: Option<&str>,
        event: Value,
    ) -> Vec<String> {
        let mut out = Vec::new();
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "message_start" => {
                if !self.message_started {
                    self.message_started = true;
                    if let Some(id) = event
                        .get("message")
                        .and_then(|value| value.get("id"))
                        .and_then(Value::as_str)
                    {
                        self.response_id = id.replace("msg_", "resp_");
                        self.response_output_id =
                            format!("out_{}", self.response_id.trim_start_matches("resp_"));
                    }
                    out.push(openai_responses_event(json!({
                        "type": "response.created",
                        "response": {
                            "id": self.response_id,
                            "object": "response",
                            "created": self.created,
                            "status": "in_progress",
                            "model": self.model
                        }
                    })));
                }
            }
            "content_block_start" => {
                if let Some(content_block) = event.get("content_block") {
                    let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                    match content_block.get("type").and_then(Value::as_str) {
                        Some("tool_use") => {
                            let id = content_block
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or("call")
                                .to_string();
                            let name = content_block
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("tool")
                                .to_string();
                            self.anthropic_tools.insert(
                                index,
                                AnthropicToolState {
                                    id: id.clone(),
                                    name: name.clone(),
                                    arguments: String::new(),
                                },
                            );
                            out.push(openai_responses_event(json!({
                                "type": "response.output_item.added",
                                "output_index": 0,
                                "item": {
                                    "id": id,
                                    "type": "function_call",
                                    "call_id": content_block.get("id").cloned().unwrap_or(Value::String("call".to_string())),
                                    "name": name,
                                    "arguments": ""
                                }
                            })));
                        }
                        Some("text") => {
                            out.push(openai_responses_event(json!({
                                "type": "response.output_item.added",
                                "output_index": 0,
                                "item": {
                                    "id": self.response_output_id,
                                    "type": "output_text",
                                    "index": index,
                                    "text": ""
                                }
                            })));
                        }
                        _ => {}
                    }
                }
            }
            "content_block_delta" => {
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let delta = event.get("delta").cloned().unwrap_or_else(|| json!({}));
                match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            self.responses_text.push_str(text);
                            out.push(openai_responses_event(json!({
                                "type": "response.output_item.content_part.delta",
                                "output_item_id": self.response_output_id,
                                "index": index,
                                "delta": {
                                    "type": "text_delta",
                                    "text": text
                                }
                            })));
                            out.push(openai_responses_event(json!({
                                "type": "response.output_text.delta",
                                "delta": text
                            })));
                        }
                    }
                    "input_json_delta" => {
                        let partial = delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        if let Some(tool) = self.anthropic_tools.get_mut(&index) {
                            tool.arguments.push_str(partial);
                            out.push(openai_responses_event(json!({
                                "type": "response.output_item.content_part.delta",
                                "output_item_id": tool.id,
                                "index": index,
                                "delta": {
                                    "type": "input_json_delta",
                                    "partial_json": partial
                                }
                            })));
                            out.push(openai_responses_event(json!({
                                "type": "response.function_call_arguments.delta",
                                "item_id": tool.id,
                                "delta": partial
                            })));
                        }
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                self.usage.update_from_anthropic(
                    event
                        .get("usage")
                        .or_else(|| event.get("delta").and_then(|value| value.get("usage"))),
                );
                if let Some(reason) = event
                    .get("delta")
                    .and_then(|value| value.get("stop_reason"))
                    .and_then(Value::as_str)
                {
                    self.stop_reason = Some(reason.to_string());
                }
            }
            "message_stop" => {
                out.extend(self.synthesize_finish());
            }
            _ => {}
        }
        out
    }

    fn synthesize_finish(&mut self) -> Vec<String> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;
        match self.mode {
            StreamMode::OpenAiChatToAnthropic => self.finish_anthropic(),
            StreamMode::OpenAiResponsesToAnthropic => self.finish_anthropic(),
            StreamMode::AnthropicToOpenAiChat => vec!["data: [DONE]\n\n".to_string()],
            StreamMode::AnthropicToOpenAiResponses => self.finish_openai_responses(),
        }
    }

    fn finish_anthropic(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        if !self.message_started {
            self.message_started = true;
            out.push(anthropic_event(
                "message_start",
                json!({
                    "type": "message_start",
                    "message": {
                        "id": self.message_id,
                        "type": "message",
                        "role": "assistant",
                        "model": self.model,
                        "content": [],
                        "stop_reason": Value::Null,
                        "stop_sequence": Value::Null,
                        "usage": { "input_tokens": 0, "output_tokens": 0 }
                    }
                }),
            ));
        }
        if self.text_block_started && !self.text_block_stopped {
            self.text_block_stopped = true;
            out.push(anthropic_event(
                "content_block_stop",
                json!({ "type": "content_block_stop", "index": 0 }),
            ));
        }
        for state in self.openai_tool_calls.values_mut() {
            if !state.stopped {
                state.stopped = true;
                out.push(anthropic_event(
                    "content_block_stop",
                    json!({ "type": "content_block_stop", "index": state.block_index }),
                ));
            }
        }
        out.push(anthropic_event(
            "message_delta",
            json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": resolve_anthropic_stop_reason(self.stop_reason.as_deref()),
                    "stop_sequence": Value::Null
                },
                "usage": {
                    "input_tokens": self.usage.input_tokens,
                    "output_tokens": self.usage.output_tokens,
                    "cache_read_input_tokens": self.usage.cached_tokens
                }
            }),
        ));
        out.push(anthropic_event(
            "message_stop",
            json!({ "type": "message_stop" }),
        ));
        out
    }

    fn finish_openai_responses(&mut self) -> Vec<String> {
        let mut tool_blocks = Vec::new();
        for tool in self.anthropic_tools.values() {
            let parsed_arguments = serde_json::from_str::<Value>(&tool.arguments)
                .unwrap_or_else(|_| Value::String(tool.arguments.clone()));
            tool_blocks.push(json!({
                "type": "tool_use",
                "id": tool.id,
                "name": tool.name,
                "input": parsed_arguments
            }));
        }

        let mut output_content = Vec::new();
        if !self.responses_text.is_empty() {
            output_content.push(json!({
                "type": "output_text",
                "text": self.responses_text
            }));
        }
        output_content.extend(tool_blocks);

        vec![
            openai_responses_event(json!({
                "type": "response.completed",
                "status": map_anthropic_stop_reason_to_openai_status(self.stop_reason.as_deref()),
                "status_code": 200,
                "stop_reason": self.stop_reason,
                "response": {
                    "id": self.response_id,
                    "object": "response",
                    "created": self.created,
                    "model": self.model,
                    "status": map_anthropic_stop_reason_to_openai_status(self.stop_reason.as_deref()),
                    "output": [{
                        "id": "out_1",
                        "type": "output_message",
                        "role": "assistant",
                        "content": output_content
                    }],
                    "usage": {
                        "input_tokens": self.usage.input_tokens,
                        "output_tokens": self.usage.output_tokens,
                        "total_tokens": self.usage.input_tokens + self.usage.output_tokens,
                        "prompt_tokens": self.usage.input_tokens,
                        "completion_tokens": self.usage.output_tokens,
                        "cached_tokens": self.usage.cached_tokens
                    }
                },
                "output_text": if self.responses_text.is_empty() {
                    Value::Null
                } else {
                    Value::String(self.responses_text.clone())
                }
            })),
            "data: [DONE]\n\n".to_string(),
        ]
    }
}

fn anthropic_event(event_name: &str, payload: Value) -> String {
    format!("event: {event_name}\ndata: {}\n\n", payload)
}

fn openai_chat_chunk(
    id: &str,
    created: i64,
    model: &str,
    delta: Value,
    finish_reason: Value,
    usage: Option<Value>,
) -> String {
    let mut payload = json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason
        }]
    });
    if let Some(usage) = usage {
        payload["usage"] = usage;
    }
    format!("data: {}\n\n", payload)
}

fn openai_responses_event(payload: Value) -> String {
    format!("data: {}\n\n", payload)
}

fn nanoid_like() -> String {
    format!(
        "{:x}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )
}

fn map_anthropic_stop_reason_to_openai_finish(reason: &str) -> &'static str {
    match reason {
        "tool_use" => "tool_calls",
        "max_tokens" => "length",
        _ => "stop",
    }
}

fn map_anthropic_stop_reason_to_openai_status(reason: Option<&str>) -> &'static str {
    match reason {
        Some("tool_use") => "requires_action",
        Some("max_tokens") | Some("stop_sequence") => "incomplete",
        _ => "completed",
    }
}

fn map_openai_finish_reason_to_anthropic(reason: Option<&str>) -> &'static str {
    match reason {
        Some("tool_calls") => "tool_use",
        Some("length") => "max_tokens",
        _ => "end_turn",
    }
}

fn resolve_anthropic_stop_reason(reason: Option<&str>) -> &'static str {
    match reason {
        Some("tool_use") => "tool_use",
        Some("max_tokens") => "max_tokens",
        Some("stop_sequence") => "stop_sequence",
        Some("end_turn") => "end_turn",
        other => map_openai_finish_reason_to_anthropic(other),
    }
}

fn map_openai_responses_stop_reason_to_anthropic(reason: &str) -> Option<&'static str> {
    match reason {
        "tool_use" | "tool_calls" => Some("tool_use"),
        "max_tokens" | "length" | "max_output_tokens" => Some("max_tokens"),
        "stop_sequence" => Some("stop_sequence"),
        "end_turn" | "stop" => Some("end_turn"),
        _ => None,
    }
}

fn infer_openai_responses_stop_reason(event: &Value) -> Option<&'static str> {
    let explicit_reason = event
        .get("stop_reason")
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("response")
                .and_then(|response| response.get("stop_reason"))
                .and_then(Value::as_str)
        });
    if let Some(reason) = explicit_reason {
        return map_openai_responses_stop_reason_to_anthropic(reason);
    }

    let status = event.get("status").and_then(Value::as_str).or_else(|| {
        event
            .get("response")
            .and_then(|response| response.get("status"))
            .and_then(Value::as_str)
    });
    match status {
        Some("requires_action") => Some("tool_use"),
        Some("incomplete") => Some("max_tokens"),
        Some("completed") => Some("end_turn"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{CrossProtocolStreamTransformer, SseStreamObserver};
    use crate::provider::ProviderProtocol;

    #[test]
    fn anthropic_observer_tracks_ttft_and_usage() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        let observation = observer.push(
            "event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":12,\"output_tokens\":3,\"cache_read_input_tokens\":2,\"cache_creation_input_tokens\":1}}\n\n",
        );

        assert!(observation.saw_first_token);
        let usage = observer.usage_stats();
        assert_eq!(usage.input_tokens, 12);
        assert_eq!(usage.output_tokens, 3);
        assert_eq!(usage.cache_read_tokens, 2);
        assert_eq!(usage.cache_creation_tokens, 1);
        assert_eq!(usage.cached_tokens, 3);
    }

    #[test]
    fn openai_responses_observer_tracks_output_text_and_usage() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        let observation = observer.push(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":4,\"input_tokens_details\":{\"cached_tokens\":3}}}}\n\n",
        );

        assert!(observation.saw_first_token);
        let usage = observer.usage_stats();
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 4);
        assert_eq!(usage.cache_read_tokens, 3);
        assert_eq!(usage.cache_creation_tokens, 0);
        assert_eq!(usage.cached_tokens, 3);
    }

    #[test]
    fn openai_responses_transformer_emits_anthropic_events() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        );
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_123\"}}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":4,\"cached_tokens\":2}}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("event: message_start"));
        assert!(joined.contains("\"id\":\"msg_123\""));
        assert!(joined.contains("event: content_block_start"));
        assert!(joined.contains("\"text\":\"hello\""));
        assert!(joined.contains("event: message_delta"));
        assert!(joined.contains("\"input_tokens\":10"));
        assert!(joined.contains("\"output_tokens\":4"));
        assert!(joined.contains("\"cache_read_input_tokens\":2"));
        assert!(joined.contains("event: message_stop"));
    }

    #[test]
    fn openai_responses_transformer_maps_requires_action_and_tool_output() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        );
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_tool\"}}\n\n\
             data: {\"type\":\"response.completed\",\"status\":\"requires_action\",\"response\":{\"id\":\"resp_tool\",\"status\":\"requires_action\",\"usage\":{\"input_tokens\":8,\"output_tokens\":1},\"output\":[{\"id\":\"out_1\",\"type\":\"output_message\",\"role\":\"assistant\",\"content\":[{\"type\":\"function_call\",\"id\":\"call_1\",\"call_id\":\"call_1\",\"name\":\"weather\",\"arguments\":\"{\\\"city\\\":\\\"Paris\\\"}\"}]}]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("event: content_block_start"));
        assert!(joined.contains("\"type\":\"tool_use\""));
        assert!(joined.contains("\"id\":\"call_1\""));
        assert!(joined.contains("\"name\":\"weather\""));
        assert!(joined.contains("\"partial_json\":\"{\\\"city\\\":\\\"Paris\\\"}\""));
        assert!(joined.contains("\"stop_reason\":\"tool_use\""));
        assert!(joined.contains("\"input_tokens\":8"));
        assert!(joined.contains("\"output_tokens\":1"));
    }

    #[test]
    fn openai_responses_transformer_maps_incomplete_to_max_tokens() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        );
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_incomplete\"}}\n\n\
             data: {\"type\":\"response.completed\",\"status\":\"incomplete\",\"response\":{\"id\":\"resp_incomplete\",\"status\":\"incomplete\",\"usage\":{\"input_tokens\":6,\"output_tokens\":3},\"output\":[{\"id\":\"out_1\",\"type\":\"output_message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"partial\"}]}]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"text\":\"partial\""));
        assert!(joined.contains("\"stop_reason\":\"max_tokens\""));
        assert!(joined.contains("\"input_tokens\":6"));
        assert!(joined.contains("\"output_tokens\":3"));
    }

    #[test]
    fn anthropic_to_openai_responses_emits_richer_stream_events() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiResponses,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        );
        let chunks = transformer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_123\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test-model\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":2,\"cache_read_input_tokens\":1}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"type\":\"response.created\""));
        assert!(joined.contains("\"type\":\"response.output_item.added\""));
        assert!(joined.contains("\"type\":\"response.output_item.content_part.delta\""));
        assert!(joined.contains("\"type\":\"response.output_text.delta\""));
        assert!(joined.contains("\"type\":\"response.completed\""));
        assert!(joined.contains("\"output_text\":\"hello\""));
        assert!(joined.contains("\"cached_tokens\":1"));
    }

    #[test]
    fn anthropic_to_openai_responses_tool_use_emits_requires_action_status() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiResponses,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        );
        let chunks = transformer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_tool\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test-model\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"weather\",\"input\":{}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"city\\\":\\\"Paris\\\"}\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"input_tokens\":9,\"output_tokens\":2}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"type\":\"response.function_call_arguments.delta\""));
        assert!(joined.contains("\"item_id\":\"tool_1\""));
        assert!(joined.contains("\"status\":\"requires_action\""));
        assert!(joined.contains("\"type\":\"tool_use\""));
        assert!(joined.contains("\"name\":\"weather\""));
    }
}
