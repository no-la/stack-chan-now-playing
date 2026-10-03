#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <M5Unified.h>
#include <Preferences.h>
#include <qrcode.h>
#include <WebServer.h>
#include <WiFi.h>
#include <memory>

#include "config.h"
#include "spotify_icon.h"

namespace {
constexpr char kPreferencesNamespace[] = "stack-chan";
constexpr char kSetupSsid[] = "stack-chan-setup";
constexpr char kSetupPassword[] = "stackchan";
constexpr uint32_t kConnectTimeoutMs = 15000;
constexpr uint32_t kPollIntervalMs = 2000;
constexpr uint16_t kStatusColor = 0xBDF7;

Preferences preferences;
DNSServer dnsServer;
WebServer webServer(80);
LGFX_Sprite playerFrame(&M5.Display);
String serverUrl;
String lastTrack;
String lastArtworkUrl;
String lastPlayerError;
String lastSpotifyUrl;
bool lastPlaying = false;
bool hasPlayerState = false;
bool linkViewVisible = false;
uint32_t lastProgress = 0;
uint32_t lastDuration = 0;
uint16_t progressColor = TFT_GREEN;
std::unique_ptr<uint8_t[]> artworkData;
size_t artworkSizeBytes = 0;
uint16_t artworkSourceWidth = 0;
uint32_t lastPollAt = 0;

void drawStatus(const char* status) {
  M5.Display.clear(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(12, 12);
  M5.Display.println(status);
}

String escapeHtml(const String& input) {
  String output;
  output.reserve(input.length());
  for (const char character : input) {
    switch (character) {
      case '&': output += F("&amp;"); break;
      case '<': output += F("&lt;"); break;
      case '>': output += F("&gt;"); break;
      case '"': output += F("&quot;"); break;
      case '\'': output += F("&#39;"); break;
      default: output += character;
    }
  }
  return output;
}

String setupPage() {
  const String savedSsid = preferences.getString("wifi_ssid", "");
  const String savedServer = preferences.getString("server_url", DEFAULT_SERVER_URL);
  String page = F(
      "<!doctype html><html><head><meta charset=utf-8>"
      "<meta name=viewport content='width=device-width,initial-scale=1'>"
      "<title>stack-chan setup</title><style>"
      "body{font:16px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem}"
      "label{display:block;margin-top:1rem}input{box-sizing:border-box;width:100%;padding:.7rem}"
      "button{margin-top:1.5rem;padding:.8rem 1.2rem}</style></head><body>"
      "<h1>stack-chan setup</h1><form method=post action=/save>"
      "<label>Wi-Fi SSID<input name=ssid required value=\"");
  page += escapeHtml(savedSsid);
  page += F("\"></label><label>Wi-Fi password<input name=password type=password required></label>"
            "<label>Server URL<input name=server required value=\"");
  page += escapeHtml(savedServer);
  page += F("\"></label><button type=submit>Save and restart</button></form></body></html>");
  return page;
}

void sendSetupPage() {
  webServer.send(200, "text/html; charset=utf-8", setupPage());
}

[[noreturn]] void startProvisioning(const char* reason) {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(kSetupSsid, kSetupPassword);
  const IPAddress address = WiFi.softAPIP();

  dnsServer.start(53, "*", address);
  webServer.on("/", HTTP_GET, sendSetupPage);
  webServer.on("/save", HTTP_POST, [] {
    String ssid = webServer.arg("ssid");
    String password = webServer.arg("password");
    String configuredServer = webServer.arg("server");
    ssid.trim();
    configuredServer.trim();
    while (configuredServer.endsWith("/")) configuredServer.remove(configuredServer.length() - 1);

    if (ssid.isEmpty() || password.isEmpty() || !configuredServer.startsWith("http://")) {
      webServer.send(400, "text/plain; charset=utf-8", "SSID, password, and an http:// server URL are required.");
      return;
    }

    preferences.putString("wifi_ssid", ssid);
    preferences.putString("wifi_password", password);
    preferences.putString("server_url", configuredServer);
    webServer.send(200, "text/html; charset=utf-8", "<h1>Saved</h1><p>stack-chan is restarting...</p>");
    delay(750);
    ESP.restart();
  });
  webServer.onNotFound(sendSetupPage);
  webServer.begin();

  M5.Display.clear(TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(12, 12);
  M5.Display.printf("Wi-Fi setup\n\n%s\n%s\n\nhttp://%s\n\n%s",
                    kSetupSsid, kSetupPassword, address.toString().c_str(), reason);

  for (;;) {
    dnsServer.processNextRequest();
    webServer.handleClient();
    M5.update();
    delay(2);
  }
}

bool resetRequestedByTouch() {
  M5.update();
  if (M5.Touch.getCount() == 0) return false;

  drawStatus("Keep holding to reset Wi-Fi...");
  const uint32_t startedAt = millis();
  while (millis() - startedAt < 2000) {
    M5.update();
    if (M5.Touch.getCount() == 0) return false;
    delay(10);
  }
  return true;
}

bool connectToConfiguredWifi() {
  const String ssid = preferences.getString("wifi_ssid", "");
  const String password = preferences.getString("wifi_password", "");
  serverUrl = preferences.getString("server_url", DEFAULT_SERVER_URL);
  if (ssid.isEmpty() || password.isEmpty()) return false;

  drawStatus("Connecting Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < kConnectTimeoutMs) {
    M5.update();
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

void loadArtwork(const String& artworkUrl) {
  artworkData.reset();
  artworkSizeBytes = 0;
  if (artworkUrl.isEmpty()) return;

  HTTPClient artworkRequest;
  artworkRequest.setTimeout(7000);
  artworkRequest.begin(artworkUrl);
  const int artworkStatus = artworkRequest.GET();
  const int artworkSize = artworkRequest.getSize();
  if (artworkStatus == HTTP_CODE_OK && artworkSize > 0 && artworkSize <= 384 * 1024) {
    std::unique_ptr<uint8_t[]> downloaded(new uint8_t[artworkSize]);
    const size_t bytesRead = artworkRequest.getStream().readBytes(downloaded.get(), artworkSize);
    if (bytesRead == static_cast<size_t>(artworkSize)) {
      artworkData = std::move(downloaded);
      artworkSizeBytes = artworkSize;
    }
  }
  artworkRequest.end();
}

void drawProgress() {
  constexpr int y = 232;
  playerFrame.fillRect(0, y, 320, 8, TFT_DARKGREY);
  const int played = lastDuration > 0
                         ? static_cast<int>((static_cast<uint64_t>(lastProgress) * 320) / lastDuration)
                         : 0;
  playerFrame.fillRect(0, y, played, 8, lastPlaying ? progressColor : TFT_LIGHTGREY);
}

void updateProgressColorFromArtwork() {
  progressColor = TFT_GREEN;
  int bestScore = -1;
  uint8_t bestRed = 0;
  uint8_t bestGreen = 255;
  uint8_t bestBlue = 0;

  // Sample a grid from the contained 240x240 artwork. Favor saturated colors
  // near the middle of the luminance range and ignore black/white backgrounds.
  for (int y = 8; y < 232; y += 16) {
    for (int x = 48; x < 280; x += 16) {
      const uint16_t color = playerFrame.readPixel(x, y);
      const uint8_t red = ((color >> 11) & 0x1F) * 255 / 31;
      const uint8_t green = ((color >> 5) & 0x3F) * 255 / 63;
      const uint8_t blue = (color & 0x1F) * 255 / 31;
      const uint8_t maximum = max(red, max(green, blue));
      const uint8_t minimum = min(red, min(green, blue));
      const int chroma = maximum - minimum;
      const int luminance = (red * 54 + green * 183 + blue * 19) >> 8;
      if (chroma < 35 || luminance < 45 || luminance > 225) continue;

      const int score = chroma * 3 - abs(luminance - 155);
      if (score > bestScore) {
        bestScore = score;
        bestRed = red;
        bestGreen = green;
        bestBlue = blue;
      }
    }
  }

  if (bestScore < 0) return;
  const uint8_t maximum = max(bestRed, max(bestGreen, bestBlue));
  const uint16_t scale = maximum > 0 ? 235 * 256 / maximum : 256;
  const uint8_t red = min(255, bestRed * scale / 256);
  const uint8_t green = min(255, bestGreen * scale / 256);
  const uint8_t blue = min(255, bestBlue * scale / 256);
  progressColor = ((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3);
}

void darkenArtwork() {
  for (int y = 0; y < 232; ++y) {
    for (int x = 40; x < 280; ++x) {
      const uint16_t color = playerFrame.readPixel(x, y);
      const uint16_t red = ((color >> 11) & 0x1F) * 3 / 4;
      const uint16_t green = ((color >> 5) & 0x3F) * 3 / 4;
      const uint16_t blue = (color & 0x1F) * 3 / 4;
      playerFrame.drawPixel(x, y, (red << 11) | (green << 5) | blue);
    }
  }
}

void drawPauseIndicator() {
  playerFrame.fillRoundRect(146, 102, 9, 36, 3, kStatusColor);
  playerFrame.fillRoundRect(165, 102, 9, 36, 3, kStatusColor);
}

void drawSpotifyAttribution() {
  playerFrame.drawPng(kSpotifyIconPng, kSpotifyIconPng_len, 8, 8);
}

void drawSpotifyLink() {
  if (lastSpotifyUrl.isEmpty()) return;
  constexpr uint8_t version = 6;
  uint8_t qrData[qrcode_getBufferSize(version)];
  QRCode qrCode;
  qrcode_initText(&qrCode, qrData, version, ECC_LOW, lastSpotifyUrl.c_str());

  playerFrame.fillScreen(TFT_WHITE);
  constexpr int scale = 4;
  const int qrPixels = qrCode.size * scale;
  const int originX = (320 - qrPixels) / 2;
  const int originY = 31;
  for (uint8_t y = 0; y < qrCode.size; ++y) {
    for (uint8_t x = 0; x < qrCode.size; ++x) {
      if (qrcode_getModule(&qrCode, x, y)) {
        playerFrame.fillRect(originX + x * scale, originY + y * scale,
                             scale, scale, TFT_BLACK);
      }
    }
  }
  playerFrame.setTextDatum(textdatum_t::top_center);
  playerFrame.setTextColor(TFT_BLACK, TFT_WHITE);
  playerFrame.setTextSize(2);
  playerFrame.drawString("OPEN SPOTIFY", 160, 8);
  playerFrame.setTextDatum(textdatum_t::top_left);
  playerFrame.pushSprite(0, 0);
  linkViewVisible = true;
}

void drawPlayerSurface() {
  playerFrame.fillScreen(TFT_BLACK);
  if (artworkData && artworkSizeBytes > 0) {
    // Contain square Spotify artwork within the 320x240 display.
    const float scale = artworkSourceWidth > 0 ? 240.0f / artworkSourceWidth : 1.0f;
    playerFrame.drawJpg(artworkData.get(), artworkSizeBytes, 40, 0, 240, 240,
                        0, 0, scale, scale);
    updateProgressColorFromArtwork();
  }
  if (!lastPlaying) {
    darkenArtwork();
    drawPauseIndicator();
  }
  drawSpotifyAttribution();
  drawProgress();
  if (!lastPlayerError.isEmpty()) {
    playerFrame.fillRect(0, 0, 320, 18, 0x6000);
    playerFrame.setTextColor(TFT_WHITE, 0x6000);
    playerFrame.setTextSize(1);
    playerFrame.setCursor(5, 5);
    playerFrame.print(lastPlayerError);
  }
  playerFrame.pushSprite(0, 0);
}

void drawPlayer(const JsonDocument& state) {
  const String track = state["track"] | "";
  const String artworkUrl = state["artworkUrl"] | "";
  const uint16_t artworkWidth = state["artworkWidth"] | 0;
  const bool playing = state["playing"] | false;
  const uint32_t progress = state["progressMs"].as<uint32_t>();
  const uint32_t duration = state["durationMs"].as<uint32_t>();
  const String spotifyUrl = state["spotifyUrl"] | "";
  const String playerError = state["error"]["code"] | "";

  const bool artworkChanged = track != lastTrack || artworkUrl != lastArtworkUrl ||
                              artworkWidth != artworkSourceWidth || !hasPlayerState;
  const bool playbackChanged = hasPlayerState && playing != lastPlaying;
  const bool errorChanged = playerError != lastPlayerError;
  const bool linkChanged = spotifyUrl != lastSpotifyUrl;
  if (artworkChanged) {
    lastTrack = track;
    lastArtworkUrl = artworkUrl;
    artworkSourceWidth = artworkWidth;
    loadArtwork(artworkUrl);
  }
  lastPlaying = playing;
  lastProgress = progress;
  lastDuration = duration;
  lastSpotifyUrl = spotifyUrl;
  lastPlayerError = playerError;
  hasPlayerState = true;

  if (artworkChanged || playbackChanged || errorChanged || linkChanged) {
    drawPlayerSurface();
  } else {
    drawProgress();
    playerFrame.pushSprite(0, 0);
  }
}

void sendPlayerCommand(const char* command) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.setTimeout(4000);
  http.begin(serverUrl + "/api/player/" + command);
  const int status = http.POST("");
  Serial.printf("player command %s: %d\n", command, status);
  http.end();
  if (status == HTTP_CODE_NO_CONTENT && strcmp(command, "play-pause") == 0) {
    lastPlaying = !lastPlaying;
    drawPlayerSurface();
  }
  lastPollAt = 0;
}

void handleTouch() {
  const auto touch = M5.Touch.getDetail();
  if (!touch.wasPressed()) return;
  if (linkViewVisible) {
    linkViewVisible = false;
    drawPlayerSurface();
    lastPollAt = 0;
    return;
  }
  if (!lastSpotifyUrl.isEmpty() && touch.x >= 4 && touch.x < 36 && touch.y < 40) {
    drawSpotifyLink();
    return;
  }
  if (touch.x < 80) {
    sendPlayerCommand("previous");
  } else if (touch.x < 240) {
    sendPlayerCommand("play-pause");
  } else {
    sendPlayerCommand("next");
  }
}

void fetchPlayer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.setTimeout(4000);
  http.begin(serverUrl + "/api/player");
  const int status = http.GET();
  const String payload = http.getString();
  if (status != HTTP_CODE_OK) {
    Serial.printf("player request failed: %d\n", status);
    http.end();
    JsonDocument errorDocument;
    if (deserializeJson(errorDocument, payload) == DeserializationError::Ok) {
      const String code = errorDocument["error"]["code"] | "";
      if (!code.isEmpty()) {
        drawStatus(code.c_str());
        return;
      }
    }
    char statusMessage[48];
    snprintf(statusMessage, sizeof(statusMessage), "Server error: %d", status);
    drawStatus(statusMessage);
    return;
  }

  http.end();
  JsonDocument document;
  const DeserializationError error = deserializeJson(document, payload);
  if (error) {
    Serial.printf("JSON error: %s (payload bytes: %u)\n", error.c_str(), payload.length());
    drawStatus("Invalid server response");
    return;
  }
  drawPlayer(document);
}
}  // namespace

void setup() {
  auto config = M5.config();
  M5.begin(config);
  Serial.begin(115200);
  playerFrame.setColorDepth(16);
  playerFrame.setPsram(true);
  if (playerFrame.createSprite(M5.Display.width(), M5.Display.height()) == nullptr) {
    drawStatus("Frame buffer failed");
    while (true) delay(1000);
  }
  preferences.begin(kPreferencesNamespace, false);

  if (resetRequestedByTouch()) {
    preferences.clear();
    startProvisioning("Saved settings cleared.");
  }
  if (!connectToConfiguredWifi()) {
    startProvisioning("Enter your home Wi-Fi.");
  }

  Serial.printf("Wi-Fi connected: %s\n", WiFi.localIP().toString().c_str());
  drawStatus("Connected");
  fetchPlayer();
}

void loop() {
  M5.update();
  handleTouch();
  if (linkViewVisible) {
    delay(10);
    return;
  }
  const uint32_t now = millis();
  if (now - lastPollAt >= kPollIntervalMs) {
    lastPollAt = now;
    fetchPlayer();
  }
  delay(10);
}
