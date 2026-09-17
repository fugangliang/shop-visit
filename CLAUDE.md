# CLAUDE.md — shop-visit（店舗訪問ログPWA・ひいらぎHDグループ）

ひいらぎHDグループ（5社・23ブランド・約277店舗）の店舗をRFが訪問した際の記録をiPhoneで残す個人用PWA。
1訪問＝1レコード（同じ店舗に何度でも記録できる）。観察（◎○△）・対話・課題・写真をチップ選択式で記録し、
エクスポートしてClaude（Code/チャット）に渡し、経営会議・取締役会の現場所見やPJ（リブランディング・統合・再建）の一次情報に再利用する。

## 型（mansion-patrol / rf-tracker / wine-app / swing-app と同族）

- ビルドレス vanilla JS PWA。`docs/` を GitHub Pages（main:/docs）で配信。npm不使用。
- アプリ本体（公開）にはデータを一切含めない。記録は端末のIndexedDBのみ（外部送信なし）。
- **店舗マスターは公式サイトの WP REST API（microCMSキャッシュ・公開情報）からアプリが直接取得**し、IndexedDB `stores` に保持。
  gist配信・publish_config は不要（mansion-patrol との違い）。
  - `https://hiiragi-hd.jp/wp-json/microcms-cache/v1/data/{company,brand,shop}`（limit上限100・offsetで3ページ・CORSはOriginエコー）
  - 起動時に24時間超過で自動更新、設定タブで手動更新。取得失敗時は前回キャッシュで動作。
  - ブランド→会社の対応は brand API 側が空のものがあるため店舗データから導出（31アイス=ES/MW、ポポラマーマ=ES/PM の2社跨ぎ）。
  - 店名は同一モールで重複するため表示は常に「ブランド 店名」（`label`）。

## コミット禁止（.gitignore 済み）

- `data/` — エクスポートされた訪問記録（写真・面談内容・店舗課題を含む。機密）
- `docs/_test.html` — 一時テストページ

## 構成

```
docs/            アプリ本体（公開）: index.html / app.js / style.css / sw.js / manifest / icons
tools/
  bump_version.py   app.js APP_VERSION と sw.js VERSION を同時に更新（二重管理の解消）
  make_icons.py     アイコン生成（依存なし）
data/exports/    iPhoneからエクスポートした記録JSONの置き場（非公開）
```

## データスキーマ

IndexedDB `shop-visit` v1: `visits`（keyPath id, index ts/shopId）・`stores`（keyPath id, index companyId）・`meta`（keyPath key: master / lastExportAt）。

- 店舗（stores）: `{ id, name, label, brandIds[], brandNames[], companyId, companyName, pref, postal_code, address, phone, business_hours, image, updatedAt, manual }`
  手入力店舗は `id: 'm_…'`, `manual: true`。マスター更新時も残る。
- 訪問（visits）: 
  ```
  { id, ts,                                   // ts = 訪問日時（編集可・ISO8601）
    shopId, shopName, brand, brands[], company, pref, manual,   // 店舗の非正規化（閉店で参照切れしない）
    basic:   { slot, mode, companions[], purposes[], meal:{items, priceJudge} },
    observe: { traffic|q|s|c|staff|promo|site|facility: { r: good|ok|bad|null, tags[] } },
    talk:    { roles[], themes[], mood: up|flat|down|null, memo },
    issue:   { judge: good|store|hq|check|null, priority: high|mid|low|null, to[], due, memo },
    memo, photos: [{ id, tag, data }] }       // data = 1280px JPEG q0.8 dataURL
  ```
- エクスポート封筒 `shop-visit-records-v1`: `{ format, exported_at, app, master:{fetched_at,counts}, range:{since,until}, records[], manual_stores[] }`
  「前回以降のみ」は `meta.lastExportAt` より新しい `ts` の記録。ファイル名 `shopvisit_YYYY-MM-DD[_diff].json`。
- 選択肢のキーは固定・ラベルのみ変更可（app.js 冒頭の RATINGS / BASIC / OBSERVE / TALK / ISSUE / PHOTO_TAGS）。集計の連続性のためキーは消さない。
- スキーマ変更時は app.js（export/import・format文字列）と本節を同時更新すること。

## 更新手順

1. アプリ変更 → `python3 tools/bump_version.py`（app.js と sw.js の版を同時更新）→ commit → push（Pages反映 約1分）。版を上げ忘れるとiPhoneのキャッシュが更新されない。
2. 検証: `node --check docs/*.js`。UIスモークは `cd docs && python3 -m http.server 8901` ＋ Chrome（claude-in-chrome MCP）で `_test.html` を開き `#out` を読む（20項目のassert。初回セッション2026-09-17で全PASS）。
   ヘッドレスChrome `--dump-dom` はこのMacではハングしたため使わない。

## 記録の回収フロー（運用）

1. 訪問後、iPhoneの設定タブ →「写真込みJSONを書き出し（全件 or 前回以降のみ）」→ AirDrop/ファイルでMacへ → `data/exports/` に置く。
2. Claude Code に「店舗訪問記録を取り込んで所見を整理して」と依頼。分析の型: 訪問一覧表／会社・ブランド別◎○△集計／
   要改善・本部宛の論点リスト／良好事例リスト／カバレッジ表。**氏名は出さない**（workspace `minutes-redaction-rules` と同じ規律）。
3. 分析成果物の保存先: `~/Documents/Work/1_HD/店舗訪問/`（新設）**[要確認] RF裁定待ち**。
4. 軽い照会はテキストのみコピー→チャット貼付でも可。

## 現状ステータス（2026-09-17）

- 初版 v2026-09-17.1。ローカルで公式API取得（277店/23ブランド/5社）・記録保存・複数回訪問履歴・カバレッジ・export/import を検証済み。
- [要確認] 分析成果物の保存先フォルダ／チップ辞書の語彙（実運用1〜2週で見直し）／近隣ソート（v1.1候補: 国土地理院 AddressSearch API・CORS可・キー不要）の要否。
