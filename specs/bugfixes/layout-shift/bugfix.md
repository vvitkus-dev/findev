# Bugfix — Layout shifts while pages load and data arrives

> Found while measuring CLS at the E2E viewport · Fixed in `a5ea774` · Requirements: R1, R19

## Current behaviour

WHEN a page loads and the first data arrives THEN elements move: measured CLS was 0.029 on the Dashboard and 0.031 on Settings at the E2E viewport.

## Expected behaviour

1. THE SYSTEM SHALL NOT shift any element while pages load or data arrives.
2. THE SYSTEM SHALL keep total CLS under 0.01 (what remains is live text replacing "—").

## Unchanged behaviour

- Table content, status texts and navigation are unchanged; only layout is affected.
- Visual baselines change only by the intended layout fixes.

## Root cause

| Shift                                      | Cause                                              | Fix                                                   |
| ------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| Footer moved when the routed page rendered | shell height depended on page content              | shell is a full-height column; `main` fills the space |
| Status pill changed width                  | "Initializing" and "Running" have different widths | fixed minimum width                                   |
| Active nav link pushed its neighbour       | bold text is wider                                 | accent colour and underline only                      |
| Table columns resized on first numbers     | automatic table layout                             | fixed table layout                                    |

## Tasks

- [x] Regression test: `layout-stability.e2e.ts` asserts no element shift and CLS < 0.01.
- [x] Fix each cause; removing the table fix makes the test fail again.
- [x] Re-render visual baselines in the CI image (quality-gates Q3.4).
