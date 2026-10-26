use std::collections::{BTreeMap, HashSet};

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
    anthropic_input_tokens: i64,
    /// Whether any usage object carrying at least one known token field was
    /// seen. Distinguishes "upstream reported zero tokens" from "upstream
    /// never reported usage" so the proxy can store NULL instead of 0.
    usage_seen: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct NormalizedUsage {
    anthropic_input_tokens: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
}

fn resolve_usage_payload(payload: &Value) -> &Value {
    payload
        .get("usage")
        .or_else(|| payload.get("response").and_then(|value| value.get("usage")))
        .or_else(|| payload.get("message").and_then(|value| value.get("usage")))
        .unwrap_or(payload)
}

fn normalize_usage(usage: &Value) -> NormalizedUsage {
    let raw_input_tokens = usage
        .get("input_tokens")
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .or_else(|| usage.get("completion_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_read_tokens = usage
        .get("cache_read_input_tokens")
        .or_else(|| usage.get("cache_read_tokens"))
        .or_else(|| usage.get("cached_tokens"))
        .or_else(|| {
            usage
                .get("prompt_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
        })
        .or_else(|| {
            usage
                .get("input_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
        })
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_creation_tokens = usage
        .get("cache_creation_input_tokens")
        .or_else(|| usage.get("cache_creation_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let has_anthropic_cache_fields = usage.get("cache_read_input_tokens").is_some()
        || usage.get("cache_creation_input_tokens").is_some();
    let has_openai_usage_markers = usage.get("prompt_tokens").is_some()
        || usage.get("completion_tokens").is_some()
        || usage.get("cached_tokens").is_some()
        || usage.get("cache_read_tokens").is_some()
        || usage.get("cache_creation_tokens").is_some()
        || usage.get("prompt_tokens_details").is_some()
        || usage.get("input_tokens_details").is_some();
    let input_tokens = if has_anthropic_cache_fields && !has_openai_usage_markers {
        raw_input_tokens + cache_read_tokens + cache_creation_tokens
    } else {
        raw_input_tokens
    };
    let anthropic_input_tokens = input_tokens
        .saturating_sub(cache_read_tokens)
        .saturating_sub(cache_creation_tokens);

    NormalizedUsage {
        anthropic_input_tokens,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
    }
}

/// True when the value looks like a usage object with at least one known
/// token field (either dialect). Guards the "no usage reported" distinction.
fn usage_object_has_token_fields(usage: &Value) -> bool {
    [
        "input_tokens",
        "prompt_tokens",
        "output_tokens",
        "completion_tokens",
        "cache_read_input_tokens",
        "cache_read_tokens",
        "cached_tokens",
        "cache_creation_input_tokens",
        "cache_creation_tokens",
        "prompt_tokens_details",
        "input_tokens_details",
    ]
    .into_iter()
    .any(|field| usage.get(field).is_some())
}

pub fn usage_stats_from_payload(payload: &Value) -> UsageStats {
    let normalized = normalize_usage(resolve_usage_payload(payload));
    UsageStats {
        input_tokens: normalized.input_tokens,
        output_tokens: normalized.output_tokens,
        cached_tokens: normalized.cache_read_tokens,
        cache_read_tokens: normalized.cache_read_tokens,
        cache_creation_tokens: normalized.cache_creation_tokens,
    }
}

/// Like [`usage_stats_from_payload`], but returns `None` when the payload
/// carries no recognizable usage fields — the caller can then persist NULL
/// tokens instead of misleading zeros.
pub fn usage_stats_option_from_payload(payload: &Value) -> Option<UsageStats> {
    let resolved = resolve_usage_payload(payload);
    if !usage_object_has_token_fields(resolved) {
        return None;
    }
    Some(usage_stats_from_payload(payload))
}

impl UsageState {
    fn update_from_openai(&mut self, usage: Option<&Value>) {
        let Some(usage) = usage else { return };
        let normalized = normalize_usage(usage);
        self.usage_seen = self.usage_seen || usage_object_has_token_fields(usage);
        self.input_tokens = normalized.input_tokens;
        self.output_tokens = normalized.output_tokens;
        self.cache_read_tokens = normalized.cache_read_tokens;
        self.cache_creation_tokens = normalized.cache_creation_tokens;
        self.cached_tokens = normalized.cache_read_tokens;
        self.anthropic_input_tokens = normalized.anthropic_input_tokens;
    }

    fn update_from_anthropic(&mut self, usage: Option<&Value>) {
        let Some(usage) = usage else { return };
        self.usage_seen = self.usage_seen || usage_object_has_token_fields(usage);
        if let Some(value) = usage.get("input_tokens").and_then(Value::as_i64) {
            self.anthropic_input_tokens = value;
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
        self.input_tokens =
            self.anthropic_input_tokens + self.cache_read_tokens + self.cache_creation_tokens;
        self.cached_tokens = self.cache_read_tokens;
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

    fn anthropic_usage_value(&self) -> Value {
        let mut usage = json!({
            "input_tokens": self.anthropic_input_tokens,
            "output_tokens": self.output_tokens
        });
        if let Some(map) = usage.as_object_mut() {
            if self.cache_read_tokens > 0 {
                map.insert(
                    "cache_read_input_tokens".to_string(),
                    Value::from(self.cache_read_tokens),
                );
            }
            if self.cache_creation_tokens > 0 {
                map.insert(
                    "cache_creation_input_tokens".to_string(),
                    Value::from(self.cache_creation_tokens),
                );
            }
        }
        usage
    }

    fn openai_usage_value(&self) -> Value {
        let mut usage = json!({
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
            "prompt_tokens": self.input_tokens,
            "completion_tokens": self.output_tokens,
            "cached_tokens": self.cached_tokens
        });
        if self.cached_tokens > 0 {
            usage["prompt_tokens_details"] = json!({ "cached_tokens": self.cached_tokens });
        }
        usage
    }

    fn openai_responses_usage_value(&self) -> Value {
        let mut usage = json!({
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
            "prompt_tokens": self.input_tokens,
            "completion_tokens": self.output_tokens,
            "cached_tokens": self.cached_tokens
        });
        if self.cached_tokens > 0 {
            usage["input_tokens_details"] = json!({ "cached_tokens": self.cached_tokens });
        }
        usage
    }
}

#[derive(Debug, Clone, Default)]
pub struct StreamObservation {
    pub saw_first_token: bool,
    pub saw_terminal_event: bool,
    pub saw_error_event: bool,
}

/// Incremental UTF-8 decoder for raw response-body chunks: keeps an
/// incomplete multi-byte suffix buffered across chunk boundaries so characters
/// split by the transport reassemble, instead of each half being lossy-decoded
/// into U+FFFD replacement characters. Genuinely invalid sequences still
/// degrade to U+FFFD, matching `String::from_utf8_lossy` semantics.
#[derive(Debug, Default)]
pub struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Decode one raw chunk; a trailing incomplete multi-byte sequence is
    /// buffered until the next chunk completes it (may return an empty string).
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    return out;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        let head = std::str::from_utf8(&self.pending[..valid_up_to])
                            .expect("from_utf8 reported this prefix as valid");
                        out.push_str(head);
                        self.pending.drain(..valid_up_to);
                    }
                    match error.error_len() {
                        // Incomplete multi-byte tail: wait for the next chunk.
                        None => return out,
                        // Hard-invalid sequence: degrade it to one U+FFFD and
                        // keep decoding the rest of the chunk.
                        Some(invalid_len) => {
                            self.pending.drain(..invalid_len);
                            out.push('\u{FFFD}');
                        }
                    }
                }
            }
        }
    }

    /// Drain whatever is left at end of stream (an EOF mid-character is a
    /// malformed upstream; degrade the remainder instead of dropping it).
    pub fn flush(&mut self) -> String {
        let remaining = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        remaining
    }
}

/// Whether a streamed delta field actually carries output. Providers commonly
/// open a stream with a role chunk (`content: ""` or `content: null`) and some
/// send an empty `tool_calls: []` before the real tool call; treating those as
/// the first token would understate TTFT.
fn json_string_or(value: Option<&Value>, fallback: &str) -> Value {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|value| Value::String(value.to_string()))
        .unwrap_or_else(|| Value::String(fallback.to_string()))
}

fn delta_has_output(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::Object(map)) => !map.is_empty(),
        _ => false,
    }
}

#[derive(Debug, Clone)]
pub struct SseStreamObserver {
    protocol: ProviderProtocol,
    buffer: String,
    usage: UsageState,
    first_content_seen: bool,
    terminal_event_seen: bool,
    error_event: Option<Value>,
}

impl SseStreamObserver {
    pub fn new(protocol: ProviderProtocol) -> Self {
        Self {
            protocol,
            buffer: String::new(),
            usage: UsageState::default(),
            first_content_seen: false,
            terminal_event_seen: false,
            error_event: None,
        }
    }

    pub fn push(&mut self, chunk: &str) -> StreamObservation {
        self.buffer.push_str(chunk);
        let mut observation = StreamObservation::default();

        while let Some((boundary, separator_len)) = next_sse_event_boundary(&self.buffer) {
            let raw_event = self.buffer[..boundary].to_string();
            self.buffer = self.buffer[boundary + separator_len..].to_string();
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

    /// Whether any usage event was observed on the stream.
    pub fn observed_usage(&self) -> bool {
        self.usage.usage_seen
    }

    /// Observed usage, or `None` when the upstream never reported usage —
    /// lets the proxy persist NULL tokens instead of misleading zeros.
    pub fn observed_usage_stats(&self) -> Option<UsageStats> {
        self.usage.usage_seen.then(|| self.usage.to_usage_stats())
    }

    pub fn is_complete(&self) -> bool {
        self.terminal_event_seen
    }

    /// The last upstream SSE error event observed on this stream, if any
    /// (Anthropic `event: error`, OpenAI top-level `error` object, Responses
    /// `error` / `response.failed` types). Lets the proxy record the request
    /// as failed instead of a clean-success stream that silently lost the
    /// upstream error.
    pub fn error_event(&self) -> Option<&Value> {
        self.error_event.as_ref()
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
        if data.is_empty() {
            return;
        }
        if data == "[DONE]" {
            self.mark_terminal(observation);
            return;
        }

        let Ok(event) = serde_json::from_str::<Value>(&data) else {
            return;
        };

        if !self.first_content_seen && self.detect_content(&event) {
            self.first_content_seen = true;
            observation.saw_first_token = true;
        }

        if self.detect_terminal_event(&event) {
            self.mark_terminal(observation);
        }

        if self.detect_error_event(&event) {
            self.error_event = Some(event.clone());
            observation.saw_error_event = true;
        }

        match self.protocol {
            ProviderProtocol::AnthropicMessages => {
                self.usage.update_from_anthropic(
                    event
                        .get("usage")
                        .or_else(|| event.get("delta").and_then(|value| value.get("usage")))
                        .or_else(|| event.get("message").and_then(|value| value.get("usage"))),
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

    fn mark_terminal(&mut self, observation: &mut StreamObservation) {
        self.terminal_event_seen = true;
        observation.saw_terminal_event = true;
    }

    fn detect_terminal_event(&self, event: &Value) -> bool {
        match self.protocol {
            ProviderProtocol::AnthropicMessages => {
                event.get("type").and_then(Value::as_str) == Some("message_stop")
            }
            ProviderProtocol::OpenAiChatCompletions => event
                .get("choices")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|choice| {
                    !choice
                        .get("finish_reason")
                        .unwrap_or(&Value::Null)
                        .is_null()
                }),
            ProviderProtocol::OpenAiResponses => matches!(
                event.get("type").and_then(Value::as_str),
                Some("response.completed") | Some("response.done") | Some("response.incomplete")
            ),
        }
    }

    fn detect_error_event(&self, event: &Value) -> bool {
        match self.protocol {
            ProviderProtocol::AnthropicMessages => {
                event.get("type").and_then(Value::as_str) == Some("error")
            }
            // OpenAI-compatible upstreams surface mid-stream failures as a
            // top-level `error` object (normal chunks never carry one).
            ProviderProtocol::OpenAiChatCompletions => event.get("error").is_some(),
            ProviderProtocol::OpenAiResponses => matches!(
                event.get("type").and_then(Value::as_str),
                Some("error") | Some("response.failed")
            ),
        }
    }

    fn detect_content(&self, event: &Value) -> bool {
        match self.protocol {
            ProviderProtocol::AnthropicMessages => {
                match event.get("type").and_then(Value::as_str) {
                    Some("content_block_start") => {
                        let content_block = event.get("content_block");
                        match content_block
                            .and_then(|content_block| content_block.get("type"))
                            .and_then(Value::as_str)
                        {
                            // A tool block start already carries the tool name.
                            Some("tool_use") => true,
                            // Thinking block starts are often empty placeholders;
                            // only count one that already carries output text.
                            Some("thinking") => delta_has_output(
                                content_block.and_then(|block| block.get("thinking")),
                            ),
                            // Redacted thinking arrives as an opaque payload.
                            Some("redacted_thinking") => {
                                delta_has_output(content_block.and_then(|block| block.get("data")))
                            }
                            _ => false,
                        }
                    }
                    Some("content_block_delta") => {
                        let delta = event.get("delta");
                        match delta
                            .and_then(|delta| delta.get("type"))
                            .and_then(Value::as_str)
                        {
                            Some("text_delta") => {
                                delta_has_output(delta.and_then(|delta| delta.get("text")))
                            }
                            Some("thinking_delta") => {
                                delta_has_output(delta.and_then(|delta| delta.get("thinking")))
                            }
                            Some("input_json_delta") => {
                                delta_has_output(delta.and_then(|delta| delta.get("partial_json")))
                            }
                            _ => false,
                        }
                    }
                    _ => false,
                }
            }
            ProviderProtocol::OpenAiChatCompletions => event
                .get("choices")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|choice| choice.get("delta"))
                .any(|delta| {
                    delta_has_output(delta.get("content"))
                        || delta_has_output(delta.get("reasoning_content"))
                        || delta_has_output(delta.get("reasoning"))
                        || delta_has_output(delta.get("refusal"))
                        || delta_has_output(delta.get("tool_calls"))
                        || delta
                            .get("function_call")
                            .is_some_and(|call| !call.is_null())
                }),
            ProviderProtocol::OpenAiResponses => match event.get("type").and_then(Value::as_str) {
                Some("response.output_text.delta")
                | Some("response.content_part.delta")
                | Some("response.output_item.content_part.delta")
                | Some("response.function_call_arguments.delta")
                | Some("response.reasoning_summary_text.delta")
                | Some("response.reasoning_text.delta")
                | Some("response.refusal.delta") => delta_has_output(event.get("delta")),
                // The item announcement carries the tool name before any
                // argument delta; a plain text/message item is still empty here.
                Some("response.output_item.added") => matches!(
                    event
                        .get("item")
                        .and_then(|item| item.get("type"))
                        .and_then(Value::as_str),
                    Some("function_call") | Some("tool_use")
                ),
                _ => false,
            },
        }
    }
}

fn responses_item_key(item_id: Option<&str>, output_index: Option<u64>) -> String {
    item_id
        .filter(|item_id| !item_id.is_empty())
        .map(ToString::to_string)
        .or_else(|| output_index.map(|index| format!("idx:{index}")))
        .unwrap_or_else(|| "idx:0".to_string())
}

fn extract_openai_responses_output_text(block: &Value) -> Option<String> {
    block
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| block.get("refusal").and_then(Value::as_str))
        .or_else(|| {
            block
                .get("content")
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(|part| part.get("text"))
                .and_then(Value::as_str)
        })
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn extract_openai_reasoning_text(block: &Value) -> Option<String> {
    let mut parts = Vec::new();
    for item in block
        .get("summary")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(text) = item
            .get("text")
            .or_else(|| item.get("content"))
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
        {
            parts.push(text.to_string());
        }
    }
    for item in block
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(text) = item
            .get("text")
            .or_else(|| item.get("content"))
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
        {
            parts.push(text.to_string());
        }
    }
    if parts.is_empty() {
        block
            .get("reasoning_content")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .map(ToString::to_string)
    } else {
        Some(parts.join("\n"))
    }
}

fn build_openai_reasoning_output_item(id: &str, reasoning: &str) -> Value {
    json!({
        "id": id,
        "type": "reasoning",
        "status": "completed",
        "summary": [{
            "type": "summary_text",
            "text": reasoning
        }]
    })
}

fn build_openai_responses_message_item(item_id: &str, text: &str) -> Value {
    json!({
        "id": item_id,
        "type": "message",
        "status": "completed",
        "role": "assistant",
        "content": [{
            "type": "output_text",
            "text": text,
            "annotations": []
        }]
    })
}

fn build_openai_responses_function_call_item(call_id: &str, name: &str, arguments: &str) -> Value {
    json!({
        "id": call_id,
        "type": "function_call",
        "status": "completed",
        "call_id": call_id,
        "name": name,
        "arguments": arguments
    })
}

#[derive(Debug, Clone)]
struct OpenAiToolState {
    id: String,
    name: String,
    arguments: String,
    block_index: usize,
    started: bool,
    stopped: bool,
}

#[derive(Debug, Clone)]
struct AnthropicToolState {
    id: String,
    name: String,
    arguments: String,
    /// Position in the Responses `output` array. Only used when converting
    /// Anthropic streams into the OpenAI Responses protocol.
    output_index: Option<usize>,
    done: bool,
}

/// One Anthropic `text` block converted into its own Responses message item.
#[derive(Debug, Clone)]
struct ResponsesTextItem {
    id: String,
    output_index: usize,
    text: String,
    done: bool,
}

/// One Anthropic thinking block converted into its own Responses reasoning item.
#[derive(Debug, Clone)]
struct ResponsesReasoningItem {
    id: String,
    output_index: usize,
    text: String,
    done: bool,
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
    text_block_index: Option<usize>,
    reasoning_block_started: bool,
    reasoning_block_stopped: bool,
    reasoning_block_index: Option<usize>,
    /// Monotonic Anthropic content-block index allocator. Indices must stay
    /// unique for the whole message even after a block stops, so a closed
    /// block's index is never reused.
    anthropic_next_block_index: usize,
    /// Responses item owning the currently open text/reasoning block.
    responses_text_item_id: Option<String>,
    responses_reasoning_item_id: Option<String>,
    /// Responses items whose content was already forwarded. Keys are the item
    /// id and `idx:<output_index>`, so done/terminal events can dedupe even
    /// when one side omits an id.
    responses_streamed_text_items: HashSet<String>,
    responses_seen_reasoning_items: HashSet<String>,
    /// Whether any visible text/tool output was emitted. Suppressed reasoning
    /// must not be promoted to text after a block has already been closed.
    saw_visible_output: bool,
    usage: UsageState,
    stop_reason: Option<String>,
    openai_tool_calls: BTreeMap<usize, OpenAiToolState>,
    anthropic_tools: BTreeMap<usize, AnthropicToolState>,
    responses_tool_names: BTreeMap<String, String>,
    responses_text: String,
    responses_reasoning_content: String,
    /// Output-array indices allocated while streaming Anthropic content into
    /// OpenAI Responses items, in announcement order.
    responses_next_output_index: usize,
    /// Per-Anthropic-block Responses items. A message may contain several
    /// text or thinking blocks; each becomes its own output item.
    responses_text_items: BTreeMap<usize, ResponsesTextItem>,
    responses_reasoning_items: BTreeMap<usize, ResponsesReasoningItem>,
    /// Whether a refusal was streamed or seen in the terminal output, so the
    /// Anthropic stop reason can be `refusal` instead of `end_turn`.
    saw_refusal: bool,
    emit_anthropic_reasoning: bool,
    allow_anthropic_reasoning_fallback: bool,
    suppressed_anthropic_reasoning: String,
    finished: bool,
}

impl CrossProtocolStreamTransformer {
    pub fn new(
        request_protocol: ProviderProtocol,
        target_protocol: ProviderProtocol,
        model: impl Into<String>,
    ) -> Result<Self, &'static str> {
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
            _ => return Err("unsupported streaming cross-protocol conversion"),
        };

        let created = chrono::Utc::now().timestamp();
        Ok(Self {
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
            text_block_index: None,
            reasoning_block_started: false,
            reasoning_block_stopped: false,
            reasoning_block_index: None,
            anthropic_next_block_index: 0,
            responses_text_item_id: None,
            responses_reasoning_item_id: None,
            responses_streamed_text_items: HashSet::new(),
            responses_seen_reasoning_items: HashSet::new(),
            saw_visible_output: false,
            usage: UsageState::default(),
            stop_reason: None,
            openai_tool_calls: BTreeMap::new(),
            anthropic_tools: BTreeMap::new(),
            responses_tool_names: BTreeMap::new(),
            responses_text: String::new(),
            responses_reasoning_content: String::new(),
            responses_next_output_index: 0,
            responses_text_items: BTreeMap::new(),
            responses_reasoning_items: BTreeMap::new(),
            saw_refusal: false,
            emit_anthropic_reasoning: true,
            allow_anthropic_reasoning_fallback: true,
            suppressed_anthropic_reasoning: String::new(),
            finished: false,
        })
    }

    pub fn with_anthropic_reasoning(mut self, emit: bool) -> Self {
        self.emit_anthropic_reasoning = emit;
        self
    }

    pub fn with_anthropic_reasoning_fallback(mut self, allow: bool) -> Self {
        self.allow_anthropic_reasoning_fallback = allow;
        self
    }

    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buffer.push_str(chunk);
        let mut out = Vec::new();

        while let Some((boundary, separator_len)) = next_sse_event_boundary(&self.buffer) {
            let raw_event = self.buffer[..boundary].to_string();
            self.buffer = self.buffer[boundary + separator_len..].to_string();
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

    fn allocate_anthropic_block_index(&mut self) -> usize {
        let index = self.anthropic_next_block_index;
        self.anthropic_next_block_index += 1;
        index
    }

    fn anthropic_tool_chat_index(&self, block_index: usize) -> usize {
        self.anthropic_tools
            .keys()
            .position(|key| *key == block_index)
            .unwrap_or(0)
    }

    fn close_text_block(&mut self, out: &mut Vec<String>) {
        if self.text_block_started {
            if let Some(index) = self.text_block_index {
                if !self.text_block_stopped {
                    out.push(anthropic_event(
                        "content_block_stop",
                        json!({ "type": "content_block_stop", "index": index }),
                    ));
                }
            }
        }
        self.text_block_started = false;
        self.text_block_stopped = true;
        self.text_block_index = None;
        self.responses_text_item_id = None;
    }

    fn close_reasoning_block(&mut self, out: &mut Vec<String>) {
        if self.reasoning_block_started {
            if let Some(index) = self.reasoning_block_index {
                if !self.reasoning_block_stopped {
                    out.push(anthropic_event(
                        "content_block_stop",
                        json!({ "type": "content_block_stop", "index": index }),
                    ));
                }
            }
        }
        self.reasoning_block_started = false;
        self.reasoning_block_stopped = true;
        self.reasoning_block_index = None;
        self.responses_reasoning_item_id = None;
    }

    fn close_openai_tool_block(&mut self, index: usize, out: &mut Vec<String>) {
        if let Some(state) = self.openai_tool_calls.get_mut(&index) {
            if state.started && !state.stopped {
                state.stopped = true;
                out.push(anthropic_event(
                    "content_block_stop",
                    json!({ "type": "content_block_stop", "index": state.block_index }),
                ));
            }
        }
    }

    fn close_active_openai_tool_block(&mut self, out: &mut Vec<String>) {
        let active = self
            .openai_tool_calls
            .iter()
            .find_map(|(index, state)| (state.started && !state.stopped).then_some(*index));
        if let Some(index) = active {
            self.close_openai_tool_block(index, out);
        }
    }

    fn mark_responses_text_item(&mut self, item_id: Option<&str>, output_index: Option<u64>) {
        if let Some(id) = item_id.filter(|id| !id.is_empty()) {
            self.responses_streamed_text_items.insert(id.to_string());
        } else if output_index.is_none() {
            self.responses_streamed_text_items
                .insert("idx:0".to_string());
        }
        if let Some(index) = output_index {
            self.responses_streamed_text_items
                .insert(format!("idx:{index}"));
        }
    }

    fn mark_responses_reasoning_item(&mut self, item_id: Option<&str>, output_index: Option<u64>) {
        if let Some(id) = item_id.filter(|id| !id.is_empty()) {
            self.responses_seen_reasoning_items.insert(id.to_string());
        } else if output_index.is_none() {
            self.responses_seen_reasoning_items
                .insert("idx:0".to_string());
        }
        if let Some(index) = output_index {
            self.responses_seen_reasoning_items
                .insert(format!("idx:{index}"));
        }
    }

    fn responses_text_item_seen(&self, item_id: Option<&str>, output_index: Option<u64>) -> bool {
        let has_id = item_id.filter(|id| !id.is_empty());
        let by_id = has_id.is_some_and(|id| self.responses_streamed_text_items.contains(id));
        let by_index = match output_index {
            Some(index) => self
                .responses_streamed_text_items
                .contains(&format!("idx:{index}")),
            None => has_id.is_none() && self.responses_streamed_text_items.contains("idx:0"),
        };
        by_id || by_index
    }

    fn responses_reasoning_item_seen(
        &self,
        item_id: Option<&str>,
        output_index: Option<u64>,
    ) -> bool {
        let has_id = item_id.filter(|id| !id.is_empty());
        let by_id = has_id.is_some_and(|id| self.responses_seen_reasoning_items.contains(id));
        let by_index = match output_index {
            Some(index) => self
                .responses_seen_reasoning_items
                .contains(&format!("idx:{index}")),
            None => has_id.is_none() && self.responses_seen_reasoning_items.contains("idx:0"),
        };
        by_id || by_index
    }

    fn start_responses_text_block(&mut self, key: &str, out: &mut Vec<String>) -> usize {
        if self.text_block_started && self.responses_text_item_id.as_deref() == Some(key) {
            return self.text_block_index.unwrap_or(0);
        }
        self.close_text_block(out);
        self.close_reasoning_block(out);
        self.close_active_openai_tool_block(out);
        let index = self.allocate_anthropic_block_index();
        self.text_block_started = true;
        self.text_block_stopped = false;
        self.text_block_index = Some(index);
        self.responses_text_item_id = Some(key.to_string());
        self.saw_visible_output = true;
        out.push(anthropic_event(
            "content_block_start",
            json!({
                "type": "content_block_start",
                "index": index,
                "content_block": { "type": "text", "text": "" }
            }),
        ));
        index
    }

    fn start_responses_reasoning_block(&mut self, key: &str, out: &mut Vec<String>) -> usize {
        if self.reasoning_block_started && self.responses_reasoning_item_id.as_deref() == Some(key)
        {
            return self.reasoning_block_index.unwrap_or(0);
        }
        self.close_reasoning_block(out);
        self.close_text_block(out);
        self.close_active_openai_tool_block(out);
        let index = self.allocate_anthropic_block_index();
        self.reasoning_block_started = true;
        self.reasoning_block_stopped = false;
        self.reasoning_block_index = Some(index);
        self.responses_reasoning_item_id = Some(key.to_string());
        out.push(anthropic_event(
            "content_block_start",
            json!({
                "type": "content_block_start",
                "index": index,
                "content_block": { "type": "thinking", "thinking": "" }
            }),
        ));
        index
    }

    fn start_responses_tool_block(
        &mut self,
        item_id: &str,
        name: &str,
        out: &mut Vec<String>,
    ) -> (usize, usize) {
        if let Some((index, state)) = self
            .openai_tool_calls
            .iter()
            .find(|(_, state)| state.id == item_id)
        {
            return (*index, state.block_index);
        }
        self.close_text_block(out);
        self.close_reasoning_block(out);
        self.close_active_openai_tool_block(out);
        let map_index = self
            .openai_tool_calls
            .keys()
            .max()
            .map_or(0, |index| index.saturating_add(1));
        let block_index = self.allocate_anthropic_block_index();
        self.openai_tool_calls.insert(
            map_index,
            OpenAiToolState {
                id: item_id.to_string(),
                name: name.to_string(),
                arguments: String::new(),
                block_index,
                started: true,
                stopped: false,
            },
        );
        self.saw_visible_output = true;
        out.push(anthropic_event(
            "content_block_start",
            json!({
                "type": "content_block_start",
                "index": block_index,
                "content_block": {
                    "type": "tool_use",
                    "id": item_id,
                    "name": name,
                    "input": {}
                }
            }),
        ));
        (map_index, block_index)
    }

    fn close_responses_tool_block(&mut self, item_id: &str, out: &mut Vec<String>) {
        let index = self
            .openai_tool_calls
            .iter()
            .find_map(|(index, state)| (state.id == item_id).then_some(*index));
        if let Some(index) = index {
            self.close_openai_tool_block(index, out);
        }
    }

    fn responses_tool_block_seen(&self, item_id: &str) -> bool {
        self.openai_tool_calls
            .values()
            .any(|state| state.id == item_id)
    }

    fn ensure_text_block_started(&mut self, out: &mut Vec<String>) -> usize {
        if !self.text_block_started {
            self.close_reasoning_block(out);
            self.close_active_openai_tool_block(out);
            self.text_block_started = true;
            self.text_block_stopped = false;
            let index = self.allocate_anthropic_block_index();
            self.text_block_index = Some(index);
            self.saw_visible_output = true;
            out.push(anthropic_event(
                "content_block_start",
                json!({
                    "type": "content_block_start",
                    "index": index,
                    "content_block": { "type": "text", "text": "" }
                }),
            ));
        }
        self.text_block_index.unwrap_or(0)
    }

    fn ensure_reasoning_block_started(&mut self, out: &mut Vec<String>) -> usize {
        if !self.reasoning_block_started {
            self.close_text_block(out);
            self.close_active_openai_tool_block(out);
            self.reasoning_block_started = true;
            self.reasoning_block_stopped = false;
            let index = self.allocate_anthropic_block_index();
            self.reasoning_block_index = Some(index);
            out.push(anthropic_event(
                "content_block_start",
                json!({
                    "type": "content_block_start",
                    "index": index,
                    "content_block": { "type": "thinking", "thinking": "" }
                }),
            ));
        }
        self.reasoning_block_index.unwrap_or(0)
    }

    fn allocate_responses_output_index(&mut self) -> usize {
        let index = self.responses_next_output_index;
        self.responses_next_output_index += 1;
        index
    }

    /// Open the Responses message item carrying one Anthropic text block.
    /// `response.output_item.added` must announce an item of type `message`
    /// (not `output_text`), followed by an empty `output_text` content part.
    fn ensure_openai_responses_text_item(
        &mut self,
        block_index: usize,
        out: &mut Vec<String>,
    ) -> (usize, String) {
        if let Some(item) = self.responses_text_items.get(&block_index) {
            return (item.output_index, item.id.clone());
        }
        let output_index = self.allocate_responses_output_index();
        let item_id = if self.responses_text_items.is_empty() {
            self.response_output_id.clone()
        } else {
            format!("{}_{block_index}", self.response_output_id)
        };
        self.responses_text_items.insert(
            block_index,
            ResponsesTextItem {
                id: item_id.clone(),
                output_index,
                text: String::new(),
                done: false,
            },
        );
        out.push(openai_responses_event(json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": {
                "id": item_id,
                "type": "message",
                "status": "in_progress",
                "role": "assistant",
                "content": []
            }
        })));
        out.push(openai_responses_event(json!({
            "type": "response.content_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": "", "annotations": [] }
        })));
        (output_index, item_id)
    }

    fn close_openai_responses_text_item(&mut self, block_index: usize, out: &mut Vec<String>) {
        let Some(item) = self.responses_text_items.get_mut(&block_index) else {
            return;
        };
        if item.done {
            return;
        }
        item.done = true;
        let output_index = item.output_index;
        let item_id = item.id.clone();
        let text = item.text.clone();
        out.push(openai_responses_event(json!({
            "type": "response.output_text.done",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "text": text
        })));
        out.push(openai_responses_event(json!({
            "type": "response.content_part.done",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": text, "annotations": [] }
        })));
        out.push(openai_responses_event(json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": build_openai_responses_message_item(&item_id, &text)
        })));
    }

    fn ensure_openai_responses_reasoning_item(
        &mut self,
        block_index: usize,
        out: &mut Vec<String>,
    ) -> (usize, String) {
        if let Some(item) = self.responses_reasoning_items.get(&block_index) {
            return (item.output_index, item.id.clone());
        }
        let output_index = self.allocate_responses_output_index();
        let item_id = if self.responses_reasoning_items.is_empty() {
            format!("rs_{}", nanoid_like())
        } else {
            format!("rs_{}_{block_index}", nanoid_like())
        };
        self.responses_reasoning_items.insert(
            block_index,
            ResponsesReasoningItem {
                id: item_id.clone(),
                output_index,
                text: String::new(),
                done: false,
            },
        );
        out.push(openai_responses_event(json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": {
                "id": item_id,
                "type": "reasoning",
                "status": "in_progress",
                "summary": []
            }
        })));
        out.push(openai_responses_event(json!({
            "type": "response.reasoning_summary_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": "" }
        })));
        (output_index, item_id)
    }

    fn close_openai_responses_reasoning_item(&mut self, block_index: usize, out: &mut Vec<String>) {
        let Some(item) = self.responses_reasoning_items.get_mut(&block_index) else {
            return;
        };
        if item.done {
            return;
        }
        item.done = true;
        let output_index = item.output_index;
        let item_id = item.id.clone();
        let text = item.text.clone();
        out.push(openai_responses_event(json!({
            "type": "response.reasoning_summary_text.done",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "text": text
        })));
        out.push(openai_responses_event(json!({
            "type": "response.reasoning_summary_part.done",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": text }
        })));
        out.push(openai_responses_event(json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": build_openai_reasoning_output_item(&item_id, &text)
        })));
    }

    /// Close one Anthropic tool_use block as a Responses `function_call` item.
    fn close_anthropic_tool_item(&mut self, block_index: usize, out: &mut Vec<String>) {
        let Some(tool) = self.anthropic_tools.get_mut(&block_index) else {
            return;
        };
        if tool.done {
            return;
        }
        tool.done = true;
        let Some(output_index) = tool.output_index else {
            return;
        };
        let item_id = tool.id.clone();
        let name = tool.name.clone();
        let arguments = tool.arguments.clone();
        out.push(openai_responses_event(json!({
            "type": "response.function_call_arguments.done",
            "item_id": item_id,
            "output_index": output_index,
            "arguments": arguments
        })));
        out.push(openai_responses_event(json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": build_openai_responses_function_call_item(&item_id, &name, &arguments)
        })));
    }

    fn openai_chat_to_anthropic(&mut self, event: Value) -> Vec<String> {
        let mut out = Vec::new();
        // Some OpenAI-compatible upstreams (e.g. GLM) nest the usage in
        // choices[0].delta.usage instead of the chunk top level; read both
        // so the client-visible message_delta carries real token counts.
        self.usage
            .update_from_openai(event.get("usage").or_else(|| {
                event
                    .get("choices")
                    .and_then(Value::as_array)
                    .and_then(|choices| choices.first())
                    .and_then(|choice| choice.get("delta"))
                    .and_then(|delta| delta.get("usage"))
            }));
        let choice = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .cloned()
            .unwrap_or_else(|| json!({}));
        let delta = choice.get("delta").cloned().unwrap_or_else(|| json!({}));

        if !self.message_started
            && (delta.get("content").is_some()
                || (self.emit_anthropic_reasoning && delta.get("reasoning_content").is_some())
                || delta_has_output(delta.get("reasoning"))
                || delta_has_output(delta.get("refusal"))
                || delta.get("tool_calls").is_some()
                || delta
                    .get("function_call")
                    .is_some_and(|call| !call.is_null())
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

        if let Some(text) = delta
            .get("content")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            let index = self.ensure_text_block_started(&mut out);
            out.push(anthropic_event(
                "content_block_delta",
                json!({
                    "type": "content_block_delta",
                    "index": index,
                    "delta": { "type": "text_delta", "text": text }
                }),
            ));
        }

        // `reasoning` is an alias some OpenAI-compatible upstreams use instead
        // of `reasoning_content`; both carry the same thinking stream.
        let reasoning_text = delta
            .get("reasoning_content")
            .and_then(Value::as_str)
            .or_else(|| delta.get("reasoning").and_then(Value::as_str));
        if let Some(text) = reasoning_text.filter(|text| !text.is_empty()) {
            if self.emit_anthropic_reasoning {
                let index = self.ensure_reasoning_block_started(&mut out);
                out.push(anthropic_event(
                    "content_block_delta",
                    json!({
                        "type": "content_block_delta",
                        "index": index,
                        "delta": { "type": "thinking_delta", "thinking": text }
                    }),
                ));
            } else {
                self.suppressed_anthropic_reasoning.push_str(text);
            }
        }

        // A refusal is visible assistant output; Anthropic has no dedicated
        // block type, so surface it as text rather than dropping it.
        if let Some(text) = delta
            .get("refusal")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            let index = self.ensure_text_block_started(&mut out);
            out.push(anthropic_event(
                "content_block_delta",
                json!({
                    "type": "content_block_delta",
                    "index": index,
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
                if !self.openai_tool_calls.contains_key(&index) {
                    let block_index = self.allocate_anthropic_block_index();
                    self.openai_tool_calls.insert(
                        index,
                        OpenAiToolState {
                            id: id.clone(),
                            name: name.clone(),
                            arguments: String::new(),
                            block_index,
                            started: false,
                            stopped: false,
                        },
                    );
                }
                let entry = self
                    .openai_tool_calls
                    .get_mut(&index)
                    .expect("tool state inserted above");
                entry.id = id.clone();
                entry.name = name.clone();

                if !entry.started {
                    entry.started = true;
                    self.saw_visible_output = true;
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

        // Legacy `function_call` (pre-tool_calls API) is a single call carried
        // outside the tool_calls array. Reserve the top map key so it cannot
        // collide with a real tool_calls index.
        if let Some(function_call) = delta.get("function_call").filter(|call| !call.is_null()) {
            let call_index = usize::MAX;
            let name = function_call
                .get("name")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or_else(|| {
                    self.openai_tool_calls
                        .get(&call_index)
                        .map(|state| state.name.clone())
                })
                .unwrap_or_else(|| "tool".to_string());
            let arguments = function_call
                .get("arguments")
                .and_then(Value::as_str)
                .unwrap_or("");
            if !self.openai_tool_calls.contains_key(&call_index) {
                let block_index = self.allocate_anthropic_block_index();
                self.openai_tool_calls.insert(
                    call_index,
                    OpenAiToolState {
                        id: format!("call_{}", nanoid_like()),
                        name: name.clone(),
                        arguments: String::new(),
                        block_index,
                        started: false,
                        stopped: false,
                    },
                );
            }
            let entry = self
                .openai_tool_calls
                .get_mut(&call_index)
                .expect("legacy tool state inserted above");
            entry.name = name.clone();
            if !entry.started {
                entry.started = true;
                self.saw_visible_output = true;
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

        // OpenAI's include_usage ordering sends finish_reason in chunk N and
        // the real usage in a separate trailing chunk N+1 (choices: []).
        // Terminating here would freeze message_delta.usage at whatever was
        // known at chunk N — typically 0/0. Record the stop reason only; the
        // terminal events are synthesized later, at [DONE] / stream end
        // (transform_event_block / finish), once trailing usage has landed.
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.stop_reason = Some(reason.to_string());
        }

        out
    }

    fn anthropic_to_openai_chat(&mut self, _event_name: Option<&str>, event: Value) -> Vec<String> {
        let mut out = Vec::new();
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "message_start" => {
                if let Some(message) = event.get("message") {
                    if let Some(id) = message.get("id").and_then(Value::as_str) {
                        self.message_id = id.replace("msg_", "chatcmpl_");
                    }
                    // Anthropic reports input usage on message_start; the
                    // trailing message_delta usually only carries output
                    // tokens. Without this read the client would see
                    // prompt_tokens = 0 even though the log recorded input.
                    self.usage.update_from_anthropic(message.get("usage"));
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
                                output_index: None,
                                done: false,
                            },
                        );
                        // OpenAI Chat numbers tool calls by their position in
                        // the `tool_calls` array, not by Anthropic's content
                        // block index (which counts text/thinking blocks too).
                        let chat_index = self.anthropic_tool_chat_index(index);
                        out.push(openai_chat_chunk(
                            &self.message_id,
                            self.created,
                            &self.model,
                            json!({
                                "tool_calls": [{
                                    "index": chat_index,
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
                    "thinking_delta" => {
                        if let Some(text) = delta.get("thinking").and_then(Value::as_str) {
                            out.push(openai_chat_chunk(
                                &self.message_id,
                                self.created,
                                &self.model,
                                json!({ "reasoning_content": text }),
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
                        let chat_index = self.anthropic_tool_chat_index(index);
                        if let Some(tool) = self.anthropic_tools.get_mut(&index) {
                            tool.arguments.push_str(partial);
                            out.push(openai_chat_chunk(
                                &self.message_id,
                                self.created,
                                &self.model,
                                json!({
                                    "tool_calls": [{
                                        "index": chat_index,
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
                        Some(self.usage.openai_usage_value()),
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

    fn responses_tool_name(&self, item_id: &str) -> String {
        self.responses_tool_names
            .get(item_id)
            .cloned()
            .unwrap_or_else(|| "tool".to_string())
    }

    /// Responses function-call items carry both `id` (`fc_*`) and `call_id`
    /// (`call_*`), and upstreams disagree about which one appears in
    /// `item_id`. Resolve any known alias to the id already used as the
    /// Anthropic `tool_use.id` so terminal reconciliation cannot emit a second
    /// block for the same call.
    fn responses_existing_tool_id(&self, candidates: &[Option<&str>]) -> Option<String> {
        candidates
            .iter()
            .flatten()
            .filter(|candidate| !candidate.is_empty())
            .find_map(|candidate| {
                self.openai_tool_calls
                    .values()
                    .find(|state| state.id == *candidate)
                    .map(|state| state.id.clone())
            })
    }

    fn responses_active_text_for(&self, key: &str) -> bool {
        self.text_block_started
            && self
                .responses_text_item_id
                .as_deref()
                .is_some_and(|active| active == key || active.starts_with(&format!("{key}:")))
    }

    fn responses_active_reasoning_for(&self, key: &str) -> bool {
        self.reasoning_block_started
            && self
                .responses_reasoning_item_id
                .as_deref()
                .is_some_and(|active| active == key || active.starts_with(&format!("{key}:")))
    }

    fn push_openai_responses_text_delta(
        &mut self,
        text: Option<&str>,
        item_id: Option<&str>,
        output_index: Option<u64>,
        refusal: bool,
        out: &mut Vec<String>,
    ) {
        let Some(text) = text.filter(|text| !text.is_empty()) else {
            return;
        };
        self.mark_responses_text_item(item_id, output_index);
        if refusal {
            self.saw_refusal = true;
        }
        let key = responses_item_key(item_id, output_index);
        let index = self.start_responses_text_block(&key, out);
        out.push(anthropic_event(
            "content_block_delta",
            json!({
                "type": "content_block_delta",
                "index": index,
                "delta": { "type": "text_delta", "text": text }
            }),
        ));
    }

    fn finish_openai_responses_text_item(
        &mut self,
        text: Option<&str>,
        item_id: Option<&str>,
        output_index: Option<u64>,
        refusal: bool,
        out: &mut Vec<String>,
    ) {
        if !self.responses_text_item_seen(item_id, output_index) {
            if let Some(text) = text.filter(|text| !text.is_empty()) {
                self.mark_responses_text_item(item_id, output_index);
                let key = responses_item_key(item_id, output_index);
                self.emit_terminal_text_block(&key, text, refusal, out);
            }
        }
        let key = responses_item_key(item_id, output_index);
        if self.responses_active_text_for(&key) {
            self.close_text_block(out);
        }
    }

    fn push_openai_responses_reasoning_delta(
        &mut self,
        text: Option<&str>,
        item_id: Option<&str>,
        output_index: Option<u64>,
        out: &mut Vec<String>,
    ) {
        let Some(text) = text.filter(|text| !text.is_empty()) else {
            return;
        };
        self.mark_responses_reasoning_item(item_id, output_index);
        if self.emit_anthropic_reasoning {
            let key = responses_item_key(item_id, output_index);
            let index = self.start_responses_reasoning_block(&key, out);
            out.push(anthropic_event(
                "content_block_delta",
                json!({
                    "type": "content_block_delta",
                    "index": index,
                    "delta": { "type": "thinking_delta", "thinking": text }
                }),
            ));
        } else {
            self.suppressed_anthropic_reasoning.push_str(text);
        }
    }

    fn finish_openai_responses_reasoning_item(
        &mut self,
        text: Option<&str>,
        item_id: Option<&str>,
        output_index: Option<u64>,
        out: &mut Vec<String>,
    ) {
        if !self.responses_reasoning_item_seen(item_id, output_index) {
            if let Some(text) = text.filter(|text| !text.is_empty()) {
                self.mark_responses_reasoning_item(item_id, output_index);
                let key = responses_item_key(item_id, output_index);
                self.emit_terminal_reasoning_block(&key, text, out);
            }
        }
        let key = responses_item_key(item_id, output_index);
        if self.responses_active_reasoning_for(&key) {
            self.close_reasoning_block(out);
        }
    }

    /// Emit a complete Anthropic text block for Responses content that only
    /// appeared in a terminal/item-done event. Opening and closing the block
    /// immediately keeps every block's lifecycle valid.
    fn emit_terminal_text_block(
        &mut self,
        key: &str,
        text: &str,
        refusal: bool,
        out: &mut Vec<String>,
    ) {
        if text.is_empty() {
            return;
        }
        let index = self.start_responses_text_block(key, out);
        if refusal {
            self.saw_refusal = true;
        }
        out.push(anthropic_event(
            "content_block_delta",
            json!({
                "type": "content_block_delta",
                "index": index,
                "delta": { "type": "text_delta", "text": text }
            }),
        ));
        self.close_text_block(out);
    }

    fn emit_terminal_reasoning_block(&mut self, key: &str, text: &str, out: &mut Vec<String>) {
        if text.is_empty() {
            return;
        }
        if !self.emit_anthropic_reasoning {
            self.suppressed_anthropic_reasoning.push_str(text);
            return;
        }
        let index = self.start_responses_reasoning_block(key, out);
        out.push(anthropic_event(
            "content_block_delta",
            json!({
                "type": "content_block_delta",
                "index": index,
                "delta": { "type": "thinking_delta", "thinking": text }
            }),
        ));
        self.close_reasoning_block(out);
    }

    fn emit_terminal_tool_block(&mut self, block: &Value, out: &mut Vec<String>) {
        let item_id = block.get("id").and_then(Value::as_str);
        let call_id = block.get("call_id").and_then(Value::as_str);
        let id = self
            .responses_existing_tool_id(&[item_id, call_id])
            .or_else(|| item_id.or(call_id).map(ToString::to_string))
            .unwrap_or_else(|| "call".to_string());
        if self.responses_tool_block_seen(&id) {
            self.close_responses_tool_block(&id, out);
            return;
        }
        let name = block
            .get("name")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .unwrap_or_else(|| self.responses_tool_name(&id));
        let arguments_value = block
            .get("arguments")
            .cloned()
            .or_else(|| block.get("input").cloned())
            .unwrap_or_else(|| json!({}));
        let arguments = match &arguments_value {
            Value::String(value) => value.clone(),
            _ => serde_json::to_string(&arguments_value).unwrap_or_else(|_| "{}".to_string()),
        };
        let (map_index, block_index) = self.start_responses_tool_block(&id, &name, out);
        if let Some(state) = self.openai_tool_calls.get_mut(&map_index) {
            state.arguments.push_str(&arguments);
        }
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
        self.close_responses_tool_block(&id, out);
    }

    fn emit_openai_responses_message_content(
        &mut self,
        item: &Value,
        key: &str,
        item_id: Option<&str>,
        output_index: Option<u64>,
        out: &mut Vec<String>,
    ) {
        let parts: Vec<Value> = item
            .get("content")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_else(|| vec![item.clone()]);
        let multi_part = parts.len() > 1;
        for (part_index, part) in parts.iter().enumerate() {
            match part.get("type").and_then(Value::as_str).unwrap_or("") {
                "output_text" | "text" | "refusal" => {
                    let refusal = part.get("type").and_then(Value::as_str) == Some("refusal");
                    if let Some(text) = extract_openai_responses_output_text(part) {
                        let part_key = if multi_part {
                            format!("{key}:{part_index}")
                        } else {
                            key.to_string()
                        };
                        self.emit_terminal_text_block(&part_key, &text, refusal, out);
                    }
                }
                "function_call" | "tool_use" => {
                    self.emit_terminal_tool_block(part, out);
                }
                "reasoning" => {
                    if let Some(text) = extract_openai_reasoning_text(part) {
                        self.emit_terminal_reasoning_block(
                            &format!("{key}:r{part_index}"),
                            &text,
                            out,
                        );
                    }
                }
                _ => {}
            }
        }
        self.mark_responses_text_item(item_id, output_index);
    }

    fn handle_openai_responses_item_done(
        &mut self,
        event: &Value,
        item_id: Option<&str>,
        output_index: Option<u64>,
        out: &mut Vec<String>,
    ) {
        let Some(item) = event.get("item") else {
            return;
        };
        let event_item_id = item_id;
        let item_id = item.get("id").and_then(Value::as_str).or(item_id);
        let output_index = event
            .get("output_index")
            .and_then(Value::as_u64)
            .or(output_index);
        let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
        match item_type {
            "reasoning" => {
                let text = extract_openai_reasoning_text(item);
                self.finish_openai_responses_reasoning_item(
                    text.as_deref(),
                    item_id,
                    output_index,
                    out,
                );
            }
            "function_call" => {
                let item_call_id = item.get("call_id").and_then(Value::as_str);
                let id = self
                    .responses_existing_tool_id(&[item_id, item_call_id, event_item_id])
                    .or_else(|| {
                        item_id
                            .or(item_call_id)
                            .or(event_item_id)
                            .map(ToString::to_string)
                    })
                    .unwrap_or_else(|| format!("call_{}", output_index.unwrap_or(0)));
                if !self.responses_tool_block_seen(&id) {
                    let name = item
                        .get("name")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .unwrap_or_else(|| self.responses_tool_name(&id));
                    let arguments = item.get("arguments").and_then(Value::as_str).unwrap_or("");
                    let (map_index, block_index) = self.start_responses_tool_block(&id, &name, out);
                    if let Some(state) = self.openai_tool_calls.get_mut(&map_index) {
                        state.arguments.push_str(arguments);
                    }
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
                self.close_responses_tool_block(&id, out);
            }
            _ => {
                let key = responses_item_key(item_id, output_index);
                if !self.responses_text_item_seen(item_id, output_index) {
                    self.emit_openai_responses_message_content(
                        item,
                        &key,
                        item_id,
                        output_index,
                        out,
                    );
                }
                if self.responses_active_text_for(&key) {
                    self.close_text_block(out);
                }
            }
        }
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
        let item_id = event.get("item_id").and_then(Value::as_str).or_else(|| {
            event
                .get("item")
                .and_then(|item| item.get("id"))
                .and_then(Value::as_str)
        });
        let output_index = event.get("output_index").and_then(Value::as_u64);
        match event_type {
            "response.output_text.delta" => {
                self.push_openai_responses_text_delta(
                    event.get("delta").and_then(Value::as_str),
                    item_id,
                    output_index,
                    false,
                    &mut out,
                );
            }
            "response.content_part.delta" | "response.output_item.content_part.delta" => {
                self.push_openai_responses_text_delta(
                    event
                        .get("delta")
                        .and_then(|delta| delta.get("text"))
                        .and_then(Value::as_str),
                    item_id,
                    output_index,
                    false,
                    &mut out,
                );
            }
            // Some Responses implementations signal the end of a content part
            // without a separate output_item.done; close the item's block here
            // so a following item cannot interleave with it.
            "response.output_text.done" => {
                self.finish_openai_responses_text_item(
                    event.get("text").and_then(Value::as_str),
                    item_id,
                    output_index,
                    false,
                    &mut out,
                );
            }
            // Refusals are user-visible assistant output in the Responses
            // protocol; without these arms they would vanish for Anthropic clients.
            "response.refusal.delta" => {
                self.push_openai_responses_text_delta(
                    event.get("delta").and_then(Value::as_str),
                    item_id,
                    output_index,
                    true,
                    &mut out,
                );
            }
            "response.refusal.done" => {
                self.finish_openai_responses_text_item(
                    event
                        .get("refusal")
                        .and_then(Value::as_str)
                        .or_else(|| event.get("text").and_then(Value::as_str)),
                    item_id,
                    output_index,
                    true,
                    &mut out,
                );
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                self.push_openai_responses_reasoning_delta(
                    event.get("delta").and_then(Value::as_str),
                    item_id,
                    output_index,
                    &mut out,
                );
            }
            "response.reasoning_summary_text.done" | "response.reasoning_text.done" => {
                self.finish_openai_responses_reasoning_item(
                    event.get("text").and_then(Value::as_str),
                    item_id,
                    output_index,
                    &mut out,
                );
            }
            "response.output_item.added" => {
                if let Some(item) = event.get("item") {
                    if let Some(name) = item.get("name").and_then(Value::as_str) {
                        for alias in [item.get("id"), item.get("call_id")]
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                        {
                            self.responses_tool_names
                                .insert(alias.to_string(), name.to_string());
                        }
                    }
                }
            }
            "response.function_call_arguments.delta" => {
                let delta = event.get("delta").and_then(Value::as_str);
                if let (Some(item_id), Some(delta)) = (item_id, delta) {
                    let resolved_id = self
                        .responses_existing_tool_id(&[Some(item_id)])
                        .unwrap_or_else(|| item_id.to_string());
                    let name = self.responses_tool_name(&resolved_id);
                    let (map_index, block_index) =
                        self.start_responses_tool_block(&resolved_id, &name, &mut out);
                    if let Some(state) = self.openai_tool_calls.get_mut(&map_index) {
                        state.arguments.push_str(delta);
                    }
                    out.push(anthropic_event(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": block_index,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": delta
                            }
                        }),
                    ));
                }
            }
            "response.function_call_arguments.done" => {
                if let Some(item_id) = item_id {
                    let resolved_id = self
                        .responses_existing_tool_id(&[Some(item_id)])
                        .unwrap_or_else(|| item_id.to_string());
                    let arguments = event.get("arguments").and_then(Value::as_str);
                    if !self.responses_tool_block_seen(&resolved_id) {
                        if let Some(arguments) = arguments.filter(|text| !text.is_empty()) {
                            let name = self.responses_tool_name(&resolved_id);
                            let (map_index, block_index) =
                                self.start_responses_tool_block(&resolved_id, &name, &mut out);
                            if let Some(state) = self.openai_tool_calls.get_mut(&map_index) {
                                state.arguments.push_str(arguments);
                            }
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
                    self.close_responses_tool_block(&resolved_id, &mut out);
                }
            }
            "response.output_item.done" => {
                self.handle_openai_responses_item_done(&event, item_id, output_index, &mut out);
            }
            "response.completed" | "response.done" | "response.incomplete" => {
                // Reconcile first: it can observe a refusal content part or a
                // whole item that only appears in the terminal output.
                out.extend(self.reconcile_openai_responses_completed_event(&event));
                if self.stop_reason.is_none() {
                    self.stop_reason = if self.saw_refusal {
                        Some("refusal".to_string())
                    } else {
                        infer_openai_responses_stop_reason(&event).map(ToString::to_string)
                    };
                }
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
        for (position, item) in output.iter().enumerate() {
            let output_index = position as u64;
            let item_id = item.get("id").and_then(Value::as_str);
            let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
            match item_type {
                "reasoning" => {
                    let key = responses_item_key(item_id, Some(output_index));
                    if !self.responses_reasoning_item_seen(item_id, Some(output_index)) {
                        if let Some(text) = extract_openai_reasoning_text(item) {
                            self.mark_responses_reasoning_item(item_id, Some(output_index));
                            self.emit_terminal_reasoning_block(&key, &text, &mut out);
                        }
                    }
                    if self.responses_active_reasoning_for(&key) {
                        self.close_reasoning_block(&mut out);
                    }
                }
                "function_call" => {
                    // Resolves `id`/`call_id` aliases and closes an already
                    // streamed block instead of emitting a duplicate.
                    self.emit_terminal_tool_block(item, &mut out);
                }
                _ => {
                    let key = responses_item_key(item_id, Some(output_index));
                    if !self.responses_text_item_seen(item_id, Some(output_index)) {
                        self.emit_openai_responses_message_content(
                            item,
                            &key,
                            item_id,
                            Some(output_index),
                            &mut out,
                        );
                    }
                    if self.responses_active_text_for(&key) {
                        self.close_text_block(&mut out);
                    }
                }
            }
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
                // Anthropic reports input usage on message_start; the trailing
                // message_delta usually only carries output tokens.
                self.usage.update_from_anthropic(
                    event
                        .get("message")
                        .and_then(|message| message.get("usage")),
                );
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
                            "created_at": self.created,
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
                            let output_index = self.allocate_responses_output_index();
                            self.anthropic_tools.insert(
                                index,
                                AnthropicToolState {
                                    id: id.clone(),
                                    name: name.clone(),
                                    arguments: String::new(),
                                    output_index: Some(output_index),
                                    done: false,
                                },
                            );
                            out.push(openai_responses_event(json!({
                                "type": "response.output_item.added",
                                "output_index": output_index,
                                "item": {
                                    "id": id,
                                    "type": "function_call",
                                    "status": "in_progress",
                                    "call_id": id,
                                    "name": name,
                                    "arguments": ""
                                }
                            })));
                        }
                        Some("thinking") | Some("redacted_thinking") => {
                            // The reasoning item itself is opened lazily on the
                            // first thinking delta so an empty block stays empty
                            // and consumes no output index.
                        }
                        Some("text") => {
                            // Opened lazily on the first non-empty delta for the
                            // same reason: empty text blocks must not announce an
                            // item that the final output omits.
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
                        if let Some(text) = delta
                            .get("text")
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                        {
                            let (output_index, item_id) =
                                self.ensure_openai_responses_text_item(index, &mut out);
                            if let Some(item) = self.responses_text_items.get_mut(&index) {
                                item.text.push_str(text);
                            }
                            self.responses_text.push_str(text);
                            out.push(openai_responses_event(json!({
                                "type": "response.output_text.delta",
                                "item_id": item_id,
                                "output_index": output_index,
                                "content_index": 0,
                                "delta": text
                            })));
                        }
                    }
                    "thinking_delta" => {
                        if let Some(text) = delta
                            .get("thinking")
                            .and_then(Value::as_str)
                            .filter(|text| !text.is_empty())
                        {
                            let (output_index, item_id) =
                                self.ensure_openai_responses_reasoning_item(index, &mut out);
                            if let Some(item) = self.responses_reasoning_items.get_mut(&index) {
                                item.text.push_str(text);
                            }
                            self.responses_reasoning_content.push_str(text);
                            out.push(openai_responses_event(json!({
                                "type": "response.reasoning_summary_text.delta",
                                "item_id": item_id,
                                "output_index": output_index,
                                "summary_index": 0,
                                "delta": text
                            })));
                        }
                    }
                    "input_json_delta" => {
                        let partial = delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        if !partial.is_empty() {
                            if let Some(tool) = self.anthropic_tools.get_mut(&index) {
                                tool.arguments.push_str(partial);
                                let output_index = tool.output_index.unwrap_or(0);
                                let item_id = tool.id.clone();
                                out.push(openai_responses_event(json!({
                                    "type": "response.function_call_arguments.delta",
                                    "item_id": item_id,
                                    "output_index": output_index,
                                    "delta": partial
                                })));
                            }
                        }
                    }
                    _ => {}
                }
            }
            "content_block_stop" => {
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                if self.responses_text_items.contains_key(&index) {
                    self.close_openai_responses_text_item(index, &mut out);
                } else if self.responses_reasoning_items.contains_key(&index) {
                    self.close_openai_responses_reasoning_item(index, &mut out);
                } else {
                    self.close_anthropic_tool_item(index, &mut out);
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
        if self.allow_anthropic_reasoning_fallback
            && !self.emit_anthropic_reasoning
            && !self.suppressed_anthropic_reasoning.trim().is_empty()
            && !self.saw_visible_output
        {
            let fallback_text = self.suppressed_anthropic_reasoning.clone();
            let index = self.ensure_text_block_started(&mut out);
            out.push(anthropic_event(
                "content_block_delta",
                json!({
                    "type": "content_block_delta",
                    "index": index,
                    "delta": { "type": "text_delta", "text": fallback_text }
                }),
            ));
        }
        let mut stop_indices = Vec::new();
        if self.reasoning_block_started && !self.reasoning_block_stopped {
            self.reasoning_block_stopped = true;
            if let Some(index) = self.reasoning_block_index {
                stop_indices.push(index);
            }
        }
        if self.text_block_started && !self.text_block_stopped {
            self.text_block_stopped = true;
            if let Some(index) = self.text_block_index {
                stop_indices.push(index);
            }
        }
        for state in self.openai_tool_calls.values_mut() {
            if !state.stopped {
                state.stopped = true;
                stop_indices.push(state.block_index);
            }
        }
        stop_indices.sort_unstable();
        for index in stop_indices {
            out.push(anthropic_event(
                "content_block_stop",
                json!({ "type": "content_block_stop", "index": index }),
            ));
        }
        let stop_reason = match self.mode {
            StreamMode::OpenAiChatToAnthropic => resolve_openai_chat_anthropic_stop_reason(
                self.stop_reason.as_deref(),
                !self.openai_tool_calls.is_empty(),
            ),
            _ => {
                // Responses→Anthropic: an absent stop_reason on a stream that
                // emitted tool calls must still surface "tool_use", else a client
                // awaiting tool calls observes a premature "end_turn". (Anthropic
                // passthrough never accumulates openai_tool_calls, so the guard is
                // inert there.)
                if self.stop_reason.is_none() && !self.openai_tool_calls.is_empty() {
                    "tool_use"
                } else {
                    resolve_anthropic_stop_reason(self.stop_reason.as_deref())
                }
            }
        };
        out.push(anthropic_event(
            "message_delta",
            json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": stop_reason,
                    "stop_sequence": Value::Null
                },
                "usage": self.usage.anthropic_usage_value()
            }),
        ));
        out.push(anthropic_event(
            "message_stop",
            json!({ "type": "message_stop" }),
        ));
        out
    }

    fn finish_openai_responses(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        let text_blocks: Vec<usize> = self.responses_text_items.keys().copied().collect();
        for index in text_blocks {
            self.close_openai_responses_text_item(index, &mut out);
        }
        let reasoning_blocks: Vec<usize> = self.responses_reasoning_items.keys().copied().collect();
        for index in reasoning_blocks {
            self.close_openai_responses_reasoning_item(index, &mut out);
        }
        let tool_indices: Vec<usize> = self.anthropic_tools.keys().copied().collect();
        for index in tool_indices {
            self.close_anthropic_tool_item(index, &mut out);
        }

        // Build the final output array in the same order the items were
        // announced on the stream, so output_index values stay consistent.
        let mut output_items = Vec::<(usize, Value)>::new();
        for item in self.responses_reasoning_items.values() {
            if !item.text.is_empty() {
                output_items.push((
                    item.output_index,
                    build_openai_reasoning_output_item(&item.id, &item.text),
                ));
            }
        }
        for item in self.responses_text_items.values() {
            if !item.text.is_empty() {
                output_items.push((
                    item.output_index,
                    build_openai_responses_message_item(&item.id, &item.text),
                ));
            }
        }
        for tool in self.anthropic_tools.values() {
            if let Some(index) = tool.output_index {
                output_items.push((
                    index,
                    build_openai_responses_function_call_item(
                        &tool.id,
                        &tool.name,
                        &tool.arguments,
                    ),
                ));
            }
        }
        output_items.sort_by_key(|(index, _)| *index);
        let output: Vec<Value> = output_items.into_iter().map(|(_, item)| item).collect();

        let status = map_anthropic_stop_reason_to_openai_status(self.stop_reason.as_deref());
        // OpenAI Responses signals a length cut with `status: incomplete` plus
        // `incomplete_details`, and emits it as `response.incomplete`.
        let (event_type, incomplete_details) = if status == "incomplete" {
            (
                "response.incomplete",
                json!({ "reason": "max_output_tokens" }),
            )
        } else {
            ("response.completed", Value::Null)
        };

        out.push(openai_responses_event(json!({
            "type": event_type,
            "status": status,
            "stop_reason": self.stop_reason,
            "response": {
                "id": self.response_id,
                "object": "response",
                "created_at": self.created,
                "model": self.model,
                "status": status,
                "incomplete_details": incomplete_details,
                "output": output,
                "usage": self.usage.openai_responses_usage_value(),
                "reasoning_content": if self.responses_reasoning_content.is_empty() {
                    Value::Null
                } else {
                    Value::String(self.responses_reasoning_content.clone())
                }
            },
            "output_text": if self.responses_text.is_empty() {
                Value::Null
            } else {
                Value::String(self.responses_text.clone())
            },
            "reasoning_content": if self.responses_reasoning_content.is_empty() {
                Value::Null
            } else {
                Value::String(self.responses_reasoning_content.clone())
            }
        })));
        out.push("data: [DONE]\n\n".to_string());
        out
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
    // Tool calls are normal Responses output; `requires_action` belongs to
    // the Assistants API. Only a token-limit stop is an incomplete response.
    match reason {
        Some("max_tokens") => "incomplete",
        _ => "completed",
    }
}

fn map_openai_finish_reason_to_anthropic(reason: Option<&str>) -> &'static str {
    match reason {
        Some("tool_calls") => "tool_use",
        Some("content_filter" | "refusal") => "refusal",
        Some(
            "length"
            | "max_tokens"
            | "max_output_tokens"
            | "context_length_exceeded"
            | "context_window_exceeded"
            | "model_context_window_exceeded",
        ) => "max_tokens",
        _ => "end_turn",
    }
}

fn parse_tool_input_object(input: &str) -> Value {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return json!({});
    }

    match serde_json::from_str::<Value>(trimmed) {
        Ok(Value::Object(map)) => Value::Object(map),
        _ => json!({ "_raw": input }),
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

fn resolve_openai_chat_anthropic_stop_reason(
    reason: Option<&str>,
    has_tool_calls: bool,
) -> &'static str {
    let mapped = map_openai_finish_reason_to_anthropic(reason);
    match mapped {
        "max_tokens" | "refusal" => mapped,
        _ if has_tool_calls => "tool_use",
        _ => mapped,
    }
}

fn map_openai_responses_stop_reason_to_anthropic(reason: &str) -> Option<&'static str> {
    match reason {
        "tool_use" | "tool_calls" => Some("tool_use"),
        "max_tokens"
        | "length"
        | "max_output_tokens"
        | "context_length_exceeded"
        | "context_window_exceeded"
        | "model_context_window_exceeded" => Some("max_tokens"),
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
    if let Some(reason) = explicit_reason
        && let Some(mapped) = map_openai_responses_stop_reason_to_anthropic(reason)
    {
        return Some(mapped);
    }

    let incomplete_reason = event
        .get("incomplete_details")
        .and_then(|details| details.get("reason"))
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("response")
                .and_then(|response| response.get("incomplete_details"))
                .and_then(|details| details.get("reason"))
                .and_then(Value::as_str)
        });
    if let Some(reason) = incomplete_reason
        && let Some(mapped) = map_openai_responses_stop_reason_to_anthropic(reason)
    {
        return Some(mapped);
    }

    let status = event.get("status").and_then(Value::as_str).or_else(|| {
        event
            .get("response")
            .and_then(|response| response.get("status"))
            .and_then(Value::as_str)
    });
    let saw_refusal = event
        .get("response")
        .and_then(|response| response.get("output"))
        .and_then(Value::as_array)
        .is_some_and(|output| {
            output.iter().any(|item| {
                let blocks = item
                    .get("content")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_else(|| vec![item.clone()]);
                blocks.iter().any(|block| {
                    block.get("type").and_then(Value::as_str) == Some("refusal")
                        && (block
                            .get("refusal")
                            .and_then(Value::as_str)
                            .is_some_and(|text| !text.is_empty())
                            || block
                                .get("text")
                                .and_then(Value::as_str)
                                .is_some_and(|text| !text.is_empty()))
                })
            })
        });
    if saw_refusal {
        return Some("refusal");
    }
    let saw_tool_use = event
        .get("response")
        .and_then(|response| response.get("output"))
        .and_then(Value::as_array)
        .is_some_and(|output| {
            output.iter().any(|item| {
                let blocks = item
                    .get("content")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_else(|| vec![item.clone()]);
                blocks.iter().any(|block| {
                    matches!(
                        block.get("type").and_then(Value::as_str),
                        Some("function_call") | Some("tool_use")
                    )
                })
            })
        });
    if saw_tool_use {
        return Some("tool_use");
    }
    match status {
        Some("requires_action") => Some("tool_use"),
        Some(
            "incomplete"
            | "context_length_exceeded"
            | "context_window_exceeded"
            | "model_context_window_exceeded",
        ) => Some("max_tokens"),
        Some("completed") => Some("end_turn"),
        _ => None,
    }
}

fn next_sse_event_boundary(buffer: &str) -> Option<(usize, usize)> {
    let lf = buffer.find("\n\n").map(|index| (index, 2));
    let crlf = buffer.find("\r\n\r\n").map(|index| (index, 4));
    match (lf, crlf) {
        (Some(left), Some(right)) => Some(if left.0 <= right.0 { left } else { right }),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

pub fn materialize_stream_response(protocol: ProviderProtocol, sse_stream: &str) -> Option<String> {
    let normalized = sse_stream.replace("\r\n", "\n");
    match protocol {
        ProviderProtocol::AnthropicMessages => materialize_anthropic_stream(&normalized),
        ProviderProtocol::OpenAiChatCompletions => materialize_openai_chat_stream(&normalized),
        ProviderProtocol::OpenAiResponses => materialize_openai_responses_stream(&normalized),
    }
}

/// Replay a fully-buffered SSE stream through [`SseStreamObserver`] and return
/// the usage the upstream actually reported — `None` when no recognizable
/// usage object ever appeared. The materialized (non-stream-via-stream) path
/// needs this because [`materialize_stream_response`] always embeds a
/// zero-filled usage envelope for client-shape compatibility, and that
/// synthesized envelope must not be mistaken for real reported usage when
/// logging tokens (NULL-tokens semantics, same as the passthrough-stream path).
pub fn observe_buffered_stream_usage(
    protocol: ProviderProtocol,
    sse_stream: &str,
) -> Option<UsageStats> {
    let mut observer = SseStreamObserver::new(protocol);
    let normalized = sse_stream.replace("\r\n", "\n");
    for block in normalized.split("\n\n") {
        if block.trim().is_empty() {
            continue;
        }
        let mut observation = StreamObservation::default();
        observer.observe_event_block(block, &mut observation);
    }
    observer.observed_usage_stats()
}

fn sse_data_events(sse_stream: &str) -> Vec<Value> {
    let mut events = Vec::new();
    for block in sse_stream.split("\n\n") {
        if block.trim().is_empty() {
            continue;
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
            continue;
        }

        if let Ok(event) = serde_json::from_str::<Value>(&data) {
            events.push(event);
        }
    }
    events
}

fn materialize_anthropic_stream(sse_stream: &str) -> Option<String> {
    let events = sse_data_events(sse_stream);
    if events.is_empty() {
        return None;
    }

    let mut id = None::<String>;
    let mut model = None::<String>;
    let mut content_blocks = BTreeMap::<usize, Value>::new();
    let mut tool_inputs = BTreeMap::<usize, String>::new();
    let mut stop_reason = Value::Null;
    let mut stop_sequence = Value::Null;
    let mut usage = UsageState::default();

    for event in events {
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "message_start" => {
                if let Some(message) = event.get("message") {
                    id = message
                        .get("id")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or(id);
                    model = message
                        .get("model")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                        .or(model);
                    usage.update_from_anthropic(message.get("usage"));
                }
            }
            "content_block_start" => {
                let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                if let Some(content_block) = event.get("content_block") {
                    match content_block
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                    {
                        "text" => {
                            content_blocks.insert(index, json!({ "type": "text", "text": "" }));
                        }
                        "thinking" => {
                            content_blocks
                                .insert(index, json!({ "type": "thinking", "thinking": "" }));
                        }
                        "redacted_thinking" => {
                            content_blocks.insert(index, content_block.clone());
                        }
                        "tool_use" => {
                            content_blocks.insert(
                                index,
                                json!({
                                    "type": "tool_use",
                                    "id": content_block.get("id").cloned().unwrap_or(Value::Null),
                                    "name": content_block.get("name").cloned().unwrap_or(Value::Null),
                                    "input": {}
                                }),
                            );
                            tool_inputs.entry(index).or_default();
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
                        let text = delta.get("text").and_then(Value::as_str).unwrap_or("");
                        let block = content_blocks
                            .entry(index)
                            .or_insert_with(|| json!({ "type": "text", "text": "" }));
                        let mut next = block
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        next.push_str(text);
                        block["text"] = Value::String(next);
                    }
                    "thinking_delta" => {
                        let text = delta.get("thinking").and_then(Value::as_str).unwrap_or("");
                        let block = content_blocks
                            .entry(index)
                            .or_insert_with(|| json!({ "type": "thinking", "thinking": "" }));
                        let mut next = block
                            .get("thinking")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        next.push_str(text);
                        block["thinking"] = Value::String(next);
                    }
                    "signature_delta" => {
                        if let Some(signature) = delta.get("signature").and_then(Value::as_str) {
                            let block = content_blocks
                                .entry(index)
                                .or_insert_with(|| json!({ "type": "thinking", "thinking": "" }));
                            block["signature"] = Value::String(signature.to_string());
                        }
                    }
                    "input_json_delta" => {
                        let partial = delta
                            .get("partial_json")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        tool_inputs.entry(index).or_default().push_str(partial);
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(delta) = event.get("delta") {
                    stop_reason = delta.get("stop_reason").cloned().unwrap_or(Value::Null);
                    stop_sequence = delta.get("stop_sequence").cloned().unwrap_or(Value::Null);
                }
                usage.update_from_anthropic(
                    event
                        .get("usage")
                        .or_else(|| event.get("delta").and_then(|value| value.get("usage"))),
                );
            }
            _ => {}
        }
    }

    for (index, raw_input) in tool_inputs {
        if let Some(block) = content_blocks.get_mut(&index) {
            block["input"] = parse_tool_input_object(&raw_input);
        }
    }
    let content = content_blocks
        .into_values()
        .filter(|block| {
            block.get("type").and_then(Value::as_str) != Some("text")
                || block
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.is_empty())
        })
        .collect::<Vec<_>>();

    serde_json::to_string(&json!({
        "id": id.unwrap_or_else(|| format!("msg_{}", nanoid_like())),
        "type": "message",
        "role": "assistant",
        "model": model.unwrap_or_else(|| "unknown-model".to_string()),
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": stop_sequence,
        "usage": usage.anthropic_usage_value()
    }))
    .ok()
}

fn materialize_openai_chat_stream(sse_stream: &str) -> Option<String> {
    let events = sse_data_events(sse_stream);
    if events.is_empty() {
        return None;
    }

    let mut id = None::<String>;
    let mut created = None::<i64>;
    let mut model = None::<String>;
    let mut content = String::new();
    let mut reasoning_content = String::new();
    let mut refusal = String::new();
    let mut finish_reason = Value::Null;
    let mut usage = UsageState::default();
    let mut tool_calls = BTreeMap::<usize, Value>::new();

    for event in events {
        id = event
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .or(id);
        created = event.get("created").and_then(Value::as_i64).or(created);
        model = event
            .get("model")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .or(model);
        // Some OpenAI-compatible upstreams (e.g. GLM) nest the usage in
        // choices[0].delta.usage instead of the chunk top level; read both
        // like the stream transformer and observer do.
        usage.update_from_openai(event.get("usage").or_else(|| {
            event
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("delta"))
                .and_then(|delta| delta.get("usage"))
        }));

        let Some(choice) = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            continue;
        };

        if let Some(reason) = choice.get("finish_reason") {
            finish_reason = reason.clone();
        }

        let delta = choice.get("delta").cloned().unwrap_or_else(|| json!({}));
        if let Some(text) = delta.get("content").and_then(Value::as_str) {
            content.push_str(text);
        }
        if let Some(text) = delta.get("reasoning_content").and_then(Value::as_str) {
            reasoning_content.push_str(text);
        } else if let Some(text) = delta.get("reasoning").and_then(Value::as_str) {
            reasoning_content.push_str(text);
        }
        if let Some(text) = delta.get("refusal").and_then(Value::as_str) {
            refusal.push_str(text);
        }
        // Deprecated single-function streaming shape; still emitted by some
        // OpenAI-compatible providers.
        if let Some(function_call) = delta.get("function_call") {
            let entry = tool_calls.entry(usize::MAX).or_insert_with(|| {
                json!({
                    "id": format!("call_{}", nanoid_like()),
                    "type": "function",
                    "function": { "name": "", "arguments": "" }
                })
            });
            if let Some(name) = function_call.get("name").and_then(Value::as_str) {
                entry["function"]["name"] = Value::String(name.to_string());
            }
            if let Some(arguments) = function_call.get("arguments").and_then(Value::as_str) {
                let mut next = entry["function"]["arguments"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                next.push_str(arguments);
                entry["function"]["arguments"] = Value::String(next);
            }
        }
        if let Some(delta_tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for tool_call in delta_tool_calls {
                let index = tool_call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let entry = tool_calls.entry(index).or_insert_with(|| {
                    json!({
                        "id": format!("call_{index}"),
                        "type": "function",
                        "function": { "name": "", "arguments": "" }
                    })
                });

                if let Some(value) = tool_call.get("id").filter(|value| value.is_string()) {
                    entry["id"] = value.clone();
                }
                if let Some(name) = tool_call
                    .get("function")
                    .and_then(|function| function.get("name"))
                    .and_then(Value::as_str)
                {
                    entry["function"]["name"] = Value::String(name.to_string());
                }
                if let Some(arguments) = tool_call
                    .get("function")
                    .and_then(|function| function.get("arguments"))
                    .and_then(Value::as_str)
                {
                    let mut next = entry["function"]["arguments"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    next.push_str(arguments);
                    entry["function"]["arguments"] = Value::String(next);
                }
            }
        }
    }

    let mut message = json!({ "role": "assistant" });
    if !content.is_empty() {
        message["content"] = Value::String(content);
    } else if !tool_calls.is_empty() || !refusal.is_empty() {
        message["content"] = Value::Null;
    }
    if !reasoning_content.is_empty() {
        message["reasoning_content"] = Value::String(reasoning_content);
    }
    if !refusal.is_empty() {
        message["refusal"] = Value::String(refusal);
    }
    if !tool_calls.is_empty() {
        message["tool_calls"] = Value::Array(tool_calls.into_values().collect());
    }

    serde_json::to_string(&json!({
        "id": id.unwrap_or_else(|| format!("chatcmpl_{}", nanoid_like())),
        "object": "chat.completion",
        "created": created.unwrap_or_else(|| chrono::Utc::now().timestamp()),
        "model": model.unwrap_or_else(|| "unknown-model".to_string()),
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish_reason
        }],
        "usage": usage.openai_usage_value()
    }))
    .ok()
}

fn materialize_openai_responses_stream(sse_stream: &str) -> Option<String> {
    let events = sse_data_events(sse_stream);
    if events.is_empty() {
        return None;
    }

    let mut response = None::<Value>;
    let mut id = None::<String>;
    let mut created = None::<i64>;
    let mut model = None::<String>;
    let mut status = None::<String>;
    let mut output_text = String::new();
    let mut usage = UsageState::default();
    let mut tool_calls = BTreeMap::<String, Value>::new();

    for event in events {
        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        usage.update_from_openai(
            event
                .get("usage")
                .or_else(|| event.get("response").and_then(|value| value.get("usage"))),
        );

        if let Some(response_value) = event.get("response") {
            id = response_value
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or(id);
            created = response_value
                .get("created_at")
                .and_then(Value::as_i64)
                .or_else(|| response_value.get("created").and_then(Value::as_i64))
                .or(created);
            model = response_value
                .get("model")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or(model);
            status = response_value
                .get("status")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or(status);
        }

        match event_type {
            "response.output_text.delta" => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    output_text.push_str(delta);
                }
            }
            "response.output_item.added" => {
                if let Some(item) = event.get("item") {
                    if item.get("type").and_then(Value::as_str) == Some("function_call") {
                        let item_id = item
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("call")
                            .to_string();
                        tool_calls.insert(
                            item_id.clone(),
                            json!({
                                "id": json_string_or(item.get("id"), &item_id),
                                "type": "function_call",
                                "status": "completed",
                                "call_id": json_string_or(item.get("call_id"), &item_id),
                                "name": json_string_or(item.get("name"), "tool"),
                                "arguments": json_string_or(item.get("arguments"), "")
                            }),
                        );
                    }
                }
            }
            "response.function_call_arguments.delta" => {
                let item_id = event
                    .get("item_id")
                    .and_then(Value::as_str)
                    .unwrap_or("call");
                let delta = event.get("delta").and_then(Value::as_str).unwrap_or("");
                let entry = tool_calls.entry(item_id.to_string()).or_insert_with(|| {
                    json!({
                        "id": item_id,
                        "type": "function_call",
                        "status": "completed",
                        "call_id": item_id,
                        "name": "tool",
                        "arguments": ""
                    })
                });
                let mut next = entry
                    .get("arguments")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                next.push_str(delta);
                entry["arguments"] = Value::String(next);
            }
            "response.completed" | "response.done" | "response.incomplete" => {
                response = event.get("response").cloned().or(response);
                if let Some(value) = event.get("output_text").and_then(Value::as_str) {
                    output_text = value.to_string();
                }
            }
            _ => {}
        }
    }

    if let Some(mut response) = response {
        if response.get("output_text").is_none() && !output_text.is_empty() {
            response["output_text"] = Value::String(output_text);
        }
        return serde_json::to_string(&response).ok();
    }

    let mut output = Vec::new();
    if !output_text.is_empty() {
        output.push(json!({
            "id": "msg_cc_gw",
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{
                "type": "output_text",
                "text": output_text,
                "annotations": []
            }]
        }));
    }
    output.extend(tool_calls.into_values());

    serde_json::to_string(&json!({
        "id": id.unwrap_or_else(|| format!("resp_{}", nanoid_like())),
        "object": "response",
        "created_at": created.unwrap_or_else(|| chrono::Utc::now().timestamp()),
        "model": model.unwrap_or_else(|| "unknown-model".to_string()),
        "status": status.unwrap_or_else(|| "completed".to_string()),
        "output": output,
        "usage": usage.openai_responses_usage_value(),
        "output_text": if output_text.is_empty() {
            Value::Null
        } else {
            Value::String(output_text)
        }
    }))
    .ok()
}

#[cfg(test)]
mod tests {
    use super::{
        CrossProtocolStreamTransformer, SseStreamObserver, UsageState, Utf8StreamDecoder,
        materialize_stream_response, observe_buffered_stream_usage, sse_data_events,
        usage_stats_option_from_payload,
    };
    use crate::provider::ProviderProtocol;
    use serde_json::{Value, json};

    #[test]
    fn usage_stats_option_from_payload_distinguishes_missing_usage() {
        // Anthropic non-stream response with usage → Some
        let anthropic = usage_stats_option_from_payload(&json!({
            "id": "msg_1",
            "usage": {"input_tokens": 10, "output_tokens": 4}
        }));
        assert_eq!(
            anthropic.map(|u| (u.input_tokens, u.output_tokens)),
            Some((10, 4))
        );

        // OpenAI chat completion with usage → Some
        let openai = usage_stats_option_from_payload(&json!({
            "id": "chatcmpl-1",
            "usage": {"prompt_tokens": 7, "completion_tokens": 2}
        }));
        assert_eq!(
            openai.map(|u| (u.input_tokens, u.output_tokens)),
            Some((7, 2))
        );

        // No usage anywhere → None (not zeros)
        let missing = usage_stats_option_from_payload(&json!({
            "id": "chatcmpl-1",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "hi"}}]
        }));
        assert!(missing.is_none());

        // Usage object without any known token field → still None
        let empty_usage = usage_stats_option_from_payload(&json!({"usage": {}}));
        assert!(empty_usage.is_none());
    }

    #[test]
    fn sse_observer_reports_missing_usage() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        observer.push(
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n\
             data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
             data: [DONE]\n\n",
        );
        assert!(!observer.observed_usage());
        assert!(observer.observed_usage_stats().is_none());

        let mut with_usage = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        with_usage.push(
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n\
             data: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":1}}\n\n\
             data: [DONE]\n\n",
        );
        assert!(with_usage.observed_usage());
        let usage = with_usage.observed_usage_stats().expect("usage observed");
        assert_eq!((usage.input_tokens, usage.output_tokens), (5, 1));
    }

    #[test]
    fn sse_observer_detects_error_events_by_protocol() {
        let mut anthropic = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        let observation = anthropic.push(
            "event: error\n\
             data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n",
        );
        assert!(observation.saw_error_event);
        assert_eq!(
            anthropic
                .error_event()
                .and_then(|event| event.pointer("/error/message"))
                .and_then(Value::as_str),
            Some("Overloaded")
        );

        let mut openai_chat = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        let observation = openai_chat.push(
            "data: {\"error\":{\"message\":\"quota exhausted\",\"type\":\"insufficient_quota\",\"code\":\"429\"}}\n\n",
        );
        assert!(observation.saw_error_event);

        let mut openai_responses = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        let observation =
            openai_responses.push("data: {\"type\":\"response.failed\",\"response\":{}}\n\n");
        assert!(observation.saw_error_event);

        // Normal chunks in every protocol must not trip the detector.
        let mut normal = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        let observation = normal.push(
            "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}\n\n",
        );
        assert!(!observation.saw_error_event);
        assert!(normal.error_event().is_none());
    }

    #[test]
    fn utf8_decoder_reassembles_characters_split_across_chunks() {
        let mut decoder = Utf8StreamDecoder::new();
        let bytes = "你好".as_bytes();
        // Split mid-character (byte 1 of 3 of 你) across two pushes.
        assert_eq!(decoder.push(&bytes[..1]), "");
        assert_eq!(decoder.push(&bytes[1..]), "你好");
        assert_eq!(decoder.flush(), "");
    }

    #[test]
    fn utf8_decoder_degrades_invalid_bytes_but_keeps_valid_text() {
        let mut decoder = Utf8StreamDecoder::new();
        // 0xFF is never valid UTF-8; the valid text around it must survive.
        let text = decoder.push(&[b'a', 0xFF, b'b']);
        assert_eq!(text, "a\u{FFFD}b");
        // An EOF mid-character flushes the remainder as U+FFFD, not silence.
        let mut truncated = Utf8StreamDecoder::new();
        assert_eq!(truncated.push(&"好".as_bytes()[..2]), "");
        assert_eq!(truncated.flush(), "\u{FFFD}");
    }

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
        assert_eq!(usage.input_tokens, 15);
        assert_eq!(usage.output_tokens, 3);
        assert_eq!(usage.cache_read_tokens, 2);
        assert_eq!(usage.cache_creation_tokens, 1);
        assert_eq!(usage.cached_tokens, 2);
    }

    #[test]
    fn anthropic_observer_reads_message_start_usage() {
        // Some Anthropic-compatible upstreams only report usage on the
        // message_start event (nested inside `message`), never on
        // message_delta. Regression test: that usage must not be lost.
        let mut observer = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        observer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"usage\":{\"input_tokens\":9,\"output_tokens\":2,\"cache_read_input_tokens\":4,\"cache_creation_input_tokens\":1}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        );

        let usage = observer.usage_stats();
        assert_eq!(usage.input_tokens, 14);
        assert_eq!(usage.output_tokens, 2);
        assert_eq!(usage.cache_read_tokens, 4);
        assert_eq!(usage.cache_creation_tokens, 1);
    }

    #[test]
    fn anthropic_observer_message_delta_overrides_message_start_usage() {
        // message_start usage lands first, message_delta carries the final
        // cumulative totals — the later event must win field by field.
        let mut observer = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        observer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9,\"output_tokens\":2}}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{},\"usage\":{\"output_tokens\":7}}\n\n",
        );

        let usage = observer.usage_stats();
        assert_eq!(usage.input_tokens, 9);
        assert_eq!(usage.output_tokens, 7);
    }

    #[test]
    fn sse_observer_tracks_terminal_events_by_protocol() {
        let mut anthropic = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        let anthropic_observation = anthropic.push(
            "event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        );
        assert!(anthropic_observation.saw_terminal_event);
        assert!(anthropic.is_complete());

        let mut openai_chat = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        let chat_observation = openai_chat.push(
            "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
        );
        assert!(chat_observation.saw_terminal_event);
        assert!(openai_chat.is_complete());

        let mut openai_responses = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        let responses_observation = openai_responses.push(
            "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n",
        );
        assert!(responses_observation.saw_terminal_event);
        assert!(openai_responses.is_complete());

        let mut done = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        let done_observation = done.push("data: [DONE]\n\n");
        assert!(done_observation.saw_terminal_event);
        assert!(done.is_complete());
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
    fn openai_responses_observer_normalizes_anthropic_cache_breakdown() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        observer.push(
            "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":5,\"output_tokens\":4,\"cache_read_input_tokens\":3,\"cache_creation_input_tokens\":2}}}\n\n",
        );

        let usage = observer.usage_stats();
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 4);
        assert_eq!(usage.cache_read_tokens, 3);
        assert_eq!(usage.cache_creation_tokens, 2);
        assert_eq!(usage.cached_tokens, 3);
    }

    #[test]
    fn anthropic_observer_treats_tool_and_thinking_events_as_first_output() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        let observation = observer.push(
            "event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"considering options\"}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"weather\",\"input\":{}}}\n\n",
        );

        assert!(observation.saw_first_token);
    }

    #[test]
    fn openai_chat_observer_treats_tool_calls_as_first_output() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        let observation = observer.push(
            "data: {\"id\":\"chatcmpl_123\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"weather\",\"arguments\":\"\"}}]}}]}\n\n",
        );

        assert!(observation.saw_first_token);
    }

    #[test]
    fn openai_chat_role_only_chunk_is_not_first_output() {
        // OpenAI (and most compatible upstreams) open the stream with a role
        // chunk whose content is "" or null — no token has been generated yet.
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        let role = observer.push(
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"}}]}\n\n",
        );
        assert!(!role.saw_first_token);
        let null_content = observer.push(
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":null}}]}\n\n\
             data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[]}}]}\n\n",
        );
        assert!(!null_content.saw_first_token);
        let content =
            observer.push("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n");
        assert!(content.saw_first_token);
    }

    #[test]
    fn openai_chat_observer_detects_first_output_on_non_primary_choice() {
        // Choice 0 may only carry the role preamble; a token in any choice
        // still means generation started.
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiChatCompletions);
        let observation = observer.push(
            "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"}},{\"index\":1,\"delta\":{\"content\":\"hi\"}}]}\n\n",
        );
        assert!(observation.saw_first_token);
    }

    #[test]
    fn anthropic_empty_thinking_block_start_is_not_first_output() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        let empty = observer.push(
            "event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n",
        );
        assert!(!empty.saw_first_token);
        let thinking = observer.push(
            "event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hmm\"}}\n\n",
        );
        assert!(thinking.saw_first_token);
    }

    #[test]
    fn openai_responses_observer_treats_incomplete_as_terminal() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        let observation = observer.push(
            "data: {\"type\":\"response.incomplete\",\"response\":{\"id\":\"resp_i\",\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n",
        );
        assert!(observation.saw_terminal_event);
        assert!(observer.is_complete());
        assert_eq!(observer.usage_stats().output_tokens, 3);
    }

    #[test]
    fn anthropic_empty_text_delta_is_not_first_output() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::AnthropicMessages);
        let empty = observer.push(
            "event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"\"}}\n\n",
        );
        assert!(!empty.saw_first_token);
        let text = observer.push(
            "event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n",
        );
        assert!(text.saw_first_token);
    }

    #[test]
    fn openai_responses_first_output_requires_actual_content() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        // The message item announcement and an empty text delta carry no token.
        let item = observer.push(
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[]}}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"delta\":\"\"}\n\n",
        );
        assert!(!item.saw_first_token);
        // Reasoning summaries are generated output and precede the answer.
        let reasoning = observer.push(
            "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"thinking\"}\n\n",
        );
        assert!(reasoning.saw_first_token);
    }

    #[test]
    fn openai_responses_observer_treats_function_call_events_as_first_output() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        let observation = observer.push(
            "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"id\":\"call_1\",\"type\":\"function_call\",\"name\":\"weather\",\"arguments\":\"\"}}\n\n\
             data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"call_1\",\"delta\":\"{\\\"city\\\":\\\"Paris\\\"}\"}\n\n",
        );

        assert!(observation.saw_first_token);
    }

    #[test]
    fn sse_observer_accepts_crlf_event_boundaries() {
        let mut observer = SseStreamObserver::new(ProviderProtocol::OpenAiResponses);
        let observation = observer.push(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\r\n\r\n\
             data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":4}}}\r\n\r\n",
        );

        assert!(observation.saw_first_token);
        let usage = observer.usage_stats();
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 4);
    }

    #[test]
    fn openai_responses_transformer_emits_anthropic_events() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_123\"}}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":4,\"cache_read_tokens\":2,\"cache_creation_tokens\":1}}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("event: message_start"));
        assert!(joined.contains("\"id\":\"msg_123\""));
        assert!(joined.contains("event: content_block_start"));
        assert!(joined.contains("\"text\":\"hello\""));
        assert!(joined.contains("event: message_delta"));
        assert!(joined.contains("\"input_tokens\":7"));
        assert!(joined.contains("\"output_tokens\":4"));
        assert!(joined.contains("\"cache_read_input_tokens\":2"));
        assert!(joined.contains("\"cache_creation_input_tokens\":1"));
        assert!(joined.contains("event: message_stop"));
    }

    #[test]
    fn openai_responses_transformer_maps_requires_action_and_tool_output() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
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
    fn openai_responses_transformer_treats_completed_function_call_as_tool_use() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_tool\"}}\r\n\r\n\
             data: {\"type\":\"response.completed\",\"status\":\"completed\",\"response\":{\"id\":\"resp_tool\",\"status\":\"completed\",\"usage\":{\"input_tokens\":8,\"output_tokens\":1},\"output\":[{\"id\":\"call_1\",\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"weather\",\"arguments\":\"{\\\"city\\\":\\\"Paris\\\"}\"}]}}\r\n\r\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"type\":\"tool_use\""));
        assert!(joined.contains("\"id\":\"call_1\""));
        assert!(joined.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn openai_responses_transformer_maps_incomplete_to_max_tokens() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
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
    fn openai_responses_transformer_maps_incomplete_event_to_max_tokens() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        // The real Responses protocol emits `response.incomplete` (not a
        // `response.completed` carrying an incomplete status).
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_cut\"}}\n\n\
             data: {\"type\":\"response.incomplete\",\"response\":{\"id\":\"resp_cut\",\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"usage\":{\"input_tokens\":5,\"output_tokens\":2},\"output\":[{\"id\":\"out_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"partial\"}]}]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"text\":\"partial\""));
        assert!(joined.contains("\"stop_reason\":\"max_tokens\""));
        assert!(joined.contains("\"type\":\"message_stop\""));
        assert!(joined.contains("\"input_tokens\":5"));
    }

    #[test]
    fn openai_responses_to_anthropic_stream_forwards_reasoning_and_refusal_deltas() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_mix\"}}\n\n\
             data: {\"type\":\"response.reasoning_summary_text.delta\",\"item_id\":\"rs_1\",\"delta\":\"plan\"}\n\n\
             data: {\"type\":\"response.refusal.delta\",\"item_id\":\"msg_1\",\"delta\":\"cannot\"}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_mix\",\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":2},\"output\":[]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"type\":\"thinking\""));
        assert!(joined.contains("\"thinking\":\"plan\",\"type\":\"thinking_delta\""));
        assert!(joined.contains("\"text\":\"cannot\",\"type\":\"text_delta\""));
        // Refusal output must not be reported as a normal end_turn.
        assert!(joined.contains("\"stop_reason\":\"refusal\""));
        assert!(joined.contains("\"type\":\"message_stop\""));
    }

    #[test]
    fn openai_responses_to_anthropic_stream_maps_terminal_refusal_output_to_refusal() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_ref\"}}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_ref\",\"status\":\"completed\",\"usage\":{\"input_tokens\":2,\"output_tokens\":1},\"output\":[{\"id\":\"msg_ref\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"refusal\",\"refusal\":\"cannot\"}]}]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"text\":\"cannot\",\"type\":\"text_delta\""));
        assert!(joined.contains("\"stop_reason\":\"refusal\""));
    }

    #[test]
    fn openai_responses_to_anthropic_stream_separates_multiple_items() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        // Two independent reasoning/message pairs. Each item must own its
        // Anthropic block: deltas may only land inside the item's block, and
        // the item's terminal event must not replay the text it already
        // streamed.
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_multi\"}}\n\n\
             data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"id\":\"rs_1\",\"type\":\"reasoning\"}}\n\n\
             data: {\"type\":\"response.reasoning_summary_text.delta\",\"item_id\":\"rs_1\",\"output_index\":0,\"delta\":\"plan\"}\n\n\
             data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"plan\"}]}}\n\n\
             data: {\"type\":\"response.output_item.added\",\"output_index\":1,\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[]}}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":1,\"delta\":\"hello \"}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":1,\"delta\":\"world\"}\n\n\
             data: {\"type\":\"response.output_text.done\",\"item_id\":\"msg_1\",\"output_index\":1,\"text\":\"hello world\"}\n\n\
             data: {\"type\":\"response.output_item.done\",\"output_index\":1,\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello world\"}]}}\n\n\
             data: {\"type\":\"response.reasoning_summary_text.delta\",\"item_id\":\"rs_2\",\"output_index\":2,\"delta\":\"again\"}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_2\",\"output_index\":3,\"delta\":\"world\"}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_multi\",\"status\":\"completed\",\"usage\":{\"input_tokens\":5,\"output_tokens\":6},\"output\":[{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"plan\"}]},{\"id\":\"msg_1\",\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello world\"}]},{\"id\":\"rs_2\",\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"again\"}]},{\"id\":\"msg_2\",\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"world\"}]}]}}\n\n",
        );
        let events = sse_data_events(&chunks.join(""));

        let starts: Vec<(u64, &str)> = events
            .iter()
            .filter(|event| event["type"] == "content_block_start")
            .map(|event| {
                (
                    event["index"].as_u64().unwrap(),
                    event["content_block"]["type"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            starts,
            [(0, "thinking"), (1, "text"), (2, "thinking"), (3, "text")]
        );

        let deltas: Vec<(u64, &str, &str)> = events
            .iter()
            .filter(|event| event["type"] == "content_block_delta")
            .map(|event| {
                let delta = &event["delta"];
                (
                    event["index"].as_u64().unwrap(),
                    delta["type"].as_str().unwrap(),
                    delta["text"]
                        .as_str()
                        .or_else(|| delta["thinking"].as_str())
                        .unwrap(),
                )
            })
            .collect();
        assert_eq!(
            deltas,
            [
                (0, "thinking_delta", "plan"),
                (1, "text_delta", "hello "),
                (1, "text_delta", "world"),
                (2, "thinking_delta", "again"),
                (3, "text_delta", "world"),
            ],
            "terminal events must not replay streamed text"
        );

        let stops: Vec<u64> = events
            .iter()
            .filter(|event| event["type"] == "content_block_stop")
            .map(|event| event["index"].as_u64().unwrap())
            .collect();
        assert_eq!(stops, [0, 1, 2, 3]);

        let message_delta = events
            .iter()
            .find(|event| event["type"] == "message_delta")
            .expect("message_delta");
        assert_eq!(message_delta["delta"]["stop_reason"], "end_turn");
        assert_eq!(message_delta["usage"]["input_tokens"], 5);
        assert_eq!(message_delta["usage"]["output_tokens"], 6);
    }

    #[test]
    fn openai_responses_to_anthropic_stream_resolves_function_call_aliases() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        // `item_id`/`item.id`/`call_id` can disagree; they still describe one
        // function call, so only one tool_use block may be emitted.
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_alias\"}}\n\n\
             data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"id\":\"fc_1\",\"call_id\":\"call_1\",\"type\":\"function_call\",\"name\":\"lookup\",\"arguments\":\"\"}}\n\n\
             data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"call_1\",\"output_index\":0,\"delta\":\"{\\\"q\\\":\"}\n\n\
             data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"call_1\",\"output_index\":0,\"delta\":\"1}\"}\n\n\
             data: {\"type\":\"response.function_call_arguments.done\",\"item_id\":\"call_1\",\"output_index\":0,\"arguments\":\"{\\\"q\\\":1}\"}\n\n\
             data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"id\":\"fc_1\",\"call_id\":\"call_1\",\"type\":\"function_call\",\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":1}\"}}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_alias\",\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":2},\"output\":[{\"id\":\"fc_1\",\"call_id\":\"call_1\",\"type\":\"function_call\",\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":1}\"}]}}\n\n",
        );
        let events = sse_data_events(&chunks.join(""));

        let tool_starts: Vec<&Value> = events
            .iter()
            .filter(|event| {
                event["type"] == "content_block_start"
                    && event["content_block"]["type"] == "tool_use"
            })
            .collect();
        assert_eq!(tool_starts.len(), 1, "aliases must not create two blocks");
        assert_eq!(tool_starts[0]["content_block"]["id"], "call_1");
        assert_eq!(tool_starts[0]["content_block"]["name"], "lookup");

        let partial_json: Vec<&str> = events
            .iter()
            .filter(|event| event["type"] == "content_block_delta")
            .map(|event| event["delta"]["partial_json"].as_str().unwrap())
            .collect();
        assert_eq!(partial_json, ["{\"q\":", "1}"]);

        let stops: Vec<u64> = events
            .iter()
            .filter(|event| event["type"] == "content_block_stop")
            .map(|event| event["index"].as_u64().unwrap())
            .collect();
        assert_eq!(stops, [0]);
        let message_delta = events
            .iter()
            .find(|event| event["type"] == "message_delta")
            .expect("message_delta");
        assert_eq!(message_delta["delta"]["stop_reason"], "tool_use");
    }

    #[test]
    fn openai_responses_to_anthropic_stream_deduplicates_idless_terminal_text() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        // Some compatible upstreams omit `item_id`/`output_index` entirely;
        // the fallback key must still prevent `output_text.done` from replaying
        // the text already streamed.
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_idless\"}}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n\
             data: {\"type\":\"response.output_text.done\",\"text\":\"hello\"}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_idless\",\"status\":\"completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1},\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello\"}]}]}}\n\n",
        );
        let events = sse_data_events(&chunks.join(""));

        let text_deltas: Vec<&str> = events
            .iter()
            .filter(|event| event["type"] == "content_block_delta")
            .map(|event| event["delta"]["text"].as_str().unwrap())
            .collect();
        assert_eq!(text_deltas, ["hello"]);
        let stops: Vec<u64> = events
            .iter()
            .filter(|event| event["type"] == "content_block_stop")
            .map(|event| event["index"].as_u64().unwrap())
            .collect();
        assert_eq!(stops, [0]);
    }

    #[test]
    fn openai_responses_to_anthropic_stream_synthesizes_terminal_only_items_in_order() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        // Upstreams that skip delta events still produce complete output in
        // `response.completed`; the Anthropic client must receive each item in
        // output order with a valid block lifecycle.
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_terminal\"}}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_terminal\",\"status\":\"completed\",\"usage\":{\"input_tokens\":4,\"output_tokens\":5},\"output\":[{\"id\":\"rs_t\",\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"plan\"}]},{\"id\":\"msg_t\",\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"answer\"}]},{\"id\":\"call_t\",\"type\":\"function_call\",\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":1}\"}]}}\n\n",
        );
        let events = sse_data_events(&chunks.join(""));

        let starts: Vec<(u64, &str)> = events
            .iter()
            .filter(|event| event["type"] == "content_block_start")
            .map(|event| {
                (
                    event["index"].as_u64().unwrap(),
                    event["content_block"]["type"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(starts, [(0, "thinking"), (1, "text"), (2, "tool_use")]);

        let joined = chunks.join("");
        assert!(joined.contains("\"thinking\":\"plan\""));
        assert!(joined.contains("\"text\":\"answer\""));
        assert!(joined.contains("\"partial_json\":\"{\\\"q\\\":1}\""));

        let stops: Vec<u64> = events
            .iter()
            .filter(|event| event["type"] == "content_block_stop")
            .map(|event| event["index"].as_u64().unwrap())
            .collect();
        assert_eq!(
            stops,
            [0, 1, 2],
            "each synthesized item needs exactly one stop"
        );
        let message_delta = events
            .iter()
            .find(|event| event["type"] == "message_delta")
            .expect("message_delta");
        assert_eq!(message_delta["delta"]["stop_reason"], "tool_use");
    }

    #[test]
    fn observe_buffered_stream_usage_distinguishes_missing_usage() {
        let with_usage = "\
             event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_u\",\"usage\":{\"input_tokens\":14,\"output_tokens\":1}}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}\n\n";
        let stats = observe_buffered_stream_usage(ProviderProtocol::AnthropicMessages, with_usage)
            .expect("usage observed");
        assert_eq!(stats.input_tokens, 14);
        assert_eq!(stats.output_tokens, 7);

        let without_usage = "\
             event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_n\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n";
        assert!(
            observe_buffered_stream_usage(ProviderProtocol::AnthropicMessages, without_usage)
                .is_none()
        );
    }

    #[test]
    fn anthropic_to_openai_chat_stream_reads_message_start_usage() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        )
        .expect("supported transformer");
        // Anthropic carries input tokens on message_start; the final
        // message_delta usually only repeats output tokens. The client-facing
        // OpenAI chunks must still report the full prompt_tokens.
        let chunks = transformer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_u\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test-model\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":14,\"output_tokens\":1}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":7}}\n\n",
        );
        let joined = chunks.join("");
        assert!(joined.contains("\"prompt_tokens\":14"));
        assert!(joined.contains("\"completion_tokens\":7"));
    }

    #[test]
    fn openai_usage_values_include_standard_cached_token_details() {
        let mut usage = UsageState::default();
        usage.input_tokens = 11;
        usage.output_tokens = 7;
        usage.cached_tokens = 3;

        assert_eq!(
            usage.openai_usage_value()["prompt_tokens_details"]["cached_tokens"],
            json!(3)
        );
        assert_eq!(
            usage.openai_responses_usage_value()["input_tokens_details"]["cached_tokens"],
            json!(3)
        );
    }

    #[test]
    fn anthropic_to_openai_chat_numbers_tool_calls_from_zero() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        )
        .expect("supported transformer");
        // Anthropic block 3 is the first tool call: Chat clients expect it at
        // tool_calls index 0, not 3.
        let chunks = transformer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_tool_index\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test-model\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"checking\"}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":3,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"weather\",\"input\":{}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":3,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"city\\\":\\\"Paris\\\"}\"}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains(
            "\"tool_calls\":[{\"function\":{\"arguments\":\"\",\"name\":\"weather\"},\"id\":\"tool_1\",\"index\":0,\"type\":\"function\"}]"
        ));
        assert!(joined.contains(
            "\"tool_calls\":[{\"function\":{\"arguments\":\"{\\\"city\\\":\\\"Paris\\\"}\",\"name\":\"weather\"},\"id\":\"tool_1\",\"index\":0,\"type\":\"function\"}]"
        ));
        assert!(!joined.contains("\"index\":3,\"type\":\"function\""));
    }

    #[test]
    fn anthropic_to_openai_chat_stream_preserves_thinking_as_reasoning_content() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_reason\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test-model\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"considering options\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"reasoning_content\":\"considering options\""));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_preserves_reasoning_content() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"considering options\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"weather\",\"arguments\":\"{\\\"city\\\":\\\"Paris\\\"}\"}}]}}]}\n\n\
             data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("event: message_start"));
        assert!(joined.contains("\"thinking\":\"\",\"type\":\"thinking\""));
        assert!(
            joined.contains("\"thinking\":\"considering options\",\"type\":\"thinking_delta\"")
        );
        assert!(joined.contains("\"text\":\"\",\"type\":\"text\""));
        assert!(joined.contains("\"text\":\"hello\",\"type\":\"text_delta\""));
        assert!(
            joined.contains(
                "\"id\":\"call_1\",\"input\":{},\"name\":\"weather\",\"type\":\"tool_use\""
            )
        );
        assert!(joined.contains("\"index\":0,\"type\":\"content_block_start\""));
        assert!(joined.contains("\"index\":1,\"type\":\"content_block_start\""));
        assert!(joined.contains("\"index\":2,\"type\":\"content_block_start\""));
        assert_eq!(
            joined
                .matches("\"index\":2,\"type\":\"content_block_start\"")
                .count(),
            1
        );
    }

    #[test]
    fn openai_chat_to_anthropic_stream_omits_empty_text_before_tool_use() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"Bash\",\"arguments\":\"{\\\"command\\\":\\\"git status\\\"}\"}}]}}]}\n\n\
             data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(joined.contains("event: message_start"));
        assert!(!joined.contains("\"type\":\"text\",\"text\":\"\""));
        assert!(
            joined
                .contains("\"id\":\"call_1\",\"input\":{},\"name\":\"Bash\",\"type\":\"tool_use\"")
        );
        assert!(joined.contains("\"partial_json\":\"{\\\"command\\\":\\\"git status\\\"}\""));
        assert!(joined.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_reads_delta_nested_usage() {
        // GLM-style upstreams nest usage in choices[0].delta.usage; the
        // synthesized client-facing message_delta must still carry it.
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_gl\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hi\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_gl\",\"choices\":[{\"index\":0,\"delta\":{\"usage\":{\"prompt_tokens\":41,\"completion_tokens\":7,\"total_tokens\":48}}}]}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(
            joined.contains("\"type\":\"message_delta\""),
            "must emit terminal message_delta"
        );
        assert!(
            joined.contains("\"usage\":{\"input_tokens\":41,\"output_tokens\":7}"),
            "delta-nested usage must reach the client message_delta, got: {joined}"
        );
    }

    #[test]
    fn openai_chat_to_anthropic_stream_reads_trailing_usage_chunk() {
        // Standard OpenAI include_usage ordering: finish_reason arrives in
        // chunk N, real usage in a separate trailing chunk N+1 (choices: []),
        // then [DONE]. The terminal message_delta must carry the trailing
        // usage, not the 0/0 snapshot known at chunk N.
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_std\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hi\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_std\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}]}\n\n\
             data: {\"id\":\"chatcmpl_std\",\"choices\":[],\"usage\":{\"prompt_tokens\":13,\"completion_tokens\":5,\"total_tokens\":18}}\n\n\
             data: [DONE]\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(
            joined.contains("\"usage\":{\"input_tokens\":13,\"output_tokens\":5}"),
            "trailing usage chunk must reach the client message_delta, got: {joined}"
        );
        // finish_reason=length maps to max_tokens; it must survive the
        // deferred termination unchanged.
        assert!(
            joined.contains("\"stop_reason\":\"max_tokens\""),
            "stop reason must map through deferred finish, got: {joined}"
        );
        // Exactly one terminal pair — the finish_reason chunk must not
        // synthesize a second, usage-less message_delta/message_stop.
        assert_eq!(
            joined.matches("\"type\":\"message_delta\"").count(),
            1,
            "exactly one message_delta expected, got: {joined}"
        );
        assert_eq!(
            joined.matches("\"type\":\"message_stop\"").count(),
            1,
            "exactly one message_stop expected, got: {joined}"
        );
    }

    #[test]
    fn openai_chat_to_anthropic_stream_finishes_at_done_without_trailing_usage() {
        // Streams whose upstream never sends usage ([DONE] straight after
        // finish_reason) must still terminate with the full event tail.
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_x\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_x\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
             data: [DONE]\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(
            joined.contains("\"type\":\"message_delta\""),
            "must emit terminal message_delta, got: {joined}"
        );
        assert!(
            joined.contains("\"stop_reason\":\"end_turn\""),
            "finish_reason=stop must map to end_turn, got: {joined}"
        );
        assert_eq!(
            joined.matches("\"type\":\"message_stop\"").count(),
            1,
            "exactly one message_stop expected, got: {joined}"
        );
    }

    #[test]
    fn openai_chat_to_anthropic_stream_finishes_on_eof_without_done() {
        // Some OpenAI-compatible upstreams close the stream without a
        // [DONE] sentinel; the deferred termination must still fire on
        // finish() (EOF) so the client stream is well-formed.
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_e\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_e\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n\
             data: {\"id\":\"chatcmpl_e\",\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":2,\"total_tokens\":9}}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(
            joined.contains("\"usage\":{\"input_tokens\":7,\"output_tokens\":2}"),
            "usage chunk without trailing [DONE] must reach message_delta, got: {joined}"
        );
        assert!(
            joined.contains("\"type\":\"message_stop\""),
            "must emit message_stop at EOF, got: {joined}"
        );
    }

    #[test]
    fn openai_chat_to_anthropic_stream_infers_tool_use_without_finish_reason() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"Bash\",\"arguments\":\"{\\\"command\\\":\\\"git status\\\"}\"}}]}}]}\n\n\
             data: [DONE]\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(
            joined
                .contains("\"id\":\"call_1\",\"input\":{},\"name\":\"Bash\",\"type\":\"tool_use\"")
        );
        assert!(joined.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_treats_stop_with_tools_as_tool_use() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"Bash\",\"arguments\":\"{\\\"command\\\":\\\"git status\\\"}\"}}]}}]}\n\n\
             data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(joined.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_preserves_max_tokens_with_tools() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"Bash\",\"arguments\":\"{\\\"command\\\":\\\"git status\\\"\"}}]}}]}\n\n\
             data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"finish_reason\":\"length\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(joined.contains("\"stop_reason\":\"max_tokens\""));
        assert!(!joined.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_preserves_refusal_with_tools() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "claude-sonnet-4-6",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"Bash\",\"arguments\":\"{\\\"command\\\":\\\"git status\\\"}\"}}]}}]}\n\n\
             data: {\"id\":\"chatcmpl_tool\",\"choices\":[{\"index\":0,\"finish_reason\":\"content_filter\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(joined.contains("\"stop_reason\":\"refusal\""));
        assert!(!joined.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn materialize_anthropic_stream_drops_empty_text_blocks_before_tool_use() {
        let payload = materialize_stream_response(
            ProviderProtocol::AnthropicMessages,
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_tool\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call_1\",\"name\":\"Bash\",\"input\":{}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\\\"git status\\\"}\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        )
        .expect("materialized payload");
        let body: Value = serde_json::from_str(&payload).expect("decode materialized payload");
        let content = body["content"].as_array().expect("content array");

        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"].as_str(), Some("tool_use"));
        assert_eq!(content[0]["input"], json!({ "command": "git status" }));
        assert_eq!(body["stop_reason"].as_str(), Some("tool_use"));
    }

    #[test]
    fn materialize_anthropic_stream_keeps_bad_tool_input_as_object() {
        let payload = materialize_stream_response(
            ProviderProtocol::AnthropicMessages,
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_tool_bad\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call_1\",\"name\":\"Bash\",\"input\":{}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"command\\\":\\\"git status\\\"\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        )
        .expect("materialized payload");
        let body: Value = serde_json::from_str(&payload).expect("decode materialized payload");
        let content = body["content"].as_array().expect("content array");

        assert_eq!(content[0]["type"].as_str(), Some("tool_use"));
        assert_eq!(
            content[0]["input"],
            json!({ "_raw": "{\"command\":\"git status\"" })
        );
    }

    #[test]
    fn materialize_anthropic_stream_preserves_thinking_blocks() {
        let payload = materialize_stream_response(
            ProviderProtocol::AnthropicMessages,
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_thinking\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"considering \"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"options\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig_123\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        )
        .expect("materialized payload");
        let body: Value = serde_json::from_str(&payload).expect("decode materialized payload");
        let content = body["content"].as_array().expect("content array");

        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"].as_str(), Some("thinking"));
        assert_eq!(content[0]["thinking"].as_str(), Some("considering options"));
        assert_eq!(content[0]["signature"].as_str(), Some("sig_123"));
    }

    #[test]
    fn materialize_anthropic_stream_preserves_redacted_thinking_blocks() {
        let payload = materialize_stream_response(
            ProviderProtocol::AnthropicMessages,
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_redacted\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"redacted_thinking\",\"data\":\"encrypted\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        )
        .expect("materialized payload");
        let body: Value = serde_json::from_str(&payload).expect("decode materialized payload");
        let content = body["content"].as_array().expect("content array");

        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"].as_str(), Some("redacted_thinking"));
        assert_eq!(content[0]["data"].as_str(), Some("encrypted"));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_maps_context_window_finish_to_max_tokens() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "test-model",
        )
        .expect("supported transformer");
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_context_limit\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"model_context_window_exceeded\"}],\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":0,\"total_tokens\":0}}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(joined.contains("\"stop_reason\":\"max_tokens\""));
        assert!(!joined.contains("\"stop_reason\":\"end_turn\""));
    }

    #[test]
    fn openai_responses_to_anthropic_stream_maps_context_window_reason_to_max_tokens() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_context_limit\",\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"context_length_exceeded\"},\"usage\":{\"input_tokens\":0,\"output_tokens\":0},\"output\":[]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"stop_reason\":\"max_tokens\""));
        assert!(!joined.contains("\"stop_reason\":\"end_turn\""));
    }

    #[test]
    fn openai_responses_to_anthropic_stream_falls_back_to_incomplete_status_for_unknown_reason() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_incomplete_unknown\",\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"vendor_specific_reason\"},\"usage\":{\"input_tokens\":0,\"output_tokens\":0},\"output\":[]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"stop_reason\":\"max_tokens\""));
        assert!(!joined.contains("\"stop_reason\":\"end_turn\""));
    }

    #[test]
    fn anthropic_to_openai_responses_emits_richer_stream_events() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiResponses,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        )
        .expect("supported transformer");
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
        assert!(joined.contains("\"item\":{"));
        assert!(joined.contains("\"role\":\"assistant\""));
        assert!(joined.contains("\"id\":\"out_123\""));
        assert!(joined.contains("\"status\":\"in_progress\""));
        assert!(joined.contains("\"type\":\"response.content_part.added\""));
        assert!(joined.contains("\"type\":\"response.output_text.delta\""));
        assert!(joined.contains(
            "\"content_index\":0,\"delta\":\"hello\",\"item_id\":\"out_123\",\"output_index\":0"
        ));
        assert!(joined.contains("\"type\":\"response.output_text.done\""));
        assert!(joined.contains("\"type\":\"response.content_part.done\""));
        assert!(joined.contains("\"type\":\"response.output_item.done\""));
        assert!(joined.contains("\"type\":\"response.completed\""));
        // The old custom event type must not come back.
        assert!(!joined.contains("\"type\":\"response.output_item.content_part.delta\""));
        assert!(joined.contains("\"output_text\":\"hello\""));
        assert!(joined.contains("\"input_tokens\":12"));
        assert!(joined.contains("\"cached_tokens\":1"));
        assert!(joined.contains("\"input_tokens_details\":{\"cached_tokens\":1}"));
    }

    #[test]
    fn anthropic_to_openai_responses_separates_multiple_text_and_reasoning_blocks() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiResponses,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_multi\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test-model\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_stop\n\
             data: {\"type\":\"content_block_stop\",\"index\":0}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"r1\"}}\n\n\
             event: content_block_stop\n\
             data: {\"type\":\"content_block_stop\",\"index\":1}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n\
             event: content_block_stop\n\
             data: {\"type\":\"content_block_stop\",\"index\":2}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":3,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":3,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"r2\"}}\n\n\
             event: content_block_stop\n\
             data: {\"type\":\"content_block_stop\",\"index\":3}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":4,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":4,\"delta\":{\"type\":\"text_delta\",\"text\":\"world\"}}\n\n\
             event: content_block_stop\n\
             data: {\"type\":\"content_block_stop\",\"index\":4}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":3,\"output_tokens\":4}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        );
        let events: Vec<Value> = chunks
            .iter()
            .filter_map(|chunk| chunk.strip_prefix("data: "))
            .filter_map(|payload| serde_json::from_str(payload.trim()).ok())
            .collect();

        let added: Vec<&Value> = events
            .iter()
            .filter(|event| event["type"] == "response.output_item.added")
            .collect();
        let item_types: Vec<&str> = added
            .iter()
            .map(|event| event["item"]["type"].as_str().unwrap_or_default())
            .collect();
        assert_eq!(
            item_types,
            ["reasoning", "message", "reasoning", "message"],
            "the empty text block must not allocate an item"
        );
        let indices: Vec<u64> = added
            .iter()
            .map(|event| event["output_index"].as_u64().unwrap())
            .collect();
        assert_eq!(indices, [0, 1, 2, 3]);

        let text_delta_ids: Vec<&str> = events
            .iter()
            .filter(|event| event["type"] == "response.output_text.delta")
            .map(|event| event["item_id"].as_str().unwrap())
            .collect();
        assert_eq!(text_delta_ids.len(), 2);
        assert_ne!(text_delta_ids[0], text_delta_ids[1]);
        // Each text delta targets an item that is still open (no delta after
        // its item's `output_item.done`).
        assert_eq!(
            events
                .iter()
                .filter(|event| event["type"] == "response.output_item.done")
                .count(),
            4
        );

        let completed = events
            .iter()
            .rev()
            .find(|event| event["type"] == "response.completed")
            .expect("completed event");
        let output = completed["response"]["output"].as_array().expect("output");
        assert_eq!(output.len(), 4);
        assert_eq!(output[0]["type"], "reasoning");
        assert_eq!(output[0]["summary"][0]["text"], "r1");
        assert_eq!(output[1]["type"], "message");
        assert_eq!(output[1]["content"][0]["text"], "hello");
        assert_eq!(output[2]["type"], "reasoning");
        assert_eq!(output[2]["summary"][0]["text"], "r2");
        assert_eq!(output[3]["type"], "message");
        assert_eq!(output[3]["content"][0]["text"], "world");
        assert_eq!(completed["output_text"], "helloworld");
        assert!(completed["response"]["created_at"].is_i64());
        assert!(completed["response"].get("created").is_none());

        let created = events
            .iter()
            .find(|event| event["type"] == "response.created")
            .expect("created event");
        assert!(created["response"]["created_at"].is_i64());
        assert!(created["response"].get("created").is_none());
    }

    #[test]
    fn anthropic_to_openai_responses_preserves_reasoning_content_on_completion() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiResponses,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_reason\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"test-model\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"considering options\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"reasoning_content\":\"considering options\""));
        assert!(joined.contains("\"type\":\"reasoning\""));
        assert!(joined.contains("\"summary_text\""));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_can_suppress_reasoning_content() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "test-model",
        )
        .expect("supported transformer")
        .with_anthropic_reasoning(false);
        let chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"hidden reasoning\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("event: message_start"));
        assert!(joined.contains("\"text\":\"hello\",\"type\":\"text_delta\""));
        assert!(!joined.contains("\"type\":\"thinking\""));
        assert!(!joined.contains("hidden reasoning"));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_falls_back_when_only_reasoning_is_suppressed() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "test-model",
        )
        .expect("supported transformer")
        .with_anthropic_reasoning(false);
        let mut chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"I should create the HTML file now.\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4}}\n\n",
        );
        chunks.extend(transformer.finish());
        let joined = chunks.join("");

        assert!(joined.contains("event: message_start"));
        assert!(joined.contains("\"text\":\"\",\"type\":\"text\""));
        assert!(
            joined.contains(
                "\"text\":\"I should create the HTML file now.\",\"type\":\"text_delta\""
            )
        );
        assert!(!joined.contains("\"type\":\"thinking\""));
    }

    #[test]
    fn openai_chat_to_anthropic_stream_can_disable_suppressed_reasoning_fallback() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiChatCompletions,
            "test-model",
        )
        .expect("supported transformer")
        .with_anthropic_reasoning(false)
        .with_anthropic_reasoning_fallback(false);
        let chunks = transformer.push(
            "data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"classifier scratchpad\"}}]}\n\n\
             data: {\"id\":\"chatcmpl_reason\",\"choices\":[{\"index\":0,\"finish_reason\":\"stop\"}]}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("event: message_start"));
        assert!(!joined.contains("classifier scratchpad"));
        assert!(!joined.contains("\"type\":\"thinking\""));
        assert!(!joined.contains("\"type\":\"text_delta\""));
    }

    #[test]
    fn openai_responses_to_anthropic_reconciles_reasoning_output_items() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer");
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_reason\"}}\n\n\
             data: {\"type\":\"response.completed\",\"status\":\"completed\",\"response\":{\"id\":\"resp_reason\",\"status\":\"completed\",\"usage\":{\"input_tokens\":8,\"output_tokens\":1},\"output\":[{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"considering options\"}]},{\"id\":\"out_1\",\"type\":\"output_message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"done\"}]}]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(
            joined.contains("\"thinking\":\"considering options\",\"type\":\"thinking_delta\"")
        );
        assert!(joined.contains("\"text\":\"done\",\"type\":\"text_delta\""));
    }

    #[test]
    fn openai_responses_to_anthropic_stream_can_suppress_reasoning_items() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::AnthropicMessages,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        )
        .expect("supported transformer")
        .with_anthropic_reasoning(false);
        let chunks = transformer.push(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_reason\"}}\n\n\
             data: {\"type\":\"response.completed\",\"status\":\"completed\",\"response\":{\"id\":\"resp_reason\",\"status\":\"completed\",\"usage\":{\"input_tokens\":8,\"output_tokens\":1},\"output\":[{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"hidden reasoning\"}]},{\"id\":\"out_1\",\"type\":\"output_message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"done\"}]}]}}\n\n",
        );
        let joined = chunks.join("");

        assert!(joined.contains("\"text\":\"done\",\"type\":\"text_delta\""));
        assert!(!joined.contains("\"type\":\"thinking\""));
        assert!(!joined.contains("hidden reasoning"));
    }

    #[test]
    fn anthropic_to_openai_responses_tool_use_completes_function_call_item() {
        let mut transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiResponses,
            ProviderProtocol::AnthropicMessages,
            "test-model",
        )
        .expect("supported transformer");
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
        assert!(joined.contains("\"type\":\"response.function_call_arguments.done\""));
        assert!(joined.contains("\"item_id\":\"tool_1\""));
        assert!(joined.contains("\"output_index\":0"));
        assert!(joined.contains("\"status\":\"completed\""));
        assert!(joined.contains("\"type\":\"function_call\""));
        assert!(joined.contains("\"call_id\":\"tool_1\""));
        assert!(joined.contains("\"name\":\"weather\""));
        assert!(joined.contains("\"arguments\":\"{\\\"city\\\":\\\"Paris\\\"}\""));
        assert!(!joined.contains("\"status\":\"requires_action\""));
        assert!(joined.contains("\"type\":\"response.completed\""));
    }

    #[test]
    fn materialize_anthropic_stream_returns_offline_message() {
        let payload = materialize_stream_response(
            ProviderProtocol::AnthropicMessages,
            "event: message_start\n\
             data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_stream\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-test\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":0,\"output_tokens\":0}}}\n\n\
             event: content_block_start\n\
             data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
             event: content_block_delta\n\
             data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n\
             event: message_delta\n\
             data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":11,\"output_tokens\":2,\"cache_read_input_tokens\":1}}\n\n\
             event: message_stop\n\
             data: {\"type\":\"message_stop\"}\n\n",
        )
        .expect("materialized payload");

        assert!(payload.contains("\"type\":\"message\""));
        assert!(payload.contains("\"text\":\"hello\""));
        assert!(payload.contains("\"stop_reason\":\"end_turn\""));
        assert!(!payload.contains("event:"));
        assert!(!payload.contains("data:"));
    }

    #[test]
    fn materialize_openai_responses_stream_returns_offline_response() {
        let payload = materialize_stream_response(
            ProviderProtocol::OpenAiResponses,
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_123\",\"object\":\"response\",\"created\":1,\"status\":\"in_progress\",\"model\":\"test-model\"}}\n\n\
             data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n\
             data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_123\",\"object\":\"response\",\"created\":1,\"model\":\"test-model\",\"status\":\"completed\",\"output\":[{\"id\":\"out_1\",\"type\":\"output_message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello\"}]}],\"usage\":{\"input_tokens\":10,\"output_tokens\":4}}}\n\n\
             data: [DONE]\n\n",
        )
        .expect("materialized payload");

        assert!(payload.contains("\"object\":\"response\""));
        assert!(payload.contains("\"text\":\"hello\""));
        assert!(!payload.contains("response.output_text.delta"));
        assert!(!payload.contains("data:"));
    }

    #[test]
    fn materialize_openai_chat_stream_reads_delta_nested_usage() {
        // GLM-style upstreams nest usage in choices[0].delta.usage; the
        // materialized non-streaming response must still carry it.
        let payload = materialize_stream_response(
            ProviderProtocol::OpenAiChatCompletions,
            "data: {\"id\":\"chatcmpl_gl\",\"created\":1,\"model\":\"glm-test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hi\"},\"finish_reason\":null}]}\n\n\
             data: {\"id\":\"chatcmpl_gl\",\"created\":1,\"model\":\"glm-test\",\"choices\":[{\"index\":0,\"delta\":{\"usage\":{\"prompt_tokens\":41,\"completion_tokens\":7,\"total_tokens\":48}},\"finish_reason\":\"stop\"}]}\n\n\
             data: [DONE]\n\n",
        )
        .expect("materialized payload");

        let parsed: Value = serde_json::from_str(&payload).expect("valid json");
        let usage = parsed.get("usage").expect("usage object present");
        assert_eq!(usage.get("prompt_tokens").and_then(Value::as_i64), Some(41));
        assert_eq!(
            usage.get("completion_tokens").and_then(Value::as_i64),
            Some(7)
        );
        assert!(payload.contains("\"text\":\"hi\"") || payload.contains("\"content\":\"hi\""));
    }

    #[test]
    fn materialize_openai_chat_stream_keeps_reasoning_refusal_and_legacy_function_call() {
        let payload = materialize_stream_response(
            ProviderProtocol::OpenAiChatCompletions,
            "data: {\"id\":\"chatcmpl_legacy\",\"created\":1,\"model\":\"glm-test\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning\":\"think\",\"refusal\":\"no\"},\"finish_reason\":null}]}\n\n\
             data: {\"id\":\"chatcmpl_legacy\",\"created\":1,\"model\":\"glm-test\",\"choices\":[{\"index\":0,\"delta\":{\"function_call\":{\"name\":\"weather\",\"arguments\":\"{\\\"city\\\":\"}},\"finish_reason\":null}]}\n\n\
             data: {\"id\":\"chatcmpl_legacy\",\"created\":1,\"model\":\"glm-test\",\"choices\":[{\"index\":0,\"delta\":{\"function_call\":{\"arguments\":\"\\\"Paris\\\"}\"}},\"finish_reason\":\"stop\"}]}\n\n\
             data: {\"id\":\"chatcmpl_legacy\",\"created\":1,\"model\":\"glm-test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":2,\"total_tokens\":6}}\n\n\
             data: [DONE]\n\n",
        )
        .expect("materialized payload");
        let parsed: Value = serde_json::from_str(&payload).expect("valid json");
        let message = &parsed["choices"][0]["message"];
        assert_eq!(message["reasoning_content"], "think");
        assert_eq!(message["refusal"], "no");
        assert_eq!(message["content"], Value::Null);
        let tool_call = &message["tool_calls"][0];
        assert!(tool_call["id"].as_str().is_some_and(|id| !id.is_empty()));
        assert_eq!(tool_call["function"]["name"], "weather");
        assert_eq!(tool_call["function"]["arguments"], "{\"city\":\"Paris\"}");
        assert_eq!(parsed["choices"][0]["finish_reason"], "stop");
    }

    #[test]
    fn materialize_openai_chat_stream_fills_missing_tool_call_ids() {
        let payload = materialize_stream_response(
            ProviderProtocol::OpenAiChatCompletions,
            "data: {\"id\":\"chatcmpl_null_id\",\"created\":1,\"model\":\"glm-test\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":null,\"type\":\"function\",\"function\":{\"name\":\"weather\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n\
             data: [DONE]\n\n",
        )
        .expect("materialized payload");
        let parsed: Value = serde_json::from_str(&payload).expect("valid json");
        let tool_call = &parsed["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(tool_call["id"], "call_0");
    }

    #[test]
    fn unsupported_stream_transformer_returns_error() {
        let transformer = CrossProtocolStreamTransformer::new(
            ProviderProtocol::OpenAiChatCompletions,
            ProviderProtocol::OpenAiResponses,
            "test-model",
        );

        assert_eq!(
            transformer.err(),
            Some("unsupported streaming cross-protocol conversion")
        );
    }
}
