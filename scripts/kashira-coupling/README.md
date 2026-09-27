# Shared kashira sweep

This temporary sweep tests a lumped shared-pressure state before promoting the model to the canonical `audio-synthesis-lab`.

The executable source is split into ordered `*.mjs.part` files only to keep connector transfers small. Concatenate them byte-for-byte before running:

```sh
cat scripts/kashira-coupling/*.mjs.part > /tmp/sweep-kashira-coupling.mjs
node --check /tmp/sweep-kashira-coupling.mjs
node /tmp/sweep-kashira-coupling.mjs --out=results-kashira
```

Model under test:

- `Ca = V / (rho c^2)`
- `dp_kashira/dt = (Q_mouth - sum(U_i)) / Ca`
- `Q_mouth = (p_mouth - p_kashira) Ca / tau_recovery`

The volume range is exploratory, not a claim of historical measured kashira volume. The first goal is to find numerically stable pressure-sharing behavior that does not destroy the verified single-pipe threshold behavior.
