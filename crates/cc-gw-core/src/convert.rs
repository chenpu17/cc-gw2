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
    let cached_tokens = cache_read_tokens.unwrap_or(0);
    (cache_read_tokens, cache_creation_tokens, cached_tokens)
}

fn anthropic_cache_usage(usage: &Value) -> (i64, i64, i64, i64) {
    let input_tokens = usage
        .get("input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_read_tokens = usage
        .get("cache_read_input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cache_creation_tokens = usage
        .get("cache_creation_input_tokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let total_input_tokens = input_tokens + cache_read_tokens + cache_creation_tokens;
    (
        input_tokens,
        cache_read_tokens,
        cache_creation_tokens,
        total_input_tokens,
    )
}

fn anthropic_input_tokens_from_openai_usage(usage: &Value) -> i64 {
    let total_input_tokens = usage
        .get("input_tokens")
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let (cache_read_tokens, cache_creation_tokens, _) = openai_cache_usage(usage);
    total_input_tokens
        .saturating_sub(cache_read_tokens.unwrap_or(0))
        .saturating_sub(cache_creation_tokens.unwrap_or(0))
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
            if let Some(text) = map.get("refusal").and_then(Value::as_str) {
                return text.to_string();
            }
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

fn anthropic_source_to_openai_image_url(source: &Value) -> Option<String> {
    match source.get("type").and_then(Value::as_str) {
        Some("url") => source
            .get("url")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        Some("base64") => {
            let media_type = source.get("media_type").and_then(Value::as_str)?;
            let data = source.get("data").and_then(Value::as_str)?;
            Some(format!("data:{media_type};base64,{data}"))
        }
        _ => None,
    }
}

fn anthropic_source_to_openai_file(source: &Value, filename: Option<&str>) -> Option<Value> {
    let mut file = Map::new();
    match source.get("type").and_then(Value::as_str) {
        Some("url") => {
            let url = source.get("url").and_then(Value::as_str)?;
            file.insert("file_url".to_string(), Value::String(url.to_string()));
        }
        Some("base64") => {
            let data = source.get("data").and_then(Value::as_str)?;
            file.insert("file_data".to_string(), Value::String(data.to_string()));
        }
        Some("file") => {
            let file_id = source.get("file_id").and_then(Value::as_str)?;
            file.insert("file_id".to_string(), Value::String(file_id.to_string()));
        }
        _ => return None,
    }
    if let Some(filename) = filename.filter(|value| !value.trim().is_empty()) {
        file.insert("filename".to_string(), Value::String(filename.to_string()));
    }
    Some(Value::Object(file))
}

fn anthropic_block_to_openai_chat_part(block: &Value) -> Option<Value> {
    match block.get("type").and_then(Value::as_str) {
        Some("text") | Some("input_text") | Some("output_text") => Some(json!({
            "type": "text",
            "text": extract_text(block)
        })),
        Some("image") => {
            let source = block.get("source")?;
            let url = anthropic_source_to_openai_image_url(source)?;
            Some(json!({
                "type": "image_url",
                "image_url": {
                    "url": url,
                    "detail": "auto"
                }
            }))
        }
        Some("document") => {
            let source = block.get("source")?;
            let file = anthropic_source_to_openai_file(
                source,
                block.get("title").and_then(Value::as_str),
            )?;
            Some(json!({
                "type": "file",
                "file": file
            }))
        }
        _ => None,
    }
}

fn anthropic_block_to_openai_response_content_part(block: &Value) -> Option<Value> {
    match block.get("type").and_then(Value::as_str) {
        Some("text") | Some("input_text") => Some(json!({
            "type": "input_text",
            "text": extract_text(block)
        })),
        Some("output_text") => Some(json!({
            "type": "output_text",
            "text": extract_text(block)
        })),
        Some("image") => {
            let source = block.get("source")?;
            let image_url = anthropic_source_to_openai_image_url(source)?;
            Some(json!({
                "type": "input_image",
                "image_url": image_url,
                "detail": "auto"
            }))
        }
        Some("document") => {
            let source = block.get("source")?;
            let file = anthropic_source_to_openai_file(
                source,
                block.get("title").and_then(Value::as_str),
            )?;
            let mut object = Map::new();
            object.insert("type".to_string(), Value::String("input_file".to_string()));
            if let Some(file_id) = file.get("file_id").and_then(Value::as_str) {
                object.insert("file_id".to_string(), Value::String(file_id.to_string()));
            }
            if let Some(file_url) = file.get("file_url").and_then(Value::as_str) {
                object.insert("file_url".to_string(), Value::String(file_url.to_string()));
            }
            if let Some(file_data) = file.get("file_data").and_then(Value::as_str) {
                object.insert(
                    "file_data".to_string(),
                    Value::String(file_data.to_string()),
                );
            }
            if let Some(filename) = file.get("filename").and_then(Value::as_str) {
                object.insert("filename".to_string(), Value::String(filename.to_string()));
            }
            Some(Value::Object(object))
        }
        _ => None,
    }
}

fn openai_image_url_to_anthropic_source(image_url: &Value) -> Option<Value> {
    let url = image_url.get("url").and_then(Value::as_str)?;
    if let Some((prefix, data)) = url.split_once(";base64,") {
        let media_type = prefix.strip_prefix("data:")?;
        Some(json!({
            "type": "base64",
            "media_type": media_type,
            "data": data
        }))
    } else {
        Some(json!({
            "type": "url",
            "url": url
        }))
    }
}

fn openai_file_to_anthropic_document(file: &Value) -> Option<Value> {
    let filename = file.get("filename").and_then(Value::as_str);
    let source = if let Some(file_id) = file.get("file_id").and_then(Value::as_str) {
        Some(json!({
            "type": "file",
            "file_id": file_id
        }))
    } else if let Some(file_url) = file.get("file_url").and_then(Value::as_str) {
        Some(json!({
            "type": "url",
            "url": file_url
        }))
    } else if let Some(file_data) = file.get("file_data").and_then(Value::as_str) {
        let media_type = filename
            .and_then(|name| {
                name.to_ascii_lowercase()
                    .ends_with(".pdf")
                    .then_some("application/pdf")
            })
            .unwrap_or("application/pdf");
        Some(json!({
            "type": "base64",
            "media_type": media_type,
            "data": file_data
        }))
    } else {
        None
    }?;

    let mut block = Map::new();
    block.insert("type".to_string(), Value::String("document".to_string()));
    block.insert("source".to_string(), source);
    if let Some(filename) = filename {
        block.insert("title".to_string(), Value::String(filename.to_string()));
    }
    Some(Value::Object(block))
}

fn openai_chat_content_part_to_anthropic_block(part: &Value) -> Option<Value> {
    match part.get("type").and_then(Value::as_str) {
        Some("text") => Some(json!({
            "type": "text",
            "text": part.get("text").and_then(Value::as_str).unwrap_or_default()
        })),
        Some("image_url") => Some(json!({
            "type": "image",
            "source": openai_image_url_to_anthropic_source(part.get("image_url")?)?
        })),
        Some("file") => openai_file_to_anthropic_document(part.get("file")?),
        _ => None,
    }
}

fn openai_response_content_part_to_anthropic_block(part: &Value) -> Option<Value> {
    match part.get("type").and_then(Value::as_str) {
        Some("input_text") | Some("output_text") | Some("text") => Some(json!({
            "type": "text",
            "text": part.get("text").and_then(Value::as_str).unwrap_or_default()
        })),
        Some("input_image") => Some(json!({
            "type": "image",
            "source": openai_image_url_to_anthropic_source(&json!({
                "url": part.get("image_url").and_then(Value::as_str).unwrap_or_default()
            }))?
        })),
        Some("input_file") => {
            let mut file = Map::new();
            if let Some(value) = part.get("file_id").cloned() {
                file.insert("file_id".to_string(), value);
            }
            if let Some(value) = part.get("file_url").cloned() {
                file.insert("file_url".to_string(), value);
            }
            if let Some(value) = part.get("file_data").cloned() {
                file.insert("file_data".to_string(), value);
            }
            if let Some(value) = part.get("filename").cloned() {
                file.insert("filename".to_string(), value);
            }
            openai_file_to_anthropic_document(&Value::Object(file))
        }
        _ => None,
    }
}

fn anthropic_reasoning_text(block: &Value) -> Option<String> {
    match block.get("type").and_then(Value::as_str) {
        Some("thinking") => block
            .get("thinking")
            .or_else(|| block.get("text"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        Some("redacted_thinking") => Some("[redacted thinking]".to_string()),
        _ => None,
    }
}

fn anthropic_thinking_to_openai_reasoning(value: Option<&Value>) -> Option<Value> {
    let thinking = value?;
    match thinking {
        Value::Bool(false) | Value::Null => return None,
        Value::Bool(true) => {
            return Some(json!({
                "effort": "medium",
                "summary": "auto"
            }));
        }
        Value::String(text) if text.trim().is_empty() => return None,
        Value::String(_) => {
            return Some(json!({
                "effort": "medium",
                "summary": "auto"
            }));
        }
        Value::Object(map) => {
            if matches!(
                map.get("type").and_then(Value::as_str),
                Some("disabled") | Some("off")
            ) {
                return None;
            }
            let mut reasoning = Map::new();
            let effort = map
                .get("effort")
                .and_then(Value::as_str)
                .filter(|value| matches!(*value, "minimal" | "low" | "medium" | "high"))
                .map(ToString::to_string)
                .or_else(|| {
                    map.get("budget_tokens")
                        .and_then(Value::as_i64)
                        .map(|budget| match budget {
                            0..=1024 => "low",
                            1025..=8192 => "medium",
                            _ => "high",
                        })
                        .map(ToString::to_string)
                })
                .unwrap_or_else(|| "medium".to_string());
            reasoning.insert("effort".to_string(), Value::String(effort));
            let summary = map
                .get("summary")
                .and_then(Value::as_str)
                .filter(|value| matches!(*value, "auto" | "concise" | "detailed"))
                .unwrap_or("auto");
            reasoning.insert("summary".to_string(), Value::String(summary.to_string()));
            return Some(Value::Object(reasoning));
        }
        _ => {}
    }

    None
}

fn openai_reasoning_item_from_anthropic_block(block: &Value, index: usize) -> Option<Value> {
    let text = anthropic_reasoning_text(block)?;
    if text.trim().is_empty() {
        return None;
    }
    let id = block
        .get("id")
        .or_else(|| block.get("signature"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("rs_cc_gw_{index}"));
    Some(json!({
        "type": "reasoning",
        "id": id,
        "summary": [{
            "type": "summary_text",
            "text": text
        }]
    }))
}

fn openai_reasoning_text(block: &Value) -> Option<String> {
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

pub fn openai_error_to_anthropic(body: &Value) -> Value {
    let error = body.get("error").unwrap_or(body);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .unwrap_or("upstream request failed");
    let error_type = error
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("api_error");

    json!({
        "type": "error",
        "error": {
            "type": error_type,
            "message": message
        }
    })
}

pub fn anthropic_error_to_openai(body: &Value) -> Value {
    let error = body.get("error").unwrap_or(body);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| body.get("message").and_then(Value::as_str))
        .or_else(|| error.as_str())
        .unwrap_or("upstream request failed");
    let error_type = error
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("api_error");
    let code = error.get("code").cloned().unwrap_or(Value::Null);

    json!({
        "error": {
            "message": message,
            "type": error_type,
            "code": code,
            "param": Value::Null
        }
    })
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

fn anthropic_parallel_tool_calls(value: Option<&Value>) -> Option<Value> {
    let disabled = value
        .and_then(Value::as_object)
        .and_then(|tool_choice| tool_choice.get("disable_parallel_tool_use"))
        .and_then(Value::as_bool)?;
    Some(Value::Bool(!disabled))
}

fn openai_tool_choice_to_anthropic(
    value: Option<&Value>,
    parallel_tool_calls: Option<&Value>,
    has_tools: bool,
) -> Option<Value> {
    let disable_parallel_tool_use =
        matches!(parallel_tool_calls.and_then(Value::as_bool), Some(false));

    let apply_parallel_flag = |tool_choice: Value| {
        if !disable_parallel_tool_use {
            return tool_choice;
        }

        let mut map = tool_choice.as_object().cloned().unwrap_or_default();
        map.insert("disable_parallel_tool_use".to_string(), Value::Bool(true));
        Value::Object(map)
    };

    let tool_choice = match value {
        Some(Value::String(raw)) => match raw.trim().to_ascii_lowercase().as_str() {
            "auto" => Some(json!({ "type": "auto" })),
            "none" => Some(json!({ "type": "none" })),
            "required" => Some(json!({ "type": "any" })),
            _ => None,
        },
        Some(Value::Object(map)) => match map
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "function" => map
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                .map(|name| {
                    json!({
                        "type": "tool",
                        "name": name
                    })
                }),
            _ => None,
        },
        None if disable_parallel_tool_use && has_tools => Some(json!({ "type": "auto" })),
        _ => None,
    }?;

    Some(apply_parallel_flag(tool_choice))
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

fn openai_function_output_to_anthropic_tool_result_content(value: Option<&Value>) -> Value {
    match value.cloned().unwrap_or(Value::Null) {
        Value::String(text) => Value::String(text),
        Value::Array(items) => {
            let blocks = items
                .into_iter()
                .filter_map(|item| {
                    let object = item.as_object()?;
                    let block_type = object.get("type").and_then(Value::as_str).unwrap_or("");
                    match block_type {
                        "input_text" | "output_text" | "text" => Some(json!({
                            "type": "text",
                            "text": object.get("text").and_then(Value::as_str).unwrap_or("")
                        })),
                        _ => None,
                    }
                })
                .collect::<Vec<_>>();
            if blocks.is_empty() {
                Value::String(String::new())
            } else {
                Value::Array(blocks)
            }
        }
        Value::Null => Value::String(String::new()),
        other => Value::String(stringify_value(&other)),
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
                let mut content_parts = Vec::new();
                let mut tool_results = Vec::new();

                for block in &content_blocks {
                    let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                    match block_type {
                        "text" | "input_text" => {
                            let text = extract_text(block);
                            if !text.is_empty() {
                                text_parts.push(text.clone());
                                content_parts.push(json!({
                                    "type": "text",
                                    "text": text
                                }));
                            }
                        }
                        "image" | "document" => {
                            if let Some(part) = anthropic_block_to_openai_chat_part(block) {
                                content_parts.push(part);
                            }
                        }
                        "tool_result" => {
                            let tool_use_id = block
                                .get("tool_use_id")
                                .cloned()
                                .unwrap_or(Value::String("tool_result".to_string()));
                            let tool_name = block
                                .get("name")
                                .cloned()
                                .unwrap_or_else(|| tool_use_id.clone());
                            tool_results.push(json!({
                                "role": "tool",
                                "tool_call_id": tool_use_id,
                                "name": tool_name,
                                "content": block.get("content").map(stringify_value).unwrap_or_default()
                            }));
                        }
                        _ => {}
                    }
                }

                messages.extend(tool_results);
                let user_text = text_parts.join("\n");
                if !content_parts.is_empty() {
                    messages.push(json!({
                        "role": "user",
                        "content": content_parts
                    }));
                } else if !user_text.trim().is_empty() || content_blocks.is_empty() {
                    messages.push(json!({
                        "role": "user",
                        "content": user_text
                    }));
                }
            }
            "assistant" => {
                let mut text_parts = Vec::new();
                let mut reasoning_parts = Vec::new();
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
                        "thinking" | "redacted_thinking" => {
                            if let Some(text) = anthropic_reasoning_text(block) {
                                reasoning_parts.push(text);
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
                if !reasoning_parts.is_empty() {
                    assistant.insert(
                        "reasoning_content".to_string(),
                        Value::String(reasoning_parts.join("\n")),
                    );
                }
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
    if let Some(parallel_tool_calls) = anthropic_parallel_tool_calls(body.get("tool_choice")) {
        result.insert("parallel_tool_calls".to_string(), parallel_tool_calls);
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
                if let Some(parts) = message.get("content").and_then(Value::as_array) {
                    for part in parts {
                        if let Some(block) = openai_chat_content_part_to_anthropic_block(part) {
                            blocks.push(block);
                        }
                    }
                } else {
                    let text = message.get("content").map(extract_text).unwrap_or_default();
                    if !text.trim().is_empty() {
                        blocks.push(json!({ "type": "text", "text": text }));
                    }
                }
                if let Some(reasoning) = message.get("reasoning_content").and_then(Value::as_str) {
                    if !reasoning.trim().is_empty() {
                        blocks.push(json!({ "type": "thinking", "thinking": reasoning }));
                    }
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
                let mut blocks = Vec::<Value>::new();
                if let Some(parts) = message.get("content").and_then(Value::as_array) {
                    for part in parts {
                        if let Some(block) = openai_chat_content_part_to_anthropic_block(part) {
                            blocks.push(block);
                        }
                    }
                }
                if blocks.is_empty() {
                    let text = message.get("content").map(extract_text).unwrap_or_default();
                    blocks.push(json!({ "type": "text", "text": text }));
                }
                messages.push(json!({
                    "role": "user",
                    "content": blocks
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
        .or_else(|| body.get("max_completion_tokens").cloned())
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
    if body.get("reasoning").is_some() || body.get("thinking").is_some() {
        result.insert("thinking".to_string(), json!({ "type": "enabled" }));
    }
    if let Some(metadata) = body.get("metadata").cloned() {
        result.insert("metadata".to_string(), metadata);
    }
    if let Some(tools) = openai_tools_to_anthropic(body.get("tools")) {
        result.insert("tools".to_string(), tools);
    }
    if let Some(tool_choice) = openai_tool_choice_to_anthropic(
        body.get("tool_choice"),
        body.get("parallel_tool_calls"),
        body.get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty()),
    ) {
        result.insert("tool_choice".to_string(), tool_choice);
    }
    if let Some(stop_sequences) = body.get("stop").cloned() {
        result.insert("stop_sequences".to_string(), stop_sequences);
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

        if item.get("type").and_then(Value::as_str) == Some("function_call_output") {
            messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": item.get("call_id").cloned().unwrap_or(Value::String("tool_result".to_string())),
                    "content": openai_function_output_to_anthropic_tool_result_content(item.get("output"))
                }]
            }));
            continue;
        }

        if item.get("type").and_then(Value::as_str) == Some("function_call") {
            let arguments = item
                .get("arguments")
                .and_then(Value::as_str)
                .map(parse_json_string)
                .unwrap_or_else(|| json!({}));
            messages.push(json!({
                "role": "assistant",
                "content": [{
                    "type": "tool_use",
                    "id": item.get("call_id").or_else(|| item.get("id")).cloned().unwrap_or(Value::String("tool_call".to_string())),
                    "name": item.get("name").cloned().unwrap_or(Value::String("tool".to_string())),
                    "input": arguments
                }]
            }));
            continue;
        }

        if item.get("type").and_then(Value::as_str) == Some("reasoning") {
            if let Some(reasoning) = openai_reasoning_text(item) {
                messages.push(json!({
                    "role": "assistant",
                    "content": [{
                        "type": "thinking",
                        "thinking": reasoning
                    }]
                }));
            }
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
            if let Some(parts) = item.get("content").and_then(Value::as_array) {
                for part in parts {
                    if let Some(block) = openai_response_content_part_to_anthropic_block(part) {
                        blocks.push(block);
                    }
                }
            } else {
                let text = item.get("content").map(extract_text).unwrap_or_default();
                if !text.trim().is_empty() {
                    blocks.push(json!({ "type": "text", "text": text }));
                }
            }
            if let Some(reasoning) = item.get("reasoning_content").and_then(Value::as_str) {
                if !reasoning.trim().is_empty() {
                    blocks.push(json!({ "type": "thinking", "thinking": reasoning }));
                }
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

        let mut blocks = Vec::<Value>::new();
        if let Some(parts) = item.get("content").and_then(Value::as_array) {
            for part in parts {
                if let Some(block) = openai_response_content_part_to_anthropic_block(part) {
                    blocks.push(block);
                }
            }
        }
        if blocks.is_empty() {
            blocks.push(json!({
                "type": "text",
                "text": item.get("content").map(extract_text).unwrap_or_default()
            }));
        }
        messages.push(json!({
            "role": "user",
            "content": blocks
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
        .or_else(|| body.get("max_completion_tokens").cloned())
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
    if body.get("reasoning").is_some() || body.get("thinking").is_some() {
        result.insert("thinking".to_string(), json!({ "type": "enabled" }));
    }
    if let Some(metadata) = body.get("metadata").cloned() {
        result.insert("metadata".to_string(), metadata);
    }
    if let Some(tools) = openai_tools_to_anthropic(body.get("tools")) {
        result.insert("tools".to_string(), tools);
    }
    if let Some(tool_choice) = openai_tool_choice_to_anthropic(
        body.get("tool_choice"),
        body.get("parallel_tool_calls"),
        body.get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| !tools.is_empty()),
    ) {
        result.insert("tool_choice".to_string(), tool_choice);
    }
    if let Some(stop_sequences) = body.get("stop").cloned() {
        result.insert("stop_sequences".to_string(), stop_sequences);
    }
    Value::Object(result)
}

pub fn anthropic_request_to_openai_response(body: &Value) -> Value {
    let mut input = Vec::<Value>::new();

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
                let mut pending_content_parts = Vec::<Value>::new();
                let flush_user_message =
                    |input: &mut Vec<Value>, content_parts: &mut Vec<Value>| {
                        if content_parts.is_empty() {
                            return;
                        }
                        input.push(json!({
                            "type": "message",
                            "role": "user",
                            "content": content_parts.drain(..).collect::<Vec<_>>()
                        }));
                    };

                for block in &content_blocks {
                    match block.get("type").and_then(Value::as_str).unwrap_or("") {
                        "text" | "input_text" | "image" | "document" => {
                            if let Some(part) =
                                anthropic_block_to_openai_response_content_part(block)
                            {
                                pending_content_parts.push(part);
                            }
                        }
                        "tool_result" => {
                            flush_user_message(&mut input, &mut pending_content_parts);
                            input.push(json!({
                                "type": "function_call_output",
                                "call_id": block.get("tool_use_id").cloned().unwrap_or(Value::String("tool_result".to_string())),
                                "output": stringify_value(block.get("content").unwrap_or(&Value::Null))
                            }));
                        }
                        _ => {}
                    }
                }

                if content_blocks.is_empty() {
                    input.push(json!({
                        "type": "message",
                        "role": "user",
                        "content": []
                    }));
                } else {
                    flush_user_message(&mut input, &mut pending_content_parts);
                }
            }
            "assistant" => {
                let mut pending_text_parts = Vec::new();
                let flush_assistant_text =
                    |input: &mut Vec<Value>, text_parts: &mut Vec<String>| {
                        if text_parts.is_empty() {
                            return;
                        }
                        let content = text_parts
                            .drain(..)
                            .map(|text| {
                                json!({
                                    "type": "output_text",
                                    "text": text
                                })
                            })
                            .collect::<Vec<_>>();
                        input.push(json!({
                            "type": "message",
                            "role": "assistant",
                            "content": content
                        }));
                    };

                for block in &content_blocks {
                    match block.get("type").and_then(Value::as_str).unwrap_or("") {
                        "text" | "output_text" => {
                            let text = extract_text(block);
                            if !text.is_empty() {
                                pending_text_parts.push(text);
                            }
                        }
                        "thinking" | "redacted_thinking" => {
                            flush_assistant_text(&mut input, &mut pending_text_parts);
                            if let Some(reasoning_item) =
                                openai_reasoning_item_from_anthropic_block(block, input.len() + 1)
                            {
                                input.push(reasoning_item);
                            }
                        }
                        "tool_use" => {
                            flush_assistant_text(&mut input, &mut pending_text_parts);
                            let arguments =
                                serde_json::to_string(block.get("input").unwrap_or(&json!({})))
                                    .unwrap_or_else(|_| "{}".to_string());
                            input.push(json!({
                                "type": "function_call",
                                "id": block.get("id").cloned().unwrap_or(Value::String("call".to_string())),
                                "call_id": block.get("id").cloned().unwrap_or(Value::String("call".to_string())),
                                "name": block.get("name").cloned().unwrap_or(Value::String("tool".to_string())),
                                "arguments": arguments
                            }));
                        }
                        _ => {}
                    }
                }

                if content_blocks.is_empty() {
                    input.push(json!({
                        "type": "message",
                        "role": "assistant",
                        "content": []
                    }));
                } else {
                    flush_assistant_text(&mut input, &mut pending_text_parts);
                }
            }
            _ => {}
        }
    }

    let mut result = Map::new();
    result.insert("input".to_string(), Value::Array(input));
    if let Some(system) = body.get("system") {
        let text = extract_text(system);
        if !text.trim().is_empty() {
            result.insert("instructions".to_string(), Value::String(text));
        }
    }
    if let Some(max_tokens) = body.get("max_tokens").cloned() {
        result.insert("max_output_tokens".to_string(), max_tokens);
    }
    if let Some(reasoning) = anthropic_thinking_to_openai_reasoning(body.get("thinking")) {
        result.insert("reasoning".to_string(), reasoning);
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
    if let Some(tools) = anthropic_tools_to_openai(body.get("tools")) {
        result.insert("tools".to_string(), tools);
    }
    if let Some(tool_choice) = anthropic_tool_choice_to_openai(body.get("tool_choice")) {
        result.insert("tool_choice".to_string(), tool_choice);
    }
    if let Some(parallel_tool_calls) = anthropic_parallel_tool_calls(body.get("tool_choice")) {
        result.insert("parallel_tool_calls".to_string(), parallel_tool_calls);
    }
    Value::Object(result)
}

fn map_openai_finish_to_anthropic(reason: Option<&str>) -> Option<&'static str> {
    match reason {
        Some("stop") => Some("end_turn"),
        Some("tool_calls") => Some("tool_use"),
        Some("length") => Some("max_tokens"),
        Some("content_filter") => Some("refusal"),
        _ => None,
    }
}

fn map_anthropic_stop_to_openai_chat(reason: Option<&str>) -> Option<&'static str> {
    match reason {
        Some("tool_use") => Some("tool_calls"),
        Some("max_tokens") => Some("length"),
        Some("refusal") => Some("content_filter"),
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
    let mut reasoning = Vec::<String>::new();
    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        for part in parts {
            if let Some(block) = openai_chat_content_part_to_anthropic_block(part) {
                content.push(block);
            }
        }
    } else {
        let text = message
            .get("content")
            .map(extract_text)
            .filter(|text| !text.trim().is_empty())
            .or_else(|| message.get("refusal").map(extract_text))
            .unwrap_or_default();
        if !text.trim().is_empty() {
            content.push(json!({ "type": "text", "text": text }));
        }
    }
    if let Some(refusal) = message.get("refusal").map(extract_text) {
        if !refusal.trim().is_empty() {
            content.push(json!({ "type": "text", "text": refusal }));
        }
    }
    if let Some(reasoning_content) = message.get("reasoning_content").and_then(Value::as_str) {
        if !reasoning_content.trim().is_empty() {
            reasoning.push(reasoning_content.to_string());
        }
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
    if !reasoning.is_empty() {
        content.push(json!({
            "type": "thinking",
            "thinking": reasoning.join("\n")
        }));
    }

    let usage = body.get("usage").cloned().unwrap_or_else(|| json!({}));
    let metadata = body.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let (cache_read_tokens, cache_creation_tokens, _) = openai_cache_usage(&usage);
    let anthropic_input_tokens = anthropic_input_tokens_from_openai_usage(&usage);
    let mut anthropic_usage = Map::new();
    anthropic_usage.insert(
        "input_tokens".to_string(),
        Value::from(anthropic_input_tokens),
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
    let mut saw_refusal = false;
    let mut saw_tool_use = false;
    let mut reasoning = Vec::<String>::new();

    if let Some(output) = body.get("output").and_then(Value::as_array) {
        for item in output {
            let blocks = item
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(|| vec![item.clone()]);
            for block in blocks {
                let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                match block_type {
                    "output_text" | "text" | "refusal" => {
                        let text = extract_text(&block);
                        if !text.trim().is_empty() {
                            if block_type == "refusal" {
                                saw_refusal = true;
                            }
                            content.push(json!({ "type": "text", "text": text }));
                        }
                    }
                    "tool_use" | "function_call" => {
                        saw_tool_use = true;
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
                    "input_image" | "input_file" => {
                        if let Some(content_block) =
                            openai_response_content_part_to_anthropic_block(&block)
                        {
                            content.push(content_block);
                        }
                    }
                    "image_url" | "file" => {
                        if let Some(content_block) =
                            openai_chat_content_part_to_anthropic_block(&block)
                        {
                            content.push(content_block);
                        }
                    }
                    "reasoning" => {
                        if let Some(text) = openai_reasoning_text(&block) {
                            reasoning.push(text);
                        }
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
    if let Some(reasoning_content) = body.get("reasoning_content").and_then(Value::as_str) {
        if !reasoning_content.trim().is_empty() {
            reasoning.push(reasoning_content.to_string());
        }
    }
    if !reasoning.is_empty() {
        content.push(json!({
            "type": "thinking",
            "thinking": reasoning.join("\n")
        }));
    }

    let usage = body.get("usage").cloned().unwrap_or_else(|| json!({}));
    let metadata = body.get("metadata").cloned().unwrap_or_else(|| json!({}));
    let status = body.get("status").and_then(Value::as_str);
    let stop_reason = if saw_refusal {
        Some("refusal")
    } else if saw_tool_use {
        Some("tool_use")
    } else {
        match status {
            Some("requires_action") => Some("tool_use"),
            Some("incomplete") => Some("max_tokens"),
            _ => Some("end_turn"),
        }
    };

    let (cache_read_tokens, cache_creation_tokens, _) = openai_cache_usage(&usage);
    let anthropic_input_tokens = anthropic_input_tokens_from_openai_usage(&usage);
    let mut anthropic_usage = Map::new();
    anthropic_usage.insert(
        "input_tokens".to_string(),
        Value::from(anthropic_input_tokens),
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
    let mut reasoning_content = Vec::<String>::new();
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
            "thinking" | "redacted_thinking" => {
                if let Some(text) = anthropic_reasoning_text(block) {
                    reasoning_content.push(text);
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
    if !reasoning_content.is_empty() {
        message.insert(
            "reasoning_content".to_string(),
            Value::String(reasoning_content.join("\n")),
        );
    }

    let (_, cache_read_tokens, _, total_input_tokens) = anthropic_cache_usage(&usage);
    let cached_tokens = cache_read_tokens;

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
            "prompt_tokens": total_input_tokens,
            "completion_tokens": usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "total_tokens": total_input_tokens + usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "cached_tokens": if cached_tokens > 0 { Some(cached_tokens) } else { None }
        }
    })
}

pub fn anthropic_response_to_openai_response(body: &Value, model: &str) -> Value {
    let mut output_content = Vec::<Value>::new();
    let mut output_text = String::new();
    let mut reasoning_content = Vec::<String>::new();
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
            "thinking" | "redacted_thinking" => {
                if let Some(text) = anthropic_reasoning_text(block) {
                    reasoning_content.push(text);
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
    let (_, cache_read_tokens, _, total_input_tokens) = anthropic_cache_usage(&usage);
    let cached_tokens = cache_read_tokens;

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
        "reasoning_content": if reasoning_content.is_empty() {
            Value::Null
        } else {
            Value::String(reasoning_content.join("\n"))
        },
        "usage": {
            "input_tokens": total_input_tokens,
            "output_tokens": usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "total_tokens": total_input_tokens + usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
            "prompt_tokens": total_input_tokens,
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
    fn anthropic_request_to_openai_chat_sets_tool_result_name_from_tool_use_id() {
        let converted = anthropic_request_to_openai_chat(&json!({
            "messages": [{
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "call_1",
                    "content": [{ "type": "text", "text": "done" }]
                }]
            }]
        }));

        assert_eq!(
            converted["messages"][0],
            json!({
                "role": "tool",
                "tool_call_id": "call_1",
                "name": "call_1",
                "content": "[{\"text\":\"done\",\"type\":\"text\"}]"
            })
        );
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
    fn anthropic_request_to_openai_chat_preserves_reasoning_and_multimodal_parts() {
        let converted = anthropic_request_to_openai_chat(&json!({
            "messages": [
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "look" },
                        {
                            "type": "image",
                            "source": { "type": "url", "url": "https://example.com/cat.png" }
                        },
                        {
                            "type": "document",
                            "title": "spec.pdf",
                            "source": { "type": "url", "url": "https://example.com/spec.pdf" }
                        }
                    ]
                },
                {
                    "role": "assistant",
                    "content": [
                        { "type": "thinking", "thinking": "considering options" },
                        { "type": "text", "text": "done" }
                    ]
                }
            ]
        }));

        assert_eq!(
            converted["messages"][0]["content"][1]["type"].as_str(),
            Some("image_url")
        );
        assert_eq!(
            converted["messages"][0]["content"][2]["type"].as_str(),
            Some("file")
        );
        assert_eq!(
            converted["messages"][1]["reasoning_content"].as_str(),
            Some("considering options")
        );
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
    fn openai_chat_request_to_anthropic_maps_tool_choice_and_parallel_flags() {
        let converted = openai_chat_request_to_anthropic(&json!({
            "messages": [{ "role": "user", "content": "hello" }],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "lookup",
                    "parameters": { "type": "object" }
                }
            }],
            "tool_choice": {
                "type": "function",
                "function": { "name": "lookup" }
            },
            "parallel_tool_calls": false
        }));

        assert_eq!(
            converted.get("tool_choice"),
            Some(&json!({
                "type": "tool",
                "name": "lookup",
                "disable_parallel_tool_use": true
            }))
        );
    }

    #[test]
    fn openai_chat_request_to_anthropic_preserves_reasoning_and_multimodal_parts() {
        let converted = openai_chat_request_to_anthropic(&json!({
            "messages": [
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "look" },
                        {
                            "type": "image_url",
                            "image_url": { "url": "https://example.com/cat.png" }
                        },
                        {
                            "type": "file",
                            "file": {
                                "file_url": "https://example.com/spec.pdf",
                                "filename": "spec.pdf"
                            }
                        }
                    ]
                },
                {
                    "role": "assistant",
                    "content": "done",
                    "reasoning_content": "considering options"
                }
            ]
        }));

        assert_eq!(
            converted["messages"][0]["content"][1]["type"].as_str(),
            Some("image")
        );
        assert_eq!(
            converted["messages"][0]["content"][2]["type"].as_str(),
            Some("document")
        );
        assert_eq!(
            converted["messages"][1]["content"][1]["type"].as_str(),
            Some("thinking")
        );
    }

    #[test]
    fn openai_chat_request_to_anthropic_maps_stop_and_max_completion_tokens() {
        let converted = openai_chat_request_to_anthropic(&json!({
            "messages": [{ "role": "user", "content": "hello" }],
            "max_completion_tokens": 321,
            "stop": ["END"]
        }));

        assert_eq!(converted.get("max_tokens"), Some(&json!(321)));
        assert_eq!(converted.get("stop_sequences"), Some(&json!(["END"])));
    }

    #[test]
    fn openai_responses_request_to_anthropic_maps_function_call_output() {
        let converted = openai_responses_request_to_anthropic(&json!({
            "input": [{
                "type": "function_call_output",
                "call_id": "call_1",
                "output": "done"
            }]
        }));

        assert_eq!(
            converted["messages"][0]["content"][0],
            json!({
                "type": "tool_result",
                "tool_use_id": "call_1",
                "content": "done"
            })
        );
    }

    #[test]
    fn openai_responses_request_to_anthropic_maps_top_level_function_call() {
        let converted = openai_responses_request_to_anthropic(&json!({
            "input": [{
                "type": "function_call",
                "call_id": "call_1",
                "name": "lookup",
                "arguments": "{\"city\":\"Paris\"}"
            }]
        }));

        assert_eq!(
            converted["messages"][0]["content"][0],
            json!({
                "type": "tool_use",
                "id": "call_1",
                "name": "lookup",
                "input": { "city": "Paris" }
            })
        );
    }

    #[test]
    fn openai_responses_request_to_anthropic_preserves_reasoning_and_multimodal_parts() {
        let converted = openai_responses_request_to_anthropic(&json!({
            "input": [{
                "role": "assistant",
                "content": [
                    { "type": "input_text", "text": "look" },
                    { "type": "input_image", "image_url": "https://example.com/cat.png" },
                    {
                        "type": "input_file",
                        "file_url": "https://example.com/spec.pdf",
                        "filename": "spec.pdf"
                    }
                ],
                "reasoning_content": "considering options"
            }],
            "reasoning": { "effort": "medium" }
        }));

        assert_eq!(
            converted["messages"][0]["content"][1]["type"].as_str(),
            Some("image")
        );
        assert_eq!(
            converted["messages"][0]["content"][2]["type"].as_str(),
            Some("document")
        );
        assert_eq!(
            converted["messages"][0]["content"][3]["type"].as_str(),
            Some("thinking")
        );
        assert_eq!(converted["thinking"]["type"].as_str(), Some("enabled"));
    }

    #[test]
    fn openai_responses_request_to_anthropic_maps_stop_and_max_completion_tokens() {
        let converted = openai_responses_request_to_anthropic(&json!({
            "input": [{ "role": "user", "content": "hello" }],
            "max_completion_tokens": 123,
            "stop": "END"
        }));

        assert_eq!(converted.get("max_tokens"), Some(&json!(123)));
        assert_eq!(converted.get("stop_sequences"), Some(&json!("END")));
    }

    #[test]
    fn anthropic_request_to_openai_response_builds_responses_input_items() {
        let converted = anthropic_request_to_openai_response(&json!({
            "system": "You are helpful.",
            "messages": [
                {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": "call_1",
                        "name": "lookup",
                        "input": { "city": "Paris" }
                    }]
                },
                {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "call_1",
                        "content": "sunny"
                    }]
                }
            ],
            "tool_choice": { "type": "any", "disable_parallel_tool_use": true },
            "max_tokens": 256
        }));

        assert_eq!(converted["instructions"], json!("You are helpful."));
        assert_eq!(converted["max_output_tokens"], json!(256));
        assert_eq!(converted["parallel_tool_calls"], json!(false));
        assert_eq!(converted["tool_choice"], json!("required"));
        assert_eq!(converted["input"][0]["type"], json!("function_call"));
        assert_eq!(converted["input"][0]["call_id"], json!("call_1"));
        assert_eq!(converted["input"][1]["type"], json!("function_call_output"));
        assert_eq!(converted["input"][1]["call_id"], json!("call_1"));
        assert_eq!(converted["input"][1]["output"], json!("sunny"));
    }

    #[test]
    fn anthropic_request_to_openai_response_preserves_reasoning_and_multimodal_parts() {
        let converted = anthropic_request_to_openai_response(&json!({
            "thinking": { "type": "enabled", "budget_tokens": 2048 },
            "messages": [
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "look" },
                        {
                            "type": "image",
                            "source": { "type": "url", "url": "https://example.com/cat.png" }
                        },
                        {
                            "type": "document",
                            "title": "spec.pdf",
                            "source": { "type": "url", "url": "https://example.com/spec.pdf" }
                        }
                    ]
                },
                {
                    "role": "assistant",
                    "content": [{ "type": "thinking", "thinking": "considering options" }]
                }
            ]
        }));

        assert_eq!(
            converted["input"][0]["content"][1]["type"].as_str(),
            Some("input_image")
        );
        assert_eq!(
            converted["input"][0]["content"][2]["type"].as_str(),
            Some("input_file")
        );
        assert_eq!(converted["reasoning"]["effort"].as_str(), Some("medium"));
        assert_eq!(converted["input"][1]["type"].as_str(), Some("reasoning"));
        assert_eq!(
            converted["input"][1]["summary"][0]["text"].as_str(),
            Some("considering options")
        );
    }

    #[test]
    fn openai_responses_request_to_anthropic_maps_top_level_reasoning_item() {
        let converted = openai_responses_request_to_anthropic(&json!({
            "input": [{
                "type": "reasoning",
                "summary": [{ "type": "summary_text", "text": "considering options" }]
            }]
        }));

        assert_eq!(
            converted["messages"][0]["content"][0],
            json!({
                "type": "thinking",
                "thinking": "considering options"
            })
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
    fn openai_chat_response_to_anthropic_preserves_reasoning_content() {
        let converted = openai_chat_response_to_anthropic(
            &json!({
                "choices": [{
                    "message": {
                        "content": "done",
                        "reasoning_content": "considering options"
                    }
                }]
            }),
            "claude-test",
        );

        assert_eq!(converted["content"][1]["type"].as_str(), Some("thinking"));
        assert_eq!(
            converted["content"][1]["thinking"].as_str(),
            Some("considering options")
        );
    }

    #[test]
    fn openai_chat_response_to_anthropic_preserves_multimodal_content() {
        let converted = openai_chat_response_to_anthropic(
            &json!({
                "choices": [{
                    "message": {
                        "content": [
                            { "type": "text", "text": "see attachment" },
                            {
                                "type": "image_url",
                                "image_url": { "url": "https://example.com/cat.png" }
                            },
                            {
                                "type": "file",
                                "file": {
                                    "file_url": "https://example.com/spec.pdf",
                                    "filename": "spec.pdf"
                                }
                            }
                        ]
                    }
                }]
            }),
            "claude-test",
        );

        assert_eq!(converted["content"][0]["type"].as_str(), Some("text"));
        assert_eq!(converted["content"][1]["type"].as_str(), Some("image"));
        assert_eq!(
            converted["content"][1]["source"]["url"].as_str(),
            Some("https://example.com/cat.png")
        );
        assert_eq!(converted["content"][2]["type"].as_str(), Some("document"));
        assert_eq!(
            converted["content"][2]["source"]["url"].as_str(),
            Some("https://example.com/spec.pdf")
        );
        assert_eq!(converted["content"][2]["title"].as_str(), Some("spec.pdf"));
    }

    #[test]
    fn openai_chat_response_to_anthropic_rebuilds_anthropic_input_tokens_from_total() {
        let converted = openai_chat_response_to_anthropic(
            &json!({
                "id": "chatcmpl_123",
                "choices": [{
                    "index": 0,
                    "finish_reason": "stop",
                    "message": { "role": "assistant", "content": "hello" }
                }],
                "usage": {
                    "prompt_tokens": 12,
                    "completion_tokens": 5,
                    "cache_read_tokens": 4,
                    "cache_creation_tokens": 3
                }
            }),
            "test-model",
        );

        assert_eq!(converted["usage"]["input_tokens"], json!(5));
        assert_eq!(converted["usage"]["cache_read_input_tokens"], json!(4));
        assert_eq!(converted["usage"]["cache_creation_input_tokens"], json!(3));
    }

    #[test]
    fn openai_chat_response_to_anthropic_preserves_refusal_text() {
        let converted = openai_chat_response_to_anthropic(
            &json!({
                "id": "chatcmpl_refusal",
                "choices": [{
                    "index": 0,
                    "finish_reason": "content_filter",
                    "message": {
                        "role": "assistant",
                        "content": null,
                        "refusal": "I can't help with that."
                    }
                }],
                "usage": {
                    "prompt_tokens": 4,
                    "completion_tokens": 3
                }
            }),
            "test-model",
        );

        assert_eq!(
            converted["content"][0]["text"],
            json!("I can't help with that.")
        );
        assert_eq!(converted["stop_reason"], json!("refusal"));
    }

    #[test]
    fn anthropic_response_to_openai_chat_emits_cache_read_as_cached_tokens() {
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

        assert_eq!(converted["usage"]["prompt_tokens"], json!(16));
        assert_eq!(converted["usage"]["cached_tokens"], 3);
    }

    #[test]
    fn anthropic_response_to_openai_chat_preserves_reasoning_content() {
        let converted = anthropic_response_to_openai_chat(
            &json!({
                "content": [
                    { "type": "thinking", "thinking": "considering options" },
                    { "type": "text", "text": "hello" }
                ],
                "usage": { "input_tokens": 5, "output_tokens": 2 }
            }),
            "test-model",
        );

        assert_eq!(
            converted["choices"][0]["message"]["reasoning_content"].as_str(),
            Some("considering options")
        );
    }

    #[test]
    fn anthropic_response_to_openai_response_emits_cache_read_as_cached_tokens() {
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

        assert_eq!(converted["usage"]["input_tokens"], json!(16));
        assert_eq!(converted["usage"]["cached_tokens"], 3);
    }

    #[test]
    fn anthropic_response_to_openai_response_preserves_reasoning_content() {
        let converted = anthropic_response_to_openai_response(
            &json!({
                "content": [
                    { "type": "thinking", "thinking": "considering options" },
                    { "type": "text", "text": "hello" }
                ],
                "usage": { "input_tokens": 5, "output_tokens": 2 }
            }),
            "test-model",
        );

        assert_eq!(
            converted["reasoning_content"].as_str(),
            Some("considering options")
        );
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

    #[test]
    fn openai_responses_response_to_anthropic_maps_top_level_function_call_when_completed() {
        let converted = openai_responses_response_to_anthropic(
            &json!({
                "id": "resp_tool",
                "status": "completed",
                "output": [{
                    "id": "call_1",
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "weather",
                    "arguments": "{\"city\":\"Paris\"}"
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

    #[test]
    fn openai_responses_response_to_anthropic_rebuilds_anthropic_input_tokens_from_total() {
        let converted = openai_responses_response_to_anthropic(
            &json!({
                "id": "resp_123",
                "status": "completed",
                "output": [{
                    "id": "out_1",
                    "type": "output_message",
                    "role": "assistant",
                    "content": [{
                        "type": "output_text",
                        "text": "hello"
                    }]
                }],
                "usage": {
                    "input_tokens": 12,
                    "output_tokens": 4,
                    "cache_read_tokens": 4,
                    "cache_creation_tokens": 3
                }
            }),
            "test-model",
        );

        assert_eq!(converted["usage"]["input_tokens"], json!(5));
        assert_eq!(converted["usage"]["cache_read_input_tokens"], json!(4));
        assert_eq!(converted["usage"]["cache_creation_input_tokens"], json!(3));
    }

    #[test]
    fn openai_responses_response_to_anthropic_preserves_refusal_blocks() {
        let converted = openai_responses_response_to_anthropic(
            &json!({
                "id": "resp_refusal",
                "status": "completed",
                "output": [{
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "content": [{
                        "type": "refusal",
                        "refusal": "I can't comply with that request."
                    }]
                }],
                "usage": {
                    "input_tokens": 6,
                    "output_tokens": 2
                }
            }),
            "test-model",
        );

        assert_eq!(
            converted["content"][0]["text"],
            json!("I can't comply with that request.")
        );
        assert_eq!(converted["stop_reason"], json!("refusal"));
    }

    #[test]
    fn openai_responses_response_to_anthropic_preserves_multimodal_content() {
        let converted = openai_responses_response_to_anthropic(
            &json!({
                "id": "resp_multimodal",
                "status": "completed",
                "output": [{
                    "id": "out_1",
                    "type": "output_message",
                    "role": "assistant",
                    "content": [
                        { "type": "output_text", "text": "see outputs" },
                        {
                            "type": "input_image",
                            "image_url": "https://example.com/cat.png"
                        },
                        {
                            "type": "input_file",
                            "file_url": "https://example.com/spec.pdf",
                            "filename": "spec.pdf"
                        }
                    ]
                }]
            }),
            "test-model",
        );

        assert_eq!(converted["content"][0]["type"].as_str(), Some("text"));
        assert_eq!(converted["content"][1]["type"].as_str(), Some("image"));
        assert_eq!(
            converted["content"][1]["source"]["url"].as_str(),
            Some("https://example.com/cat.png")
        );
        assert_eq!(converted["content"][2]["type"].as_str(), Some("document"));
        assert_eq!(
            converted["content"][2]["source"]["url"].as_str(),
            Some("https://example.com/spec.pdf")
        );
        assert_eq!(converted["content"][2]["title"].as_str(), Some("spec.pdf"));
    }
}
