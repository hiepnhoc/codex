use codex_http_client::Request;
use codex_http_client::TransportError;
use rand::Rng;
use std::future::Future;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_attempts: u64,
    pub base_delay: Duration,
    pub retry_on: RetryOn,
}

#[derive(Debug, Clone)]
pub struct RetryOn {
    pub retry_429: bool,
    pub retry_5xx: bool,
    pub retry_transport: bool,
}

impl RetryOn {
    pub fn should_retry(&self, err: &TransportError, attempt: u64, max_attempts: u64) -> bool {
        if attempt >= max_attempts {
            return false;
        }
        match err {
            TransportError::Http { status, .. } => {
                (self.retry_429 && status.as_u16() == 429)
                    || (self.retry_5xx && status.is_server_error())
            }
            TransportError::Timeout
            | TransportError::Connection(_)
            | TransportError::Network(_) => self.retry_transport,
            _ => false,
        }
    }
}

pub fn backoff(base: Duration, attempt: u64) -> Duration {
    if attempt == 0 {
        return base;
    }
    let exp = 2u64.saturating_pow(attempt as u32 - 1);
    let millis = base.as_millis() as u64;
    let raw = millis.saturating_mul(exp);
    let jitter: f64 = rand::rng().random_range(0.9..1.1);
    Duration::from_millis((raw as f64 * jitter) as u64)
}

/// hcodex: delay for an HTTP 429 that the policy chose to retry (only
/// non-OpenAI providers enable `retry_429`). Honors `Retry-After: <seconds>`
/// when present (capped at 60s); otherwise waits 2s, 4s, 8s, 16s, 30s — a
/// rate limit will not clear in the ~200ms the generic backoff starts at.
fn rate_limit_delay(err: &TransportError, attempt: u64) -> Option<Duration> {
    const FLOOR: Duration = Duration::from_secs(2);
    const MAX_BACKOFF: Duration = Duration::from_secs(30);
    const MAX_RETRY_AFTER: Duration = Duration::from_secs(60);
    let TransportError::Http {
        status, headers, ..
    } = err
    else {
        return None;
    };
    if status.as_u16() != 429 {
        return None;
    }
    let retry_after = headers
        .as_ref()
        .and_then(|h| h.get(http::header::RETRY_AFTER))
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|secs| Duration::from_secs(secs).min(MAX_RETRY_AFTER));
    Some(retry_after.unwrap_or_else(|| {
        FLOOR
            .saturating_mul(1u32 << attempt.saturating_sub(1).min(4) as u32)
            .min(MAX_BACKOFF)
    }))
}

/// Identifies a retry path and its associated trace-event layer.
#[derive(Debug, Clone, Copy)]
pub enum RetryOperation {
    HttpRequest,
    Sampling,
    RemoteCompactionV2,
}

/// Emits retry telemetry at the caller's source location without adding it to normal OTEL logs.
#[macro_export]
macro_rules! record_retry {
    ($attempt:expr, $delay:expr, $operation:expr $(,)?) => {{
        let (layer, operation) = match $operation {
            $crate::RetryOperation::HttpRequest => ("http", "request"),
            $crate::RetryOperation::Sampling => ("stream", "sampling"),
            $crate::RetryOperation::RemoteCompactionV2 => ("stream", "remote_compaction_v2"),
        };

        ::tracing::event!(
            target: "codex_otel.trace_safe",
            ::tracing::Level::TRACE,
            event.name = "codex.retry",
            retry.attempt = $attempt,
            retry.delay_ms = ($delay).as_millis() as u64,
            retry.layer = layer,
            retry.operation = operation,
        );
    }};
}

pub async fn run_with_retry<T, F, Fut>(
    policy: RetryPolicy,
    mut make_req: impl FnMut() -> Request,
    op: F,
) -> Result<T, TransportError>
where
    F: Fn(Request, u64) -> Fut,
    Fut: Future<Output = Result<T, TransportError>>,
{
    for attempt in 0..=policy.max_attempts {
        let req = make_req();
        match op(req, attempt).await {
            Ok(resp) => return Ok(resp),
            Err(err)
                if policy
                    .retry_on
                    .should_retry(&err, attempt, policy.max_attempts) =>
            {
                let retry_attempt = attempt + 1;
                let delay = rate_limit_delay(&err, retry_attempt)
                    .unwrap_or_else(|| backoff(policy.base_delay, retry_attempt));
                crate::record_retry!(retry_attempt, delay, RetryOperation::HttpRequest);
                tokio::time::sleep(delay).await;
            }
            Err(err) => return Err(err),
        }
    }
    Err(TransportError::RetryLimit)
}

#[cfg(test)]
mod hcodex_rate_limit_tests {
    use super::*;
    use http::HeaderMap;
    use http::HeaderValue;
    use http::StatusCode;

    fn http_err(status: StatusCode, retry_after: Option<&str>) -> TransportError {
        let mut headers = HeaderMap::new();
        if let Some(value) = retry_after {
            headers.insert(
                http::header::RETRY_AFTER,
                HeaderValue::from_str(value).unwrap(),
            );
        }
        TransportError::Http {
            status,
            url: None,
            headers: Some(headers),
            body: None,
        }
    }

    #[test]
    fn honors_retry_after_seconds_on_429() {
        let err = http_err(StatusCode::TOO_MANY_REQUESTS, Some("3"));
        assert_eq!(rate_limit_delay(&err, 1), Some(Duration::from_secs(3)));
        let err = http_err(StatusCode::TOO_MANY_REQUESTS, Some("600"));
        assert_eq!(rate_limit_delay(&err, 1), Some(Duration::from_secs(60)));
    }

    #[test]
    fn falls_back_to_slow_backoff_without_header() {
        let err = http_err(StatusCode::TOO_MANY_REQUESTS, None);
        assert_eq!(rate_limit_delay(&err, 1), Some(Duration::from_secs(2)));
        assert_eq!(rate_limit_delay(&err, 3), Some(Duration::from_secs(8)));
        assert_eq!(rate_limit_delay(&err, 9), Some(Duration::from_secs(30)));
        let err = http_err(StatusCode::TOO_MANY_REQUESTS, Some("soon"));
        assert_eq!(rate_limit_delay(&err, 1), Some(Duration::from_secs(2)));
    }

    #[test]
    fn leaves_non_429_to_generic_backoff() {
        let err = http_err(StatusCode::SERVICE_UNAVAILABLE, Some("3"));
        assert_eq!(rate_limit_delay(&err, 1), None);
        assert_eq!(rate_limit_delay(&TransportError::Timeout, 1), None);
    }
}
