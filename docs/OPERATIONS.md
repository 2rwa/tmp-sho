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


## HTTP result channel

GitHub Pages provides a second result channel in addition to git and Actions artifacts.

### Layout

```text
/
├── index.html
└── data/
    ├── index.json
    └── <task>/
        ├── latest.json
        └── <run-id>/
            ├── report.json
            ├── summary.csv
            └── ...
```

### Rules

- `data/index.json` is the global machine-readable registry.
- A run-ID directory is immutable after publication whenever practical.
- `latest.json` may change and points to the newest accepted run for that task.
- Prefer run-ID URLs in research notes so old results remain reproducible.
- Pages is for compact/reusable outputs; Actions artifacts remain the transport for bulky intermediates.
- Do not publish inputs or derived material that cannot legally be redistributed.
- Do not publish secrets, private URLs, tokens, or personal data.

### Why both artifact and Pages?

**Artifact**
- large
- temporary
- ideal for raw OCR images, audio files, full sweeps

**Pages**
- stable HTTPS
- easy for scripts and later ChatGPT turns to fetch
- ideal for accepted summaries, plots, small machine-readable datasets and interactive result viewers

### Cache-safe pattern

Because Pages/CDN caches may outlive a commit briefly, prefer immutable URLs containing the Actions run ID. Use `latest.json` only as a convenience pointer.


## Repository rollover

This repository is expected to accumulate OCR outputs, analysis data, generated media, and workflow history.

When it becomes too large or awkward to maintain, prefer **rollover** over aggressive cleanup.

Recommended naming:

```text
tmp-sho
tmp-sho-2
tmp-sho-3
...
```

Rollover procedure:

1. mark the current repository as frozen for new heavy jobs;
2. leave existing Pages/run-ID URLs intact;
3. create the next public repository;
4. bring forward only:
   - workflows,
   - analysis scripts,
   - compact docs,
   - current manifests/configuration;
5. do not copy large historical artifacts unless they are still actively needed;
6. update the canonical `audio-synthesis-lab` checkpoint with:
   - active tmp repository name,
   - predecessor repository,
   - rollover date,
   - reason;
7. keep old repositories as provenance rather than deleting them immediately.

The canonical project should never depend on a mutable `latest` pointer from only one scratch repository. Important conclusions must be promoted back to `audio-synthesis-lab`.
