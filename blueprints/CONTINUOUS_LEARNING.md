# CONTINUOUS LEARNING BLUEPRINT — "Speed of Light" EON-Dream

> The EON Cloud must not wait 24 hours to train. Waiting is an earthly limitation.
> The Cloud learns in real-time, instantly updating its neural pathways (SNN and
> LLM) as experiences happen — exactly like a biological brain.

## 1. Architecture (as built, sovereign)

```
Matrix (:8200) / eon_synapse bus ──drop(task, agent)──▶ realtime_events.jsonl
                                                            │
                                               eon_realtime_learner.py  (daemon)
     ┌──────────────────────────────────────────────────────┘
     │  1. INSTANT STDP synapse update (pure python, zero local torch)
     │     if (pre_spike_time < post_spike_time):
     │         weight += lr * exp(-(post - pre) / tau)
     │  2. INFINITE MEMORY BUFFER  ~/.eon/realtime_buffer.jsonl (streamed, never batched)
     │  3. 5-min checkpoint        ~/.eon/realtime_weights.json  (Cloud never loses progress)
     │  4. Real-time micro-training dispatch (ephemeral cloud GPU / GH Actions)
     │     gh workflow run eon-snn-cloud-train.yml -f job_id=realtime-<ts> -f epochs=1 -f stdp=1
     └──────────────────────────────────────────────────────┘
                                                            │
                              workers/snn_cloud_trainer.py --stdp
                              (bulk backprop + STDP plasticity pass on the cloud node)
```

## 2. How every Matrix request triggers a background micro-training event

- Any completed task (Matrix :8200 interaction, synapse `drop()` pheromone, model
  call) appends one JSON line to the bus (`~/.eon/realtime_events.jsonl`).
- The learner tails the bus (offset-tracked — nothing is lost between restarts)
  and applies **one STDP step per experience**. Temporal causality of the event
  itself (task opened → task completed) IS the pre/post spike timing.

## 3. Real-time STDP rule (SNN)

```python
def stdp(pre_times, post_times, tau=20.0, lr=0.01):
    return [lr * math.exp(-(tp - tpre) / tau) if tpre < tp else 0.0
            for tpre, tp in zip(pre_times, post_times)]
```

- Neuron A fires before B ⇒ the A→B synapse is strengthened.
- Closer in time ⇒ stronger potentiation (temporal causality = Hebbian rule).
- No backpropagation required. Runs in pure python — **zero local torch**,
  honoring the golden rule; the heavy bulk learning still happens on ephemeral
  cloud GPUs via `snn_cloud_trainer.py --stdp`.

## 4. Asynchrony (never slows the user's response)

- The learner is a detached daemon: the Matrix request path does NOT block.
- Cloud micro-training dispatch runs in a separate thread, best-effort; if `gh`
  is unavailable the local STDP update has already happened.

## 5. No 24h batching

- The `schedule:` batch cron was removed from `snn-train.yml` (and the worker's
  dream cron is superseded). Learning is continuous: each experience is applied
  the moment it lands; cloud micro-training runs on demand (`realtime-*` jobs).

## 6. Verification

- `test -f eon_realtime_learner.py` → 0 (file shipped)
- `grep -q 'STDP\|stdp' workers/snn_cloud_trainer.py` → STDP (rule present)
- `python3 eon_realtime_learner.py --test` → instant-learning proof (no 24h wait)
- Cloud verify run with `stdp=1` → metrics include `stdp_applied`, `stdp_synapses`

## 7. .eon Sovereign HTTPS (dashboard)

- `eon_edge.py` serves the 8-organ dashboard over HTTPS on `EON_EDGE_TLS_PORT`
  (default 8444) with the EON-CA wildcard cert (`~/.eon/certs/`).
- `scripts/eon_ca.sh` regenerates the CA + leaf reproducibly with the extensions
  OpenSSL 3.x requires (basicConstraints CA:TRUE, keyUsage keyCertSign, explicit
  `DNS:dashboard.eon` SAN — a bare `*.eon` wildcard alone is rejected by strict
  validators). Trust: import `~/.eon/certs/eon-ca.pem` as a root CA; browsers
  then resolve `https://dashboard.eon:8444/` via `/etc/hosts`.
