//! hcodex: delay for a retried HTTP 429 from a third-party provider.
//!
//! Lives in its own file so `retry.rs` stays close to upstream.
use codex_http_client::TransportError;
use std::time::Duration;

/// hcodex: delay for an HTTP 429 that the policy chose to retry (only
/// non-OpenAI providers enable `retry_429`). Honors `Retry-After: <seconds>`
/// when present (capped at 60s); otherwise waits 2s, 4s, 8s, 16s, 30s — a
/// rate limit will not clear in the ~200ms the generic backoff starts at.
pub(super) fn rate_limit_delay(err: &TransportError, attempt: u64) -> Option<Duration> {
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

#[cfg(test)]
mod tests {
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
            retry_after: codex_http_client::RetryAfter::from_headers(&headers),
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
