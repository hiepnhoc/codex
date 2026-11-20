# Performance Verification Checklist

Performance work requires a reproducible baseline and comparable after-measurement.

- [ ] Define the user-visible symptom or explicit performance budget.
- [ ] Record environment, dataset, command/tool, warmup, sample count, and variance.
- [ ] Measure before changing code; do not optimize from intuition alone.
- [ ] Identify the dominant bottleneck with profiling/tracing evidence.
- [ ] Change one meaningful variable at a time where practical.
- [ ] Re-run the same measurement after the change with comparable conditions.
- [ ] Compare the delta against run-to-run variance; compare median and tail behavior where latency matters.
- [ ] Keep only improvements that beat the threshold/noise while correctness remains green.
- [ ] Revert neutral, worse, or correctness-breaking experiments.
- [ ] Record kept and reverted attempts so failed ideas are not repeated.
- [ ] Verify memory, CPU, network, bundle, database, or browser costs relevant to the bottleneck.
- [ ] Add a benchmark, budget, alert, or regression guard when stable and worthwhile.

Report before/after numbers, measurement method, confidence/variance, keep/revert verdict, tradeoffs, and remaining bottlenecks.
