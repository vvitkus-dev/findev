# Bugfix — First frame painted before bindings shifts the layout

> Found by CI's E2E container (slower than local runs) · Fixed in `4ccc48d` · Requirements: R1, R19
> Follow-up to [layout-shift](../layout-shift/bugfix.md).

## Current behaviour

WHEN the CPU is slow THEN a frame can be painted between Angular's creation pass and its first update pass:

1. Settings: the buttons are painted at the top, then pushed down 227 px by the field rows (CLS 0.021).
2. Status pill: painted 4 px tall before its label text appears.

`layout-stability.e2e.ts` failed in 5 of 10 Dashboard runs and in every Settings run in the CI image.

## Expected behaviour

THE SYSTEM SHALL lay out the first painted frame the same as the final one, on any CPU speed.

## Unchanged behaviour

- Form behaviour and validation (R8, R9) and the field order are unchanged.
- The pill still shows the producer status (R7).

## Root cause

Angular creates a view's static elements in the creation pass, but `@for` rows and interpolated
text only in the first update pass. The Settings field rows were `@for` rows, and the pill's label
is projected binding text.

## Fix

- Each Settings row is a static `SettingsField` component, built in the parent's creation pass; the static rate text sits outside the binding.
- The pill is at least one line tall.

## Tasks

- [x] Reproduce in the CI Playwright image with `layout-stability.e2e.ts` (red).
- [x] Fix the Settings rows and the pill.
- [x] Control check: `layout-stability` passes 30 of 30 runs in the CI image.
