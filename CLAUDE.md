# CLAUDE.md — shop-visit（店舗訪問ログPWA・ひいらぎHDグループ）

ひいらぎHDグループ（5社・23ブランド・約277店舗）の店舗をRFが訪問した際の記録をiPhoneで残す個人用PWA。
1訪問＝1レコード（同じ店舗に何度でも記録できる）。訪問日時・時間帯・形態・同行者・目的・実食・写真・メモをチップ選択式で記録し、
店舗ごとのオープン日をアプリ内で保持する。
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

IndexedDB `shop-visit` v2: `visits`（keyPath id, index ts/shopId）・`stores`（keyPath id, index companyId）・`meta`（keyPath key: master / lastExportAt）・
`store_meta`（keyPath shopId: `{ shopId, openDate:'YYYY-MM-DD' }`。オープン日は公式APIに無いためアプリ内で保持。マスター全件置換でも消えない）。

- 店舗（stores）: `{ id, name, label, brandIds[], brandNames[], companyId, companyName, pref, postal_code, address, phone, business_hours, image, updatedAt, manual }`
  手入力店舗は `id: 'm_…'`, `manual: true`。マスター更新時も残る。
- 訪問（visits）: 
  ```
  { id, ts,                                   // ts = 訪問日時（編集可・ISO8601）
    shopId, shopName, brand, brands[], company, pref, manual, openDate,   // 店舗の非正規化（閉店で参照切れしない）
    basic:   { slot, mode, companions[], purposes[], meal:{items, priceJudge} },
    memo, photos: [{ id, tag, data }] }       // data = 1280px JPEG q0.8 dataURL
  ```
  ※ 観察（◎○△）・対話・課題・アクションの各セクションはRF指示（2026-09-17）で削除。v2026-09-17.1 で保存した記録に残る `observe/talk/issue` は無視される。
- エクスポート封筒 `shop-visit-records-v1`: `{ format, exported_at, app, master:{fetched_at,counts}, range:{since,until}, records[], manual_stores[], store_meta[] }`
  インポートは records / manual_stores / store_meta をマージ取込。**オープン日の一括登録**は `{format:'shop-visit-records-v1', records:[], store_meta:[{shopId, openDate}]}` を
  Claude側で作って設定タブから取込すればよい（shopId は公式APIの shop.id）。
  「前回以降のみ」は `meta.lastExportAt` より新しい `ts` の記録。ファイル名 `shopvisit_YYYY-MM-DD[_diff].json`。
- 選択肢のキーは固定・ラベルのみ変更可（app.js 冒頭の RATINGS / BASIC / PHOTO_TAGS）。集計の連続性のためキーは消さない。
- スキーマ変更時は app.js（export/import・format文字列）と本節を同時更新すること。

## 更新手順

1. アプリ変更 → `python3 tools/bump_version.py`（app.js と sw.js の版を同時更新）→ commit → push（Pages反映 約1分）。版を上げ忘れるとiPhoneのキャッシュが更新されない。
2. 検証: `node --check docs/*.js`。UIスモークは `cd docs && python3 -m http.server 8901` ＋ Chrome（claude-in-chrome MCP）で `_test.html` を開き `#out` を読む（22項目のassert。2026-09-17 v2 で全PASS）。
   **ローカル検証でも app.js を変えたら先に `bump_version.py` を実行する**（SWが旧 app.js をcache-firstで返し、変更が反映されない）。
   ヘッドレスChrome `--dump-dom` はこのMacではハングしたため使わない。

## 記録の回収フロー（運用）

1. 訪問後、iPhoneの設定タブ →「写真込みJSONを書き出し（全件 or 前回以降のみ）」→ AirDrop/ファイルでMacへ → `data/exports/` に置く。
2. Claude Code に「店舗訪問記録を取り込んで所見を整理して」と依頼。分析の型: 訪問一覧表／会社・ブランド別◎○△集計／
   要改善・本部宛の論点リスト／良好事例リスト／カバレッジ表。**氏名は出さない**（workspace `minutes-redaction-rules` と同じ規律）。
3. 分析成果物の保存先: `~/Documents/Work/1_HD/店舗訪問/`（新設）**[要確認] RF裁定待ち**。
4. 軽い照会はテキストのみコピー→チャット貼付でも可。

## 現状ステータス（2026-09-17）

- v2026-09-17.2 公開。RF指示で (1) 店舗ごとのオープン日（記録画面で入力・store_meta 保持・行と記録に表示・「開店からN日」）、
  (2) 店舗選択を①都道府県 ②業態 ③法人のドロップダウン（相互に絞り込み・件数付き）に変更、(3) 観察・対話・課題の各セクションを削除。
- 複数回訪問: 1訪問=1レコード。記録画面に「過去の訪問 n回（今回は n+1回目）」と全履歴、店舗行に「最終訪問 N日前（n回）」。
- [要確認] 分析成果物の保存先フォルダ／オープン日の一次情報源（HD側に店舗一覧があれば一括取込JSONをClaudeが生成）／
  チップ辞書の語彙（実運用1〜2週で見直し）／近隣ソート（v1.1候補: 国土地理院 AddressSearch API・CORS可・キー不要）の要否／iPhone実機未確認。
