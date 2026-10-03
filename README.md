# stack-chan-now-playing

[English](README.en.md)

M5Stack CoreS3にSpotifyの再生中ジャケット、再生状態、進捗を表示し、
画面タップで再生操作できるセルフホスト型コンパニオンです。

個人・非商用利用を目的とした実験的なプロジェクトです。Spotifyとは
提携・承認・後援関係にありません。SpotifyはSpotify ABの商標です。

## 構成

```text
Spotify Web API ---------------------> server/ <-> firmware/ (CoreS3)
                                         ^
macOS Spotify app --AppleScript---------+
```

CoreS3はLAN内のサーバーから、表示に必要な小さなJSONだけを取得します。
Spotifyの認証情報とリフレッシュトークンはセルフホストしたサーバーに保存され、
CoreS3には渡りません。

## Spotifyバックエンド

`.env`の`SPOTIFY_BACKEND`で選択します。

- `auto`: macOSアプリを優先し、失敗時にWeb APIへフォールバック
- `macos`: macOS版SpotifyアプリをAppleScriptで直接読み取り・操作
- `web-api`: Spotify Web APIのみを使用。macOS以外でも利用可能

Web APIからの状態取得は、既定で30秒に1回までです。その間はサーバーの
キャッシュを返します。再生・一時停止・前曲・次曲の操作は即時送信します。

## サーバー

必要なもの：Node.js 24以降

### macOSバックエンドだけを使う場合

1. macOS版Spotifyアプリをインストールして起動します。
2. `.env.example`を`.env`へコピーします。
3. `SPOTIFY_BACKEND=macos`に変更します。
4. `npm run server`でサーバーを起動します。

初回はmacOSからSpotifyを操作するAutomation権限を求められる場合があります。
この構成ではSpotify Developer AppやOAuth認証は不要です。

### Web APIを使う場合

1. Spotify Developer Dashboardで自分専用のアプリを作成します。
2. Redirect URIに`http://127.0.0.1:8789/auth/callback`を登録します。
3. `.env.example`を`.env`へコピーし、Client IDとClient Secretを設定します。
4. `SPOTIFY_BACKEND=web-api`または`auto`を選びます。
5. `npm run server`でサーバーを起動します。
6. <http://127.0.0.1:8789/auth/login>を一度開いてSpotifyを認証します。

セルフホストする人ごとに、自分のSpotify Developer Appを作成する前提です。
共通のClient IDやClient Secretは配布しません。Web API経由の再生操作には
Spotify Premiumが必要です。

### HTTP API

```text
GET  /health
GET  /api/player
POST /api/player/play-pause
POST /api/player/next
POST /api/player/previous
```

テストと構文チェック：

```sh
npm test
npm run check
```

### Spotifyとの接続解除

サーバーを停止してから次を実行すると、ローカルに保存したOAuthトークンを
削除できます。

```sh
npm run spotify:disconnect
```

データの扱いは[PRIVACY.md](PRIVACY.md)を参照してください。

## CoreS3ファームウェア

1. `firmware/include/config.example.h`を`firmware/include/config.h`へコピーし、
   サーバーのLAN内URLを設定します。
2. CoreS3を接続し、シリアルポートを確認します。
3. PlatformIOでビルドして書き込みます。

```sh
cd firmware
pio run -e m5stack-cores3
pio run -e m5stack-cores3 -t upload --upload-port /dev/cu.usbmodemXXXX
```

初回起動時は、スマートフォンまたはMacからWi-Fiアクセスポイント
`stack-chan-setup`へ接続します。パスワードは`stackchan`です。
<http://192.168.4.1>を開き、自宅Wi-FiとサーバーURLを入力してください。

設定はESP32のNVSへ保存され、ソースコードには入りません。接続できない場合は
再びセットアップモードになります。保存済み設定を消すには、CoreS3の画面を
押したまま電源を入れます。

## 操作

- 左側をタップ：前の曲
- 中央をタップ：再生／一時停止
- 右側をタップ：次の曲

画面には正方形のアルバムジャケット、再生状態、プログレスバーを表示します。

## 注意事項

- 個人・非商用のセルフホスト利用を想定しています。
- 音声データの取得、保存、再配信は行いません。
- SpotifyアプリやWeb APIの変更により動作しなくなる可能性があります。
- Client Secret、OAuthトークン、`.env`をGitへコミットしないでください。
