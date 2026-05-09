# バナー作成ツール

社内向けのローカル起動用プロトタイプです。商品マスタを登録し、Codex App Server 経由で広告バナー候補を生成・保存・管理します。

## いちばん簡単な起動方法

### Mac

`start-mac.command` をダブルクリックします。

初回だけ `node_modules` のセットアップが走るので少し時間がかかります。ブラウザが自動で開きます。

### Windows

`start-windows.bat` をダブルクリックします。

起動時は専用の黒い画面が開きます。途中でエラーが出ても画面が閉じないようにしているので、表示内容か `public\data\startup-log.txt` を確認できます。

Node.js が入っていないPCでは、起動ファイルがNode.js公式ページを開きます。LTS版をインストールしてからもう一度 `start-windows.bat` を実行します。

Windowsの起動ファイルはアプリ起動だけを担当します。Codexの接続状態は、アプリ画面の「接続テスト」で確認してください。

初回だけ `node_modules` のセットアップが走るので少し時間がかかります。ブラウザが自動で開きます。

## 事前に必要なもの

画像生成まで使うPCには以下が必要です。

- Node.js LTS
- Codex CLI
- Codex にログイン済みの状態

Node.js が入っていない場合、Windowsでは `start-windows.bat` がNode.js公式ページを開きます。Macでは先に https://nodejs.org/ から LTS 版をインストールしてください。

Codex CLI が入っていない場合、画面は開けますが画像生成は動きません。Codex CLI をセットアップしてログインしてください。

Codex CLI が入っていても未ログインの場合、起動ファイルが `codex login` の実行を案内します。アプリ内の「接続テスト」でも未ログイン状態を表示します。

## 手動で起動する場合

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

ブラウザで http://127.0.0.1:3000 を開きます。

## データの保存先

ローカルの画像・履歴は主に以下に保存されます。

- 生成画像: `public/generated`
- ライブラリ保存画像: `public/saved-banners`
- 商品マスタ画像: `public/products`

別PCに同じ状態を渡す場合は、このプロジェクトフォルダごと渡すのが一番簡単です。

## GitHubに含めないデータ

商品マスタ、商品画像、生成画像、ライブラリ保存画像、実行ログはローカルデータとして扱い、Git管理から外しています。

- 商品マスタ: `public/data/products.json`
- ブランドマスタ: `public/data/brands.json`
- 商品マスタ画像: `public/master-images`
- 生成画像: `public/generated`
- ライブラリ保存画像: `public/saved-banners`
- 実行ログ: `public/data/request-log.jsonl`, `public/data/startup-log.txt`

初回クローン直後は商品マスタとブランドマスタが空です。必要に応じてアプリ画面から登録してください。

ブランド選択肢は `.env.local` の `NEXT_PUBLIC_BRAND_OPTIONS` でカンマ区切り指定できます。

## 配布用ZIP

Windowsでも文字化けしにくいよう、起動ファイル名は英数字にしています。

- Mac: `start-mac.command`
- Windows: `start-windows.bat`

生成画像、ライブラリ画像、商品画像、ログは配布ZIPには入れない想定です。

## うまく動かないとき

- 起動ファイルの黒い画面を閉じずに、エラー表示を確認してください。
- `http://127.0.0.1:3000` が開かない場合、すでに別のアプリが3000番ポートを使っている可能性があります。
- 画像生成だけ失敗する場合、Codex CLI のセットアップ・ログイン状態を確認してください。
