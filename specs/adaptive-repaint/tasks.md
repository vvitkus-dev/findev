# Adaptive Repaint — Tasks

> Spec phase 3 of 3 · Previous: [requirements.md](requirements.md), [design.md](design.md)
>
> Delivered in commit `fae615e` (`feat(producer): limit table repaints adaptively when the device cannot keep up`).

- [x] **T1** `RepaintPacer` with injected frames, timers and clock · _AR1–AR4_
  - Control check: `npx ng test --watch=false --include src/app/core/producer/repaint-pacer.spec.ts` green; an earlier version that judged every frame throttled during start-up in the CI container, so the spec "long frames without repaints (start-up, GC) never throttle" guards it.
- [x] **T2** Wire the pacer into `ProducerStore`: every snapshot is processed, Apply drops and Pause flushes the deferred repaint · _AR5, AR7, AR8_
  - Control check: `producer-store-pacing.spec.ts` green; `test:ci` keeps `core/producer/**` ≥ 85 %.
- [x] **T3** `repaintsLimited` signal and a caption note at the end of its line · _AR6_
  - Control check: `layout-stability.e2e.ts` shows no element shift.
- [x] **T4** Performance check: 20× CPU, accessibility tree on, 40 s at maximum load · _R19_
  - Result: 56.5 fps and 0.2 long tasks/s, against 34.5 fps and 4.8/s before. It never engages at 1× or 4×, or at the default rate.
