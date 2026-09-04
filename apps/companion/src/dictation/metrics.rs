use std::{
    convert::Infallible,
    fmt::Write as _,
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    task::{Context, Poll},
    time::Instant,
};

use bytes::Bytes;
use futures_util::Stream;
use reqwest::{
    Response,
    dns::{Addrs, Name, Resolve, Resolving},
    header::HeaderMap,
};
use tower_layer::Layer;
use tower_service::Service;
use tracing::{info, warn};

const AUDIO_BODY_CHUNK_BYTES: usize = 64 * 1024;
const UNOBSERVED: u64 = u64::MAX;

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

tokio::task_local! {
    static CURRENT_REQUEST: Arc<RequestNetworkProbe>;
}

pub(super) struct MeasuredResponse {
    pub(super) response: Response,
    pub(super) request_id: u64,
    pub(super) total_started: Instant,
}

pub(super) struct ResponseHeaderObservation {
    pub(super) request_id: u64,
    pub(super) auth_read_ms: u64,
    pub(super) request_build_ms: u64,
    pub(super) request_to_headers_ms: u64,
    pub(super) audio_bytes: u64,
    pub(super) attempt: usize,
    pub(super) reason: &'static str,
}

pub(super) struct RequestNetworkProbe {
    request_id: u64,
    dns_ms: AtomicU64,
    connect_total_ms: AtomicU64,
}

impl RequestNetworkProbe {
    pub(super) fn new(request_id: u64) -> Arc<Self> {
        Arc::new(Self {
            request_id,
            dns_ms: AtomicU64::new(UNOBSERVED),
            connect_total_ms: AtomicU64::new(UNOBSERVED),
        })
    }

    fn dns_ms(&self) -> Option<u64> {
        observed(self.dns_ms.load(Ordering::Relaxed))
    }

    fn connect_total_ms(&self) -> Option<u64> {
        observed(self.connect_total_ms.load(Ordering::Relaxed))
    }
}

#[derive(Clone)]
pub(super) struct UploadProbe {
    first_chunk_ms: Arc<AtomicU64>,
    last_chunk_ms: Arc<AtomicU64>,
}

impl UploadProbe {
    fn new() -> Self {
        Self {
            first_chunk_ms: Arc::new(AtomicU64::new(UNOBSERVED)),
            last_chunk_ms: Arc::new(AtomicU64::new(UNOBSERVED)),
        }
    }

    fn observe_first_chunk(&self, elapsed_ms: u64) {
        let _ = self.first_chunk_ms.compare_exchange(
            UNOBSERVED,
            elapsed_ms,
            Ordering::Relaxed,
            Ordering::Relaxed,
        );
    }

    fn observe_last_chunk(&self, elapsed_ms: u64) {
        self.last_chunk_ms.store(elapsed_ms, Ordering::Relaxed);
    }

    fn first_chunk_ms(&self) -> Option<u64> {
        observed(self.first_chunk_ms.load(Ordering::Relaxed))
    }

    fn last_chunk_ms(&self) -> Option<u64> {
        observed(self.last_chunk_ms.load(Ordering::Relaxed))
    }
}

struct InstrumentedAudioBody {
    bytes: Bytes,
    offset: usize,
    started: Instant,
    probe: UploadProbe,
}

impl Stream for InstrumentedAudioBody {
    type Item = Result<Bytes, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if self.offset >= self.bytes.len() {
            return Poll::Ready(None);
        }
        let elapsed_ms = elapsed_millis(self.started.elapsed());
        self.probe.observe_first_chunk(elapsed_ms);
        let end = self
            .offset
            .saturating_add(AUDIO_BODY_CHUNK_BYTES)
            .min(self.bytes.len());
        let chunk = self.bytes.slice(self.offset..end);
        self.offset = end;
        if self.offset == self.bytes.len() {
            self.probe.observe_last_chunk(elapsed_ms);
        }
        Poll::Ready(Some(Ok(chunk)))
    }
}

pub(super) fn instrumented_audio_body(
    bytes: Bytes,
    started: Instant,
) -> (reqwest::Body, UploadProbe) {
    let probe = UploadProbe::new();
    let body = reqwest::Body::wrap_stream(InstrumentedAudioBody {
        bytes,
        offset: 0,
        started,
        probe: probe.clone(),
    });
    (body, probe)
}

pub(super) fn next_request_id() -> u64 {
    NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

pub(super) async fn request_metrics<Output>(
    probe: Arc<RequestNetworkProbe>,
    future: impl Future<Output = Output>,
) -> Output {
    CURRENT_REQUEST.scope(probe, future).await
}

pub(super) fn log_response_headers(
    response: &Response,
    upload_probe: &UploadProbe,
    network_probe: &RequestNetworkProbe,
    observation: &ResponseHeaderObservation,
) {
    let first_audio_chunk_ms = upload_probe.first_chunk_ms();
    let last_audio_chunk_ms = upload_probe.last_chunk_ms();
    let audio_source_drain_ms = first_audio_chunk_ms
        .zip(last_audio_chunk_ms)
        .map(|(first_chunk_ms, last_chunk_ms)| last_chunk_ms.saturating_sub(first_chunk_ms));
    let post_audio_source_to_headers_ms = last_audio_chunk_ms.map(|last_chunk_ms| {
        observation
            .request_to_headers_ms
            .saturating_sub(last_chunk_ms)
    });
    let headers = response.headers();
    let server_timing = server_timing_summary(headers);
    let dns_ms = network_probe.dns_ms();
    let connect_total_ms = network_probe.connect_total_ms();
    let transport_setup_ms =
        connect_total_ms.map(|connect_ms| connect_ms.saturating_sub(dns_ms.unwrap_or_default()));
    info!(
        status = "dictation-openai-request",
        request_id = observation.request_id,
        http_status = response.status().as_u16(),
        auth_read_ms = observation.auth_read_ms,
        request_build_ms = observation.request_build_ms,
        request_to_headers_ms = observation.request_to_headers_ms,
        connection_reused = connect_total_ms.is_none(),
        dns_ms = ?dns_ms,
        connect_total_ms = ?connect_total_ms,
        transport_setup_ms = ?transport_setup_ms,
        pre_audio_source_ms = ?first_audio_chunk_ms,
        audio_source_first_chunk_ms = ?first_audio_chunk_ms,
        audio_source_last_chunk_ms = ?last_audio_chunk_ms,
        audio_source_drain_ms = ?audio_source_drain_ms,
        post_audio_source_to_headers_ms = ?post_audio_source_to_headers_ms,
        audio_bytes = observation.audio_bytes,
        response_content_length = ?response.content_length(),
        upstream_processing_ms = ?numeric_header(headers, "openai-processing-ms"),
        upstream_service_ms = ?numeric_header(headers, "x-envoy-upstream-service-time"),
        server_timing_metric_count = server_timing.metric_count,
        server_timing_max_ms = ?server_timing.max_duration_ms,
        server_timing_total_ms = server_timing.total_duration_ms,
        server_timing = server_timing.metrics,
        upstream_request_id = ?opaque_header(headers, "x-request-id")
            .or_else(|| opaque_header(headers, "openai-request-id")),
        cloudflare_ray_id = ?opaque_header(headers, "cf-ray"),
        attempt = observation.attempt,
        reason = observation.reason,
    );
}

pub(super) fn log_request_failure(
    error: &reqwest::Error,
    upload_probe: &UploadProbe,
    network_probe: &RequestNetworkProbe,
    observation: &ResponseHeaderObservation,
) {
    let first_audio_chunk_ms = upload_probe.first_chunk_ms();
    let last_audio_chunk_ms = upload_probe.last_chunk_ms();
    let audio_source_drain_ms = first_audio_chunk_ms
        .zip(last_audio_chunk_ms)
        .map(|(first_chunk_ms, last_chunk_ms)| last_chunk_ms.saturating_sub(first_chunk_ms));
    warn!(
        status = "dictation-openai-request-failed",
        request_id = observation.request_id,
        auth_read_ms = observation.auth_read_ms,
        request_build_ms = observation.request_build_ms,
        request_elapsed_ms = observation.request_to_headers_ms,
        dns_ms = ?network_probe.dns_ms(),
        connect_total_ms = ?network_probe.connect_total_ms(),
        pre_audio_source_ms = ?first_audio_chunk_ms,
        audio_source_first_chunk_ms = ?first_audio_chunk_ms,
        audio_source_last_chunk_ms = ?last_audio_chunk_ms,
        audio_source_drain_ms = ?audio_source_drain_ms,
        audio_bytes = observation.audio_bytes,
        attempt = observation.attempt,
        reason = observation.reason,
        is_connect = error.is_connect(),
        is_timeout = error.is_timeout(),
        is_request = error.is_request(),
        is_body = error.is_body(),
        err = ?error,
    );
}

#[derive(Clone, Default)]
struct ServerTimingSummary {
    metric_count: u64,
    max_duration_ms: Option<f64>,
    total_duration_ms: f64,
    metrics: String,
}

fn server_timing_summary(headers: &HeaderMap) -> ServerTimingSummary {
    let mut summary = ServerTimingSummary::default();
    for value in headers.get_all("server-timing") {
        let Ok(value) = value.to_str() else {
            continue;
        };
        for metric in value.split(',') {
            if summary.metric_count >= 16 {
                break;
            }
            let metric_name = metric.split(';').next().and_then(safe_metric_name);
            let Some(duration) = metric.split(';').find_map(parse_server_duration) else {
                continue;
            };
            summary.metric_count = summary.metric_count.saturating_add(1);
            summary.total_duration_ms += duration;
            summary.max_duration_ms = Some(
                summary
                    .max_duration_ms
                    .map_or(duration, |current| current.max(duration)),
            );
            if let Some(metric_name) = metric_name
                && summary.metrics.len() < 256
            {
                if !summary.metrics.is_empty() {
                    summary.metrics.push(',');
                }
                let _ = write!(summary.metrics, "{metric_name}={duration}");
                summary.metrics.truncate(256);
            }
        }
    }
    summary
}

fn safe_metric_name(raw: &str) -> Option<&str> {
    let name = raw.trim();
    (!name.is_empty()
        && name.len() <= 32
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')))
    .then_some(name)
}

fn parse_server_duration(parameter: &str) -> Option<f64> {
    let value = parameter.trim().strip_prefix("dur=")?.trim_matches('"');
    value
        .parse::<f64>()
        .ok()
        .filter(|duration| duration.is_finite() && *duration >= 0.0)
}

fn numeric_header(headers: &HeaderMap, name: &'static str) -> Option<f64> {
    headers
        .get(name)?
        .to_str()
        .ok()?
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

fn opaque_header<'headers>(
    headers: &'headers HeaderMap,
    name: &'static str,
) -> Option<&'headers str> {
    let value = headers.get(name)?.to_str().ok()?.trim();
    (!value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':')))
    .then_some(value)
}

fn observed(value: u64) -> Option<u64> {
    (value != UNOBSERVED).then_some(value)
}

fn elapsed_millis(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[derive(Clone, Copy)]
pub(super) struct MetricsConnectorLayer;

impl<Service> Layer<Service> for MetricsConnectorLayer {
    type Service = MetricsConnector<Service>;

    fn layer(&self, inner: Service) -> Self::Service {
        MetricsConnector { inner }
    }
}

#[derive(Clone)]
pub(super) struct MetricsConnector<Service> {
    inner: Service,
}

impl<Inner, Request> Service<Request> for MetricsConnector<Inner>
where
    Inner: Service<Request> + Send,
    Inner::Future: Send + 'static,
    Inner::Response: Send + 'static,
    Inner::Error: Send + 'static,
{
    type Response = Inner::Response;
    type Error = Inner::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(context)
    }

    fn call(&mut self, request: Request) -> Self::Future {
        let started = Instant::now();
        let probe = current_request_probe();
        let future = self.inner.call(request);
        Box::pin(async move {
            let result = future.await;
            let connect_total_ms = elapsed_millis(started.elapsed());
            if let Some(probe) = &probe {
                probe
                    .connect_total_ms
                    .store(connect_total_ms, Ordering::Relaxed);
            }
            info!(
                status = "dictation-http-connect",
                request_id = ?probe.as_ref().map(|probe| probe.request_id),
                connect_total_ms,
                succeeded = result.is_ok(),
            );
            result
        })
    }
}

#[derive(Default)]
pub(super) struct MetricsDnsResolver;

impl Resolve for MetricsDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        let started = Instant::now();
        let probe = current_request_probe();
        Box::pin(async move {
            let result = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map(|addresses| {
                    let addresses = addresses.collect::<Vec<_>>();
                    Box::new(addresses.into_iter()) as Addrs
                })
                .map_err(|error| {
                    Box::new(error) as Box<dyn std::error::Error + Send + Sync + 'static>
                });
            let dns_ms = elapsed_millis(started.elapsed());
            if let Some(probe) = &probe {
                probe.dns_ms.store(dns_ms, Ordering::Relaxed);
            }
            info!(
                status = "dictation-http-dns",
                request_id = ?probe.as_ref().map(|probe| probe.request_id),
                host,
                dns_ms,
                succeeded = result.is_ok(),
            );
            result
        })
    }
}

fn current_request_probe() -> Option<Arc<RequestNetworkProbe>> {
    CURRENT_REQUEST.try_with(Arc::clone).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    #[test]
    fn server_timing_ignores_descriptions_and_invalid_durations() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "server-timing",
            HeaderValue::from_static("queue;dur=12.5;desc=private, infer;dur=37, bad;dur=-1"),
        );

        let summary = server_timing_summary(&headers);

        assert_eq!(summary.metric_count, 2);
        assert_eq!(summary.max_duration_ms, Some(37.0));
        assert!((summary.total_duration_ms - 49.5).abs() < f64::EPSILON);
        assert_eq!(summary.metrics, "queue=12.5,infer=37");
    }

    #[test]
    fn opaque_header_accepts_ids_but_rejects_content() {
        let mut headers = HeaderMap::new();
        headers.insert("x-request-id", HeaderValue::from_static("req_1234-abcd"));
        assert_eq!(
            opaque_header(&headers, "x-request-id"),
            Some("req_1234-abcd")
        );

        headers.insert(
            "x-request-id",
            HeaderValue::from_static("contains user content"),
        );
        assert_eq!(opaque_header(&headers, "x-request-id"), None);
    }
}
