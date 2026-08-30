feat(telemetry): implement Prometheus metrics collector and secured GET /metrics endpoint

- Implement Prometheus metrics module in `server/metrics.js` with `prom-client`
- Expose default Node.js runtime stats (heap, event loop lag, CPU, handles)
- Add custom gauges: `bitcycles_active_rooms` (public/private), `bitcycles_connected_players`, `bitcycles_ws_clients_active`
- Add custom counters: `bitcycles_rounds_played_total`, `bitcycles_crashes_total`, `bitcycles_ws_messages_sent_total`, `bitcycles_ws_messages_received_total`
- Add game loop tick duration summary `bitcycles_tick_duration_seconds`
- Expose `GET /metrics` in `app.js` with application-level security guard (IP whitelist via METRICS_ALLOWED_IPS and optional Bearer auth via METRICS_TOKEN)
- Add comprehensive test suite in `test/metrics.test.js` verifying gauge calculations, counter increments, and 403/200 security authorization rules
- Document METRICS_ALLOWED_IPS and METRICS_TOKEN in `.env.example`






