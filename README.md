# tmp-sho

笙（shō）の調査・物理音源開発で使う **一時計算 / 長時間 GitHub Actions 用 public repository**。

本体・検証済み資料の保管先は `2rwa/audio-synthesis-lab/projects/sho-physical-synth/`。
この repository は、長時間処理や検証の途中結果を公開し、Pages / Actions artifacts 経由で共有・再確認しながら試行錯誤を進める作業場として使う。

## 役割

ここで主に実行するもの:

- PDF画像化 / OCR
- 大量ページの索引作成
- 音声ファイルの FFT / STFT / スペクトル / loudness / pitch / onset 解析
- 合成音の長時間レンダリング
- 物理モデルの parameter sweep
- 吹奏 / 吸奏の発振閾値探索
- 複数管・匏結合の長時間安定性試験
- 回帰テスト
- 失敗条件の再現

Actions時間を節約することは目的にしない。

## 基本原則

### 1. 1 job = 1つの明確な問い

ページ数や実行時間で細かく分割するのではなく、研究・実装上の問いで分ける。

例:

- 「このPDFから笙の17管実測表を探す」
- 「この録音の定常部の基本周波数と倍音分布を測る」
- 「一管モデルの吹奏/吸奏閾値を0–1000 Paで探索する」
- 「6管合竹を30分相当シミュレーションして発散を探す」

問いが1つなら、数十分〜数時間のjobでも構わない。

### 2. 長時間処理はActionsへ投げて会話を返す

会話側では:

1. タスクを定義
2. workflow / script / manifest をcommit
3. Actions起動を確認
4. 即時エラーだけ確認
5. 会話を返す
6. 次の会話冒頭で結果を見る

同一ターンで長時間pollし続けない。

### 3. 結果はartifact優先

大きな中間生成物:

- page images
- OCR全文
- WAV / FLAC
- spectrogram
- sweep全結果
- diagnostic logs

は原則 Actions artifact にする。

Gitへ戻すものは主に:

- README / report
- 小さいCSV / JSON / TSV
- 検証済みパラメータ
- 再現用script
- 失敗条件
- provenance

### 4. 失敗runも資料

以下は削除対象ではなく研究データ:

- timeout
- numerical divergence
- OCR失敗
- 資料誤同定
- 音声解析で仮説と違う結果
- parameter sweepで発振しない領域

「処理に失敗した」のか「仮説が外れた」のかを分けて記録する。

## public repositoryとしての注意

このrepoはpublic。

したがって:

- 秘密情報・API key・個人情報をcommitしない
- 再配布権のないPDF/音声を永続commitしない
- 外部から一時取得する場合も、公開ログやartifactへ何を残すか確認する
- 自作音声・公開可能音源・public-domain資料は必要に応じて入力として保持可能

## 本体repoへの昇格

`tmp-sho` で得た結果のうち、物理モデルや歴史profileへ採用するものだけを
`audio-synthesis-lab/projects/sho-physical-synth/`
へ移す。

昇格時には最低限:

- source / run ID
- 条件
- 採用値
- confidence
- 既知の失敗 / 制約

を残す。

## GitHub-hosted Actions

public repository の standard GitHub-hosted runner を主に使う。

長い処理は1 jobあたりの上限内で実行し、必要なら「意味のあるタスク単位」で複数jobへ分割する。


## GitHub Pages / HTTPS

Pages endpoint:

`https://2rwa.github.io/tmp-sho/`

Small, reusable outputs are published under stable HTTPS paths so consumers do not need a git checkout.

- registry: `https://2rwa.github.io/tmp-sho/data/index.json`
- immutable run data: `/data/<task>/<run-id>/...`
- mutable convenience pointer: `/data/<task>/latest.json`

Use Pages for compact JSON / CSV / TSV / HTML / SVG / PNG summaries.
Keep large PDFs, page-image sets, WAV/FLAC and bulky sweep output in Actions artifacts unless persistent HTTP access is specifically useful.


## Repository rotation

`tmp-sho` is disposable compute storage, not the canonical archive.

When repository size or history becomes inconvenient:

1. stop adding new heavy outputs to the current repository;
2. keep the old repository and its Pages URLs available as read-only provenance;
3. create the next repository, e.g. `tmp-sho-2`, `tmp-sho-3`;
4. copy only the current workflow/scripts/docs needed to continue;
5. update the active-repository pointer in the canonical project.

Do not spend time rewriting git history merely to reclaim space unless there is a specific reason to preserve the same repository.
