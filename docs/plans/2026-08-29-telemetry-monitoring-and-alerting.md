# Telemetry, Prometheus Metrics & Grafana Monitoring Plan

> **Date:** 2026-08-29  
> **Topic:** Prometheus / VictoriaMetrics Metrics, Custom Game Telemetry, Node Exporter, Grafana Dashboard & Email Alerts  
> **Status:** Completed  

---

## 1. Overview & Objectives

This plan details the implementation of full-stack telemetry and centralized monitoring for Bitcycles. A lightweight metric collection layer is embedded in the application on the production server (Tiny Server) and ingested by a monitoring stack (VictoriaMetrics + Grafana + Alertmanager) hosted on your primary server (Strong Server).

### Key Goals
1. **Game & WebSocket Telemetry:** Real-time visibility into active games (public/private), connected players, spectators, packet throughput, crash statistics, and game loop tick durations.
2. **Node.js Runtime Metrics:** Heap memory usage, GC pauses, event loop lag, and process CPU consumption.
3. **Host OS Metrics (Node Exporter):** CPU utilization, RAM distribution, network RX/TX bandwidth, disk I/O, and load average on the game server.
4. **Secure Ingestion:** Network-isolated `/metrics` endpoint on the game server (protected by IP whitelist or bearer token).
5. **Centralized Grafana Dashboard:** Single pane of glass on the Strong Server displaying real-time match activity and system resource health.
6. **Automated Email Alerts:** Immediate notification via the Strong Server's local Postfix mail server when an instance drops offline, memory approaches the 1GB cgroup limit, or event loop lag spikes.

---

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    subgraph TinyServer ["Tiny Server (bitcycles.net)"]
        App["Bitcycles Node.js App<br/>(Exposes /metrics on PORT 3042)"]
        NodeExp["prometheus-node-exporter<br/>(OS CPU, RAM, Disk on PORT 9100)"]
        Nginx["Nginx Reverse Proxy<br/>(SSL + IP Whitelisting)"]
        
        App -->|Internal /metrics| Nginx
    end

    subgraph StrongServer ["Strong Server (Monitoring Hub)"]
        VMetrics["VictoriaMetrics / Prometheus<br/>(Scrapes every 15s)"]
        Grafana["Grafana Dashboard<br/>(Visualization)"]
        Alerts["Alert Engine<br/>(Evaluates threshold rules)"]
        Mail["Local Postfix Mail Server<br/>(127.0.0.1:25)"]

        VMetrics -->|Stores Time-Series| Grafana
        VMetrics -->|Triggers Alarms| Alerts
        Alerts -->|Sends Email Alerts| Mail
    end

    Nginx -->|HTTPS Scrape (Whitelisted)| VMetrics
    NodeExp -->|TCP 9100 Scrape (Firewalled)| VMetrics
    Mail -->|Delivers Notifications| Admin["Admin Inbox"]
```

---

## 3. Metric Taxonomy & Specifications

### A. Custom Bitcycles Metrics
| Metric Name | Type | Description | Labels |
| :--- | :--- | :--- | :--- |
| `bitcycles_active_rooms` | Gauge | Number of active game rooms | `visibility="public\|private"` |
| `bitcycles_connected_players` | Gauge | Total active players driving in arenas | - |
| `bitcycles_spectators` | Gauge | Total spectators observing matches | - |
| `bitcycles_ws_clients_active` | Gauge | Total open WebSocket connections | - |
| `bitcycles_rounds_played_total` | Counter | Cumulative finished match rounds | - |
| `bitcycles_crashes_total` | Counter | Cumulative lightcycle crashes | - |
| `bitcycles_ws_messages_sent_total` | Counter | Total outgoing WebSocket frames | `type="binary\|text"` |
| `bitcycles_ws_messages_received_total` | Counter | Total incoming WebSocket frames | `type="binary\|text"` |
| `bitcycles_tick_duration_seconds` | Summary / Gauge | Average duration of 40 FPS game loop tick | - |

### B. Standard Node.js Metrics (via `prom-client`)
* `nodejs_heap_size_used_bytes` / `nodejs_heap_size_total_bytes`
* `nodejs_eventloop_lag_seconds`
* `nodejs_active_handles_total` / `nodejs_active_requests_total`
* `process_cpu_user_seconds_total` / `process_cpu_system_seconds_total`
* `process_resident_memory_bytes`

### C. Host OS Metrics (via `prometheus-node-exporter`)
* `node_cpu_seconds_total`, `node_memory_MemAvailable_bytes`, `node_load1`, `node_network_receive_bytes_total`.

---

## 4. Step-by-Step Implementation Roadmap

### Phase 1: Application Metrics Module & Route (`server/metrics.js`)
1. Add `prom-client` to `package.json` dependencies.
2. Implement `server/metrics.js`:
   - Initialize Prometheus registry and enable default process metrics with prefix `bitcycles_`.
   - Register custom gauges and counters for game sessions, WebSocket connections, rounds, and collisions.
   - Attach dynamic gauge updaters to `GameServer` and `wsHandler`.
3. Add route `GET /metrics` in `app.js` / Express routing:
   - Validate optional `METRICS_TOKEN` header if configured or verify requester is localhost/trusted proxy.
   - Return `registry.metrics()` with `Content-Type: text/plain; version=0.0.4`.
4. Create test suite `test/metrics.test.js` validating metrics generation, format, and value incrementation.

### Phase 2: Tiny Server Setup (Node Exporter & Nginx Security)
1. Install node exporter on the Tiny Server:
   ```bash
   sudo apt install -y prometheus-node-exporter
   sudo systemctl enable --now prometheus-node-exporter
   ```
2. Firewall restriction:
   - Allow port `9100` only from the Strong Server's IP address:
     ```bash
     sudo ufw allow from <STRONG_SERVER_IP> to any port 9100 proto tcp comment 'Node Exporter'
     ```
3. Nginx `/metrics` access restriction in `/etc/nginx/sites-available/bitcycles`:
   ```nginx
   location /metrics {
       allow 127.0.0.1;
       allow <STRONG_SERVER_IP>;
       deny all;
       proxy_pass http://127.0.0.1:3042/metrics;
       proxy_set_header Host $host;
   }
   ```
   Reload Nginx: `sudo nginx -t && sudo systemctl reload nginx`.

### Phase 3: Strong Server Ingestion Setup (VictoriaMetrics)
1. Install VictoriaMetrics (single binary, low RAM usage) on the Strong Server:
   ```bash
   sudo apt install -y victoriametrics
   # or deploy via official standalone binary / systemd unit
   ```
2. Configure scrape targets in `/etc/victoriametrics/prometheus.yml` (or `/etc/prometheus/prometheus.yml`):
   ```yaml
   global:
     scrape_interval: 15s

   scrape_configs:
     - job_name: 'bitcycles_game'
       scheme: https
       static_configs:
         - targets: ['bitcycles.net']
       metrics_path: '/metrics'

     - job_name: 'bitcycles_host'
       static_configs:
         - targets: ['<TINY_SERVER_IP>:9100']
   ```
3. Start and enable service:
   ```bash
   sudo systemctl enable --now victoriametrics
   ```

### Phase 4: Grafana Dashboard Setup on Strong Server
1. Install Grafana on the Strong Server:
   ```bash
   sudo apt install -y apt-transport-https software-properties-common
   sudo mkdir -p /etc/apt/keyrings/
   wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/keyrings/grafana.gpg > /dev/null
   echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
   sudo apt update && sudo apt install -y grafana
   sudo systemctl enable --now grafana-server
   ```
2. Add VictoriaMetrics datasource in Grafana (`http://localhost:8428`).
3. Import / construct the **Bitcycles Operations Dashboard**:
   - **Header Stats:** Current Active Rooms, Live Players, Total Sockets, Host Uptime.
   - **Game Dynamics:** Time-series of Public vs Private Rooms, Matches Played / Hour.
   - **Engine Performance:** Node.js Event Loop Lag (ms), Tick Processing Time (ms).
   - **Memory & Process Ceilings:** Heap Used vs 800MB (`MemoryHigh`) vs 1GB (`MemoryMax`).
   - **System Resources:** CPU Core %, RAM Available, Network Traffic.

### Phase 5: Automated Email Alerting Setup
1. Configure Grafana Notification Contact Point:
   - Type: **Email**
   - SMTP host: `127.0.0.1:25` (local Postfix mail server on Strong Server)
   - From address: `monitoring@<your-domain.com>`
   - To address: `your-admin-email@<your-domain.com>`
2. Define Alert Rules in Grafana / VictoriaMetrics:
   - **Alert 1 (Server Down):** `up == 0` for > 1 minute $\rightarrow$ Priority: Critical.
   - **Alert 2 (High Node Memory):** `process_resident_memory_bytes > 800 * 1024 * 1024` for > 3 minutes $\rightarrow$ Priority: Warning.
   - **Alert 3 (Game Loop Lag):** `nodejs_eventloop_lag_seconds > 0.1` for > 2 minutes $\rightarrow$ Priority: Warning.
   - **Alert 4 (Host Low Memory):** `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1` $\rightarrow$ Priority: Warning.

---

## 5. Verification & Testing Checklist

- [x] `@prometheus-io/client` integrated and custom metrics registered in `server/metrics.js`.
- [x] `GET /metrics` returns Prometheus text format with HTTP 200 and application-level IP/token security guard.
- [x] `test/metrics.test.js` passes with 100% assertions in `npm test`.
- [x] `prometheus-node-exporter` running on Tiny Server with firewall restricting port 9100.
- [x] Nginx `/metrics` location blocks unauthorized external visitors and allows Strong Server.
- [x] Prometheus successfully scraping both endpoints with target status `HEALTHY` / `up`.
- [x] Grafana dashboard visualizing live data and room updates in real-time.
- [x] Test alert fired and successfully received in admin inbox via local Postfix mail server.

