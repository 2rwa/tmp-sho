# HTTP data channel

Base URL:

`https://2rwa.github.io/tmp-sho/`

## Stable entry point

`data/index.json`

This registry lists published datasets/results that are intended to be consumed without cloning the repository.

## Path convention

```text
data/<task>/<run-id>/<file>
```

Examples:

```text
data/ichi-regression/36242048559/report.json
data/audio-analysis/123456789/summary.csv
data/ocr-gakkaroku/123456790/matches.tsv
```

A task may additionally expose:

```text
data/<task>/latest.json
```

The run-ID path is the provenance-bearing canonical URL. `latest.json` is only a convenience pointer.

## Publication policy

Good Pages payloads:

- JSON / CSV / TSV
- compact text reports
- plots and spectrogram previews
- HTML analysis viewers
- small derived audio snippets when redistribution is allowed

Prefer Actions artifacts for:

- full source PDFs
- hundreds of rendered pages
- large OCR bundles
- long WAV/FLAC files
- large parameter-sweep matrices
- temporary debug material

## Provenance fields

Published result JSON should include when applicable:

- `task`
- `run_id`
- `source_commit`
- `generated_at`
- `input_description`
- `method`
- `parameters`
- `result_files`
- `status`
- `notes`

This allows later analysis to distinguish the current accepted result from earlier failed or superseded runs.
