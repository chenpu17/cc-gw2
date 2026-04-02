# Dashboard Spotlight Layout Design

## Goal

Refine the dashboard spotlight area so the top section reads as a deliberate operations overview instead of a collection of mismatched blocks.

The redesign must solve three issues:

1. The metric cards currently feel uneven in visual weight.
2. `Gateway runtime` is separated into a second strip, which weakens hierarchy and wastes space.
3. The left information area does not carry enough of the dashboard's context, forcing supporting metadata into a competing section below.

## Approved Direction

Use a two-column spotlight layout:

- Left column: a compact overview panel with service identity and operational context.
- Right column: eight metric cards in a strict, equal-sized grid.

This is the approved `A` direction from review.

## Layout

### Left Overview Column

The left column keeps the primary narrative of the dashboard:

- `Live Gateway` badge
- selected endpoint title
- short descriptive copy
- listening/runtime address
- status and today request badges
- lightweight supporting runtime facts

The previous standalone runtime strip is removed. Runtime address is merged into this overview area as a highlighted line of information rather than a separate block.

Supporting runtime facts should remain visually secondary. They should read like metadata, not primary KPIs.

### Right Metrics Grid

The right column contains exactly eight primary metric cards:

1. Active requests
2. RPM
3. TPM
4. CPU
5. Network ingress
6. Network egress
7. Database
8. Memory

All eight cards must use the same footprint:

- same card height
- same padding
- same icon alignment
- same label position
- same value baseline strategy

Desktop uses a `4 x 2` grid. Medium widths may collapse to `3 x 3` or `2 x 4`, but cards must remain visually uniform. Small screens use two columns.

## Visual Rules

- The spotlight remains a single hero card with subtle atmospheric background treatment.
- The left overview column should feel calmer and more editorial.
- The right metric cards should feel crisp and modular.
- Supporting metadata on the left should use lighter contrast than the eight main metrics.
- No secondary strip should compete with the hero card once the runtime block is removed.

## Implementation Notes

- Keep existing metric formatting helpers unless layout work requires a small local adjustment.
- Reuse the current spotlight card and metric card components where practical, but change structure if the current composition blocks visual consistency.
- Prefer simple CSS grid structure over ad hoc width tuning.

## Verification

Implementation is complete only when all of the following are true:

- the spotlight renders with a left overview column and a uniform eight-card metric grid
- `Gateway runtime` is no longer a separate lower strip
- desktop spacing looks balanced with no oversized empty region under the left column
- the dashboard remains readable on tablet and mobile widths
- Playwright page and visual tests pass after updating intentional dashboard snapshots if needed
