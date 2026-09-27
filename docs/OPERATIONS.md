# tmp-sho operations

## Canonical vs scratch

- canonical implementation/evidence: `2rwa/audio-synthesis-lab`
- heavy temporary compute: `2rwa/tmp-sho`

## Preferred task shape

Each task should define:

- **question** — what are we trying to learn?
- **input** — source file / URL / generated audio / model commit
- **method** — OCR / FFT / simulation / sweep / render
- **output** — artifact + compact report
- **exit condition** — what counts as enough information?

This prevents both failure modes seen in the earlier shō research:

1. overly broad source reading;
2. artificially tiny jobs that create coordination overhead.

## OCR

OCR is navigation/indexing unless the source is born-digital text.

For historical scans:

`OCR -> candidate page -> page-image verification -> evidence`

Do not ingest historical numeric values from OCR alone.

## Audio analysis

When audio becomes available, prefer reproducible batch analysis that emits both machine-readable and visual outputs:

- `ffprobe` metadata
- peak / RMS / DC
- EBU R128 / LUFS where useful
- FFT / STFT
- fundamental-frequency tracks
- harmonic amplitudes
- spectral centroid / slope
- onset / attack / release
- steady-state segment extraction
- blow/draw comparison
- WAV/FLAC excerpts only when redistribution is allowed

Analysis scripts and parameter files should be committed; large audio outputs should normally remain artifacts.

## Simulation

Parameter sweeps should record the full parameter vector, not only the chosen winner.

At minimum keep:

- git SHA of engine source
- sample rate
- duration
- pressure / direction
- reed parameters
- pipe parameters
- kashira parameters
- numerical stability status
- measured output metrics

## Conversation handoff

After dispatch:

- inspect initial job state once;
- if there is no immediate failure, return the conversation;
- inspect the completed artifact/report at the start of the next turn.
