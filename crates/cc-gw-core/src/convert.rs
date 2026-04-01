use serde_json::{Map, Value, json};

fn openai_cache_usage(usage: &Value) -> (Option<i64>, Option<i64>, i64) {
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
        .and_then(Value::as_i64);
    let cache_creation_tokens = usage
        .get("cache_creation_input_tokens")
        .or_else(|| usage.get("cache_creation_tokens"))
        .and_then(Value::as_i64);
    let cached_tokens = cache_read_tokens.unwrap_or(0) + cache_creation_tokens.unwrap_or(0);
    (cache_read_tokens, cache_creation_tokens, cached_tokens)
}

fn extract_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(extract_text)
            .filter(|part| !part.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                return text.to_string();
            }
            if let Some(text) = map.get("content").and_then(Value::as_str) {
                return text.to_string();
            }
            if let Some(text) = map.get("output_text").and_then(Value::as_str) {
                return text.to_string();
            }
            if let Some(text) = map.get("reasoning_content").and_then(Value::as_str) {
                return text.to_string();
            }
            if let Some(content) = map.get("content") {
                return extract_text(content);
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn parse_json_string(input: &str) -> Value {
    serde_json::from_str(input).unwrap_or_else(|_| Value::String(input.to_string()))
}

fn stringify_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn anthropic_tool_choice_to_openai(value: Option<&Value>) -> Option<Value> {
    let tool_choice = value?;
    match tool_choice {
        Value::String(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "auto" => Some(Value::String("auto".to_string())),
            "none" => Some(Value::String("none".to_string())),
            "required" | "any" => Some(Value::String("required".to_string())),
            _ => None,
        },
        Value::Object(map) => {
            let kind = map
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            match kind.as_str() {
                "auto" => Some(Value::String("auto".to_string())),
                "none" => Some(Value::String("none".to_string())),
                "required" | "any" => Some(Value::String("required".to_string())),
                "tool" => map
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(|name| {
                        json!({
                            "type": "function",
                            "function": { "name": name }
                        })
                    }),
                _ => None,
            }
        }
        _ => None,
    }
}

fn openai_tools_to_anthropic(value: Option<&Value>) -> Option<Value> {
    let tools = value?.as_array()?;
    let mapped = tools
        .iter()
        .filter_map(|tool| {
            let object = tool.as_object()?;
            let function = object.get("function").unwrap_or(tool);
            Some(json!({
                "type": "tool",
                "name": function.get("name").and_then(Value::as_str).unwrap_or("tool"),
                "description": function.get("description").cloned().unwrap_or(Value::Null),
                "input_schema": function.get("parameters").cloned().unwrap_or_else(|| json!({}))
            }))
        })
        .collect::<Vec<_>>();

    if mapped.is_empty() {
        None
    } else {
        Some(Value::Array(mapped))
    }
}

fn anthropic_tools_to_openai(value: Option<&Value>) -> Option<Value> {
    let tools = value?.as_array()?;
    let mapped = tools
        .iter()
        .filter_map(|tool| {
            let object = tool.as_object()?;
            Some(json!({
                "type": "function",
                "function": {
                    "name": object.get("name").and_then(Value::as_str).unwrap_or("tool"),
                    "description": object.get("description").cloned().unwrap_or(Value::Null),
                    "parameters": object.get("input_schema").cloned().unwrap_or_else(|| json!({}))
                }
            }))
        })
        .collect::<Vec<_>>();

    if mapped.is_empty() {
        None
    } else {
        Some(Value::Array(mapped))
    }
}

pub fn anthropic_request_to_openai_chat(body: &Value) -> Value {
    let mut messages = Vec::<Value>::new();

    let system = body.get("system").map(extract_text).unwrap_or_default();
    if !system.trim().is_empty() {
        messages.push(json!({
            "role": "system",
            "content": system
        }));
    }

    for message in body
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        let content_blocks = message
            .get("content")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        match role {
            "user" => {
                let mut text_parts = Vec::new();
                let mut tool_results = Vec::new();

                for block in &content_blocks {
                    let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                    match block_type {
                        "text" | "input_text" => {
                            let text = extract_text(block);
                            if !text.is_empty() {
                                text_parts.push(text);
                            }
                        }
                        "tool_result" => {
                            tool_results.push(json!({
                                "role": "tool",
                                "tool_call_id": block.get("tool_use_id").cloned().unwrap_or(Value::String("tool_result".to_string())),
                                "name": block.get("name").cloned().unwrap_or(Value::Null),
                                "content": block.get("content").map(stringify_value).unwrap_or_default()
                            }));
                        }
                        _ => {}
                    }
                }

                messages.extend(tool_results);
                let user_text = text_parts.join("\n");
                if !user_text.trim().is_empty() || content_blocks.is_empty() {
                    messages.push(json!({
                        "role": "user",
                        "content": user_text
                    }));
                }
            }
            "assistant" => {
                let mut text_parts = Vec::new();
                let mut tool_calls = Vec::new();

                for block in &content_blocks {
                    let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                    match block_type {
                        "text" | "output_text" => {
                            let text = extract_text(block);
                            if !text.is_empty() {
                                text_parts.push(text);
                            }
                        }
                        "tool_use" => {
                            tool_calls.push(json!({
                                "id": block.get("id").cloned().unwrap_or(Value::String("tool_call".to_string())),
                                "type": "function",
                                "function": {
                                    "name": block.get("name").cloned().unwrap_or(Value::String("tool".to_string())),
                                    "arguments": serde_json::to_string(block.get("input").unwrap_or(&json!({}))).unwrap_or_else(|_| "{}".to_string())
                                }
                            }));
                        }
                        _ => {}
                    }
                }

                let content = if text_parts.is_empty() {
                    Value::Null
                } else {
                    Value::String(text_parts.join("\n"))
                };

                let mut assistant = Map::new();
                assistant.insert("role".to_string(), Value::String("assistant".to_string()));
                assistant.insert("content".to_string(), content);
                if !tool_calls.is_empty() {
                    assistant.insert("tool_calls".to_string(), Value::Array(tool_calls));
                }
                messages.push(Value::Object(assistant));
            }
            _ => {}
        }
    }

    let mut result = Map::new();
    result.insert("messages".to_string(), Value::Array(messages));
    if let Some(max_tokens) = body.get("max_tokens").cloned() {
        let token_key = if body
            .get("thinking")
            .is_some_and(|value| !matches!(value, Value::Null | Value::Bool(false)))
        {
            "max_completion_tokens"
        } else {
            "max_tokens"
        };
        result.insert(token_key.to_string(), max_tokens);
    }
    if let Some(temperature) = body.get("temperature").cloned() {
        result.insert("temperature".to_string(), temperature);
    }
    if let Some(stream) = body.get("stream").cloned() {
        result.insert("stream".to_string(), stream);
    }
    if let Some(tool_choice) = anthropic_tool_choice_to_openai(body.get("tool_choice")) {
        result.insert("tool_choice".to_string(), tool_choice);
    }
    if let Some(tools) = anthropic_tools_to_openai(body.get("tools")) {
        result.insert("tools".to_string(), tools);
    }
    if let Some(stop) = body
        .get("stop")
        .cloned()
        .or_else(|| body.get("stop_sequences").cloned())
    {
        result.insert("stop".to_string(), stop);
    }
    for key in [
        "metadata",
        "response_format",
        "parallel_tool_calls",
        "frequency_penalty",
        "presence_penalty",
        "logit_bias",
        "top_p",
        "top_k",
        "user",
        "seed",
        "n",
        "options",
    ] {
        if let Some(value) = body.get(key).cloned() {
            result.insert(key.to_string(), value);
        }
    }
    Value::Object(result)
}

pub fn openai_chat_request_to_anthropic(body: &Value) -> Value {
    let mut system_parts = Vec::new();
    let mut messages = Vec::<Value>::new();

    for message in body
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");

        match role {
            "system" | "developer" => {
                let text = message.get("content").map(extract_text).unwrap_or_default();
                if !text.trim().is_empty() {
                    system_parts.push(text);
                }
            }
            "tool" => {
                let content = message.get("content").map(extract_text).unwrap_or_default();
                messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": message.get("tool_call_id").cloned().unwrap_or(Value::String("tool_result".to_string())),
                        "content": [{ "type": "text", "text": content }]
                    }]
                }));
            }
            "assistant" => {
                let mut blocks = Vec::<Value>::new();
                let text = message.get("content").map(extract_text).unwrap_or_default();
                if !text.trim().is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }

                for tool_call in message
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let arguments = tool_call
                        .get("function")
                        .and_then(|value| value.get("arguments"))
                        .and_then(Value::as_str)
                        .map(parse_json_string)
                        .unwrap_or_else(|| json!({}));
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": tool_call.get("id").cloned().unwrap_or(Value::String("tool_call".to_string())),
                        "name": tool_call.get("function").and_then(|value| value.get("name")).cloned().unwrap_or(Value::String("tool".to_string())),
                        "input": arguments
                    }));
                }

                messages.push(json!({
                    "role": "assistant",
                    "content": blocks
                }));
            }
            _ => {
                let text = message.get("content").map(extract_text).unwrap_or_default();
                messages.push(json!({
                    "role": "user",
                    "content": [{ "type": "text", "text": text }]
                }));
            }
        }
    }

    let mut result = Map::new();
    if !system_parts.is_empty() {
        result.insert(
            "system".to_string(),
            Value::String(system_parts.join("\n\n")),
        );
    }
    result.insert("messages".to_string(), Value::Array(messages));
    if let Some(max_tokens) = body
        .get("max_output_tokens")
        .cloned()
        .or_else(|| body.get("max_tokens").cloned())
    {
        result.insert("max_tokens".to_string(), max_tokens);
    }
    if let Some(temperature) = body.get("temperature").cloned() {
        result.insert("temperature".to_string(), temperature);
    }
    if let Some(stream) = body.get("stream").cloned() {
        result.insert("stream".to_string(), stream);
    }
    if let Some(metadata) = body.get("metadata").cloned() {
        result.insert("metadata".to_string(), metadata);
    }
    if let Some(tools) = openai_tools_to_anthropic(body.get("tools")) {
        result.insert("tools".to_string(), tools);
    }
    Value::Object(result)
}

pub fn openai_responses_request_to_anthropic(body: &Value) -> Value {
    let mut system_parts = Vec::new();
    let mut messages = Vec::<Value>::new();

    for item in body
        .get("input")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(text) = item.as_str() {
            messages.push(json!({
                "role": "user",
                "content": [{ "type": "text", "text": text }]
            }));
            continue;
        }

        let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
        if matches!(role, "system" | "developer") {
            let text = item.get("content").map(extract_text).unwrap_or_default();
            if !text.trim().is_empty() {
                system_parts.push(text);
            }
            continue;
        }

        if role == "assistant" {
            let mut blocks = Vec::<Value>::new();
            let text = item.get("content").map(extract_text).unwrap_or_default();
            if !text.trim().is_empty() {
                blocks.push(json!({ "type": "text", "text": text }));
            }
            for tool_call in item
                .get("tool_calls")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let arguments = tool_call
                    .get("function")
                    .and_then(|value| value.get("arguments"))
                    .and_then(Value::as_str)
                    .map(parse_json_string)
                    .unwrap_or_else(|| json!({}));
                blocks.push(json!({
                    "type": "tool_use",
                    "id": tool_call.get("id").cloned().unwrap_or(Value::String("tool_call".to_string())),
                    "name": tool_call.get("function").and_then(|value| value.get("name")).cloned().unwrap_or(Value::String("tool".to_string())),
                    "input": arguments
                }));
            }
            messages.push(json!({
                "role": "assistant",
                "content": blocks
            }));
            continue;
        }

        messages.push(json!({
            "role": "user",
            "content": [{ "type": "text", "text": item.get("content").map(extract_text).unwrap_or_default() }]
        }));
    }

    if let Some(instructions) = body.get("instructions") {
        let text = extract_text(instructions);
        if !text.trim().is_empty() {
            system_parts.push(text);
        }
    }

    let mut result = Map::new();
    if !system_parts.is_empty() {
        result.insert(
            "system".to_string(),
            Value::String(system_parts.join("\n\n")),
        );
    }
    result.insert("messages".to_string(), Value::Array(messages));
    if let Some(max_tokens) = body
        .get("max_output_tokens")
        .cloned()
        .or_else(|| body.get("max_tokens").cloned())
    {
        result.insert("max_tokens".to_string(), max_tokens);
    }
    if let Some(temperature) = body.get("temperature").cloned() {
        result.insert("temperature".to_string(), temperature);
    }
    if let Some(stream) = body.get("stream").cloned() {
        result.insert("stream".to_string(), stream);
    }
    if let Some(metadata) = body.get("metadata").cloned() {
        result.insert("metadata".to_string(), metadata);
    }
    if let Some(tools) = openai_tools_to_anthropic(body.get("tools")) {
        result.insert("tools".to_string(), tools);
    }
    Value::Object(result)
}

fn map_openai_finish_to_anthropic(reason: Option<&str>) -> Option<&'static str> {
    match reason {
        Some("stop") => Some("end_turn"),
        Some("tool_calls") => Some("tool_use"),
        Some("length") => Some("max_tokens"),
        _ => None,
    }
}

fn map_anthropic_stop_to_openai_chat(reason: Option<&str>) -> Option<&'static str> {
    match reason {
        Some("tool_use") => Some("tool_calls"),
        Some("max_tokens") => Some("length"),
        Some("stop_sequence") | Some("end_turn") | Some("stop") => Some("stop"),
        _ => None,
    }
}

fn map_anthropic_stop_to_openai_status(reason: Option<&str>) -> &'static str {
    match reason {
        Some("tool_use") => "requires_action",
        Some("max_tokens") | Some("stop_sequence") => "incomplete",
        _ => "completed",
    }
}

pub fn openai_chat_response_to_anthropic(body: &Value, model: &str) -> Value {
    let choice = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let message = choice
        .get("message")
        .cloned()
        .or_else(|| choice.get("delta").cloned())
        .unwrap_or_else(|| json!({}));

    let mut content = Vec::<Value>::new();
    let text = message.get("content").map(extract_text).unwrap_or_default();
    if !text.trim().is_empty() {
        content.push(json!({ "type": "text", "text": text }));
    }
    for tool_call in message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let arguments = tool_call
            .get("function")
            .and_then(|value| value.get("arguments"))
            .and_then(Value::as_str)
            .map(parse_json_string)
            .unwrap_or_else(|| json!({}));
        content.push(json!({
            "type": "tool_use",
            "id": tool_call.get("id").cloned().unwrap_or(Value::String("tool".to_string())),
            "name": tool_call.get("function").and_then(|value| value.get("name")).cloned().unwrap_or(Value::String("tool".to_string())),
            "input": arguments
        }));
    }

    let usage = body.get("usage").cloned().unwrap_or_else(|| json!({}));
    let metadata = body.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let (cache_read_tokens, cache_creation_tokens, _) = openai_cache_usage(&usage);
    let mut anthropic_usage = Map::new();
    anthropic_usage.insert(
        "input_tokens".to_string(),
        Value::from(
            usage
                .get("prompt_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        ),
    );
    anthropic_usage.insert(
        "output_tokens".to_string(),
        Value::from(
            usage
                .get("completion_tokens")
                .and_then(Value::as_i64)
                .unwrap_or(0),
        ),
    );
    if let Some(value) = cache_read_tokens {
        anthropic_usage.insert("cache_read_input_tokens".to_string(), Value::from(value));
    }
    if let Some(value) = cache_creation_tokens {
        anthropic_usage.insert(
            "cache_creation_input_tokens".to_string(),
            Value::from(value),
        );
    }

    json!({
        "id": body.get("id").and_then(Value::as_str).map(|id| id.replace("chatcmpl", "msg")).unwrap_or_else(|| "msg_generated".to_string()),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": map_openai_finish_to_anthropic(choice.get("finish_reason").and_then(Value::as_str)),
        "stop_sequence": Value::Null,
        "usage": anthropic_usage,
        "metadata": metadata
    })
}

pub fn openai_responses_response_to_anthropic(body: &Value, model: &str) -> Value {
    let mut content = Vec::<Value>::new();

    if let Some(output) = body.get("output").and_then(Value::as_array) {
        for item in output {
            for block in item
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                match block_type {
                    "output_text" | "text" => {
                        let text = extract_text(block);
                        if !text.trim().is_empty() {
                            content.push(json!({ "type": "text", "text": text }));
                        }
                    }
                    "tool_use" | "function_call" => {
                        let input = block
                            .get("input")
                            .cloned()
                            .or_else(|| {
                                block
                                    .get("arguments")
                                    .and_then(Value::as_str)
                                    .map(parse_json_string)
                            })
                            .unwrap_or_else(|| json!({}));
                        content.push(json!({
                            "type": "tool_use",
                            "id": block.get("id").or_else(|| block.get("call_id")).cloned().unwrap_or(Value::String("tool".to_string())),
                            "name": block.get("name").cloned().unwrap_or(Value::String("tool".to_string())),
                            "input": input
                        }));
                    }
                    _ => {}
                }
            }
        }
    }

    if content.is_empty() {
        let text = body
            .get("output_text")
            .map(extract_text)
            .or_else(|| body.get("response").map(extract_text))
            .unwrap_or_default();
        if !text.trim().is_empty() {
            content.push(json!({ "type": "text", "text": text }));
        }
    }

    let usage = body.get("usage").cloned().unwrap_or_else(|| json!({}));
    let metadata = body.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let status = body.get("status").and_then(Value::as_str);
    let stop_reason = match status {
        Some("requires_action") => Some("tool_use"),
        Some("incomplete") => Some("max_tokens"),
        _ => Some("end_turn"),
    };

    let (cache_read_tokens, cache_creation_tokens, _) = openai_cache_usage(&usage);
    let mut anthropic_usage = Map::new();
    anthropic_usage.insert(
        "input_tokens".to_string(),
        Value::from(
            usage
                .get("input_tokens")
                .or_else(|| usage.get("prompt_tokens"))
                .and_then(Value::as_i64)
                .unwrap_or(0),
        ),
    );
    anthropic_usage.insert(
        "output_tokens".to_string(),
        Value::from(
            usage
                .get("output_tokens")
                .or_else(|| usage.get("completion_tokens"))
                .and_then(Value::as_i64)
                .unwrap_or(0),
        ),
    );
    if let Some(value) = cache_read_tokens {
        anthropic_usage.insert("cache_read_input_tokens".to_string(), Value::from(value));
    }
    if let Some(value) = cache_creation_tokens {
        anthropic_usage.insert(
            "cache_creation_input_tokens".to_string(),
            Value::from(value),
        );
    }

    json!({
        "id": body.get("id").and_then(Value::as_str).map(|id| id.replace("resp_", "msg_")).unwrap_or_else(|| "msg_generated".to_string()),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": Value::Null,
        "usage": anthropic_usage,
        "metadata": metadata
    })
}

pub fn anthropic_response_to_openai_chat(body: &Value, model: &str) -> Value {
    let mut content = String::new();
    let mut tool_calls = Vec::<Value>::new();
    for block in body
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match block.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => {
                let text = extract_text(block);
                if !text.is_empty() {
                    if !content.is_empty() {
                        content.push('\n');
                    }
                    content.push_str(&text);
                }
            }
            "tool_use" => {
                tool_calls.push(json!({
                    "id": block.get("id").cloned().unwrap_or(Value::String("call".to_string())),
                    "type": "function",
                    "function": {
                        "name": block.get("name").cloned().unwrap_or(Value::String("tool".to_string())),
                        "arguments": serde_json::to_string(block.get("input").unwrap_or(&json!({}))).unwrap_or_else(|_| "{}".to_string())
                    }
                }));
            }
            _ => {}
        }
    }

    let usage = body.get("usage").cloned().unwrap_or_else(|| json!({}));
    let mut message = Map::new();
    message.insert("role".to_string(), Value::String("assistant".to_string()));
    if content.is_empty() && !tool_calls.is_empty() {
        message.insert("content".to_string(), Value::Null);
    } else {
        message.insert("content".to_string(), Value::String(content));
    }
    if !tool_calls.is_empty() {
        message.insert("tool_calls".to_string(), Value::Array(tool_calls));
    }

    let cache_read_tokens = usage
        .get("cache_read_input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_creation_tokens = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cached_tokens = cache_read_tokens + cache_creation_tokens;

    json!({
        "id": body.get("id").and_then(Value::as_str).map(|id| id.replace("msg_", "chatcmpl_")).unwrap_or_else(|| "chatcmpl_generated".to_string()),
        "object": "chat.completion",
        "created": chrono::Utc::now().timestamp(),
        "model": model,
        "choices": [{
            "index": 0,
            "finish_reason": map_anthropic_stop_to_openai_chat(body.get("stop_reason").and_then(Value::as_str)),
            "message": Value::Object(message)
        }],
        "usage": {
            "prompt_tokens": usage.get("input_tokens").and_then(Value::as_i64).unwrap_or(0),
            "completion_tokens": usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "total_tokens": usage.get("input_tokens").and_then(Value::as_i64).unwrap_or(0) + usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "cached_tokens": if cached_tokens > 0 { Some(cached_tokens) } else { None }
        }
    })
}

pub fn anthropic_response_to_openai_response(body: &Value, model: &str) -> Value {
    let mut output_content = Vec::<Value>::new();
    let mut output_text = String::new();
    for block in body
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match block.get("type").and_then(Value::as_str).unwrap_or("") {
            "text" => {
                let text = extract_text(block);
                if !text.is_empty() {
                    output_content.push(json!({
                        "type": "output_text",
                        "text": text
                    }));
                    if !output_text.is_empty() {
                        output_text.push('\n');
                    }
                    output_text.push_str(&text);
                }
            }
            "tool_use" => {
                let arguments = serde_json::to_string(block.get("input").unwrap_or(&json!({})))
                    .unwrap_or_else(|_| "{}".to_string());
                output_content.push(json!({
                    "type": "function_call",
                    "id": block.get("id").cloned().unwrap_or(Value::String("tool".to_string())),
                    "call_id": block.get("id").cloned().unwrap_or(Value::String("tool".to_string())),
                    "name": block.get("name").cloned().unwrap_or(Value::String("tool".to_string())),
                    "arguments": arguments
                }));
            }
            _ => {}
        }
    }

    let usage = body.get("usage").cloned().unwrap_or_else(|| json!({}));
    let cache_read_tokens = usage
        .get("cache_read_input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_creation_tokens = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cached_tokens = cache_read_tokens + cache_creation_tokens;

    json!({
        "id": body.get("id").and_then(Value::as_str).map(|id| id.replace("msg_", "resp_")).unwrap_or_else(|| "resp_generated".to_string()),
        "object": "response",
        "created": chrono::Utc::now().timestamp(),
        "model": model,
        "status": map_anthropic_stop_to_openai_status(body.get("stop_reason").and_then(Value::as_str)),
        "output": [{
            "id": "out_1",
            "type": "output_message",
            "role": "assistant",
            "content": output_content
        }],
        "response": {
            "id": body.get("id").and_then(Value::as_str).unwrap_or("resp_generated"),
            "type": "message",
            "role": "assistant",
            "content": body.get("content").cloned().unwrap_or_else(|| Value::Array(Vec::new()))
        },
        "output_text": output_text,
        "usage": {
            "input_tokens": usage.get("input_tokens").and_then(Value::as_i64).unwrap_or(0),
            "output_tokens": usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "total_tokens": usage.get("input_tokens").and_then(Value::as_i64).unwrap_or(0) + usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "prompt_tokens": usage.get("input_tokens").and_then(Value::as_i64).unwrap_or(0),
            "completion_tokens": usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "cached_tokens": if cached_tokens > 0 { Some(cached_tokens) } else { None }
        },
        "stop_reason": body.get("stop_reason").cloned().unwrap_or(Value::Null),
        "stop_sequence": body.get("stop_sequence").cloned().unwrap_or(Value::Null)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_request_to_openai_chat_preserves_metadata_and_tool_choice() {
        let converted = anthropic_request_to_openai_chat(&json!({
            "system": "You are helpful.",
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }],
            "max_tokens": 256,
            "thinking": { "type": "enabled" },
            "tool_choice": { "type": "tool", "name": "lookup" },
            "metadata": { "user_id": "u-1" }
        }));

        assert_eq!(
            converted
                .get("max_completion_tokens")
                .and_then(Value::as_i64),
            Some(256)
        );
        assert!(converted.get("max_tokens").is_none());
        assert_eq!(
            converted.get("metadata"),
            Some(&json!({ "user_id": "u-1" }))
        );
        assert_eq!(
            converted.get("tool_choice"),
            Some(&json!({
                "type": "function",
                "function": { "name": "lookup" }
            }))
        );
    }

    #[test]
    fn anthropic_request_to_openai_chat_maps_required_tool_choice_without_downgrading() {
        let converted = anthropic_request_to_openai_chat(&json!({
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }],
            "tool_choice": { "type": "any" }
        }));

        assert_eq!(converted.get("tool_choice"), Some(&json!("required")));
    }

    #[test]
    fn anthropic_request_to_openai_chat_maps_stop_sequences_to_stop() {
        let converted = anthropic_request_to_openai_chat(&json!({
            "messages": [{
                "role": "user",
                "content": [{ "type": "text", "text": "hello" }]
            }],
            "stop_sequences": ["END"]
        }));

        assert_eq!(converted.get("stop"), Some(&json!(["END"])));
        assert!(converted.get("stop_sequences").is_none());
    }

    #[test]
    fn openai_chat_request_to_anthropic_preserves_metadata() {
        let converted = openai_chat_request_to_anthropic(&json!({
            "messages": [{ "role": "user", "content": "hello" }],
            "metadata": { "user_id": "u-2" }
        }));

        assert_eq!(
            converted.get("metadata"),
            Some(&json!({ "user_id": "u-2" }))
        );
    }

    #[test]
    fn openai_chat_response_to_anthropic_preserves_cache_breakdown() {
        let converted = openai_chat_response_to_anthropic(
            &json!({
                "id": "chatcmpl_123",
                "choices": [{
                    "index": 0,
                    "finish_reason": "stop",
                    "message": { "role": "assistant", "content": "hello" }
                }],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "cache_read_tokens": 4,
                    "cache_creation_tokens": 2
                }
            }),
            "test-model",
        );

        assert_eq!(converted["usage"]["cache_read_input_tokens"], 4);
        assert_eq!(converted["usage"]["cache_creation_input_tokens"], 2);
    }

    #[test]
    fn anthropic_response_to_openai_chat_sums_cache_read_and_creation() {
        let converted = anthropic_response_to_openai_chat(
            &json!({
                "id": "msg_123",
                "content": [{ "type": "text", "text": "hello" }],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": 11,
                    "output_tokens": 7,
                    "cache_read_input_tokens": 3,
                    "cache_creation_input_tokens": 2
                }
            }),
            "test-model",
        );

        assert_eq!(converted["usage"]["cached_tokens"], 5);
    }

    #[test]
    fn anthropic_response_to_openai_response_sums_cache_read_and_creation() {
        let converted = anthropic_response_to_openai_response(
            &json!({
                "id": "msg_123",
                "content": [{ "type": "text", "text": "hello" }],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": 11,
                    "output_tokens": 7,
                    "cache_read_input_tokens": 3,
                    "cache_creation_input_tokens": 2
                }
            }),
            "test-model",
        );

        assert_eq!(converted["usage"]["cached_tokens"], 5);
    }

    #[test]
    fn anthropic_response_to_openai_response_emits_function_call_items() {
        let converted = anthropic_response_to_openai_response(
            &json!({
                "id": "msg_tool",
                "content": [{
                    "type": "tool_use",
                    "id": "tool_1",
                    "name": "weather",
                    "input": { "city": "Paris" }
                }],
                "stop_reason": "tool_use",
                "usage": {
                    "input_tokens": 9,
                    "output_tokens": 2
                }
            }),
            "test-model",
        );

        assert_eq!(
            converted["output"][0]["content"][0]["type"].as_str(),
            Some("function_call")
        );
        assert_eq!(
            converted["output"][0]["content"][0]["call_id"].as_str(),
            Some("tool_1")
        );
        assert_eq!(
            converted["output"][0]["content"][0]["arguments"].as_str(),
            Some("{\"city\":\"Paris\"}")
        );
    }

    #[test]
    fn openai_responses_response_to_anthropic_parses_function_call_arguments() {
        let converted = openai_responses_response_to_anthropic(
            &json!({
                "id": "resp_tool",
                "status": "requires_action",
                "output": [{
                    "id": "out_1",
                    "type": "output_message",
                    "role": "assistant",
                    "content": [{
                        "type": "function_call",
                        "id": "call_1",
                        "call_id": "call_1",
                        "name": "weather",
                        "arguments": "{\"city\":\"Paris\"}"
                    }]
                }],
                "usage": {
                    "input_tokens": 8,
                    "output_tokens": 1
                }
            }),
            "test-model",
        );

        assert_eq!(converted["content"][0]["type"].as_str(), Some("tool_use"));
        assert_eq!(converted["content"][0]["id"].as_str(), Some("call_1"));
        assert_eq!(converted["content"][0]["name"].as_str(), Some("weather"));
        assert_eq!(converted["content"][0]["input"], json!({ "city": "Paris" }));
        assert_eq!(converted["stop_reason"].as_str(), Some("tool_use"));
    }
}
