# Blow / draw asymmetry sweep

## Research question

Can the measured shō threshold split (approximately +370 Pa blowing versus 90 Pa drawing magnitude for the ichi baseline) be reproduced without a direction-specific threshold hack?

## Literature-motivated missing terms

Hikichi, Osaka and Itakura (JASA 113, 1092–1101, 2003; DOI `10.1121/1.1534605`) explicitly report that their symmetric model gives coincident positive/negative thresholds while the experiment does not. They point to two missing effects:

1. the real reed is slightly asymmetric; its back is chiseled and it leaves the slot more easily while drawing;
2. the upstream/downstream configuration differs with flow direction.

The canonical v0.1 engine also uses an even aperture function `F(x)` and a single contraction coefficient `C`, so these are direct model omissions rather than ad-hoc threshold corrections.

## Minimal candidate terms

The sweep adds two independent first-order parameters while preserving the v0.1 equations otherwise:

- `drawEscapeScale`: for negative reed displacement only, scale displacement before evaluating aperture area. This keeps the rest clearance unchanged but makes aperture grow faster on the draw-favoured side, standing in for the chiseled/thickness geometry omitted by the 2003 model.
- `drawContractionRatio`: multiply the Bernoulli contraction coefficient only when the instantaneous reed pressure difference is negative. This stands in for upstream/downstream flow-configuration asymmetry.

`1.0 / 1.0` is the symmetric control.

## Symmetric calibration dimensions

The 2003 paper also treats reed Q and added mass as threshold-sensitive physical parameters. The full sweep therefore varies:

- reed Q: `8, 10, 12, 15, 20`
- added mass rate: `0, 0.15, 0.30`
- draw escape scale: `1, 1.25, 1.5, 2`
- draw contraction ratio: `1, 1.25, 1.5`

This separates two questions:

- can Q / mass place the symmetric baseline near the blow threshold?
- can geometry / flow asymmetry lower only the draw threshold toward the measured value?

## Regression guard

The current canonical regression samples 200 Pa and 300 Pa but not the interval between them. A 5 Pa local refinement of the same equations places the symmetric Q=20, mass=0.15 onset at about 205 Pa, so the script checks that the refined onset remains inside the canonical `200 Pa off / 300 Pa on` bracket and remains exactly symmetric.

## Outputs

Large/full probe data are stored as an Actions artifact. Compact `summary.json`, `summary.csv`, and `index.html` are written under:

`data/blow-draw-asymmetry/<run-id>/`

and `data/blow-draw-asymmetry/latest.json` points to the newest compact result.
