# Perihelion for iPhone (App Store build)

The App Store app is the same game as the web build, packaged with [Capacitor](https://capacitorjs.com) and given the
things a web page on an iPhone cannot have. The game's own source (`src/*.js`) is not changed for it, and `index.html`
and `sw.js` build byte-for-byte the same as before.

## What the app adds

| | Web page | App |
|---|---|---|
| Where the game lives | Downloaded from GitHub Pages | Inside the app bundle. No network request is ever made, fonts included |
| Haptics | None (iOS Safari has no `navigator.vibrate`) | Taptic Engine: launch, fragment, wormhole, crash, sealed plate, aim tick |
| Progress | `localStorage` only | `localStorage`, copied to the app's UserDefaults and restored if iOS clears web storage |
| Game Center | None | 3 leaderboards, 39 achievements (the honours), dashboard button in the Observer's Log |
| Daily Plate | Result card | Result card with **Share** (the iOS share sheet, a spoiler-free line of text) |
| System behaviour | Safari rules | No status bar, portrait only, first swipe up from the bottom edge does not leave the game |

All of it is in three places:

- `src/native/ios-native.js`: the JavaScript side. It hooks `navigator.vibrate`, `localStorage` writes and two
  pieces of markup, so no game module had to change. Inert in a plain browser.
- `ios/App/App/GameCenterPlugin.swift` and `PerihelionViewController.swift`: the Swift side (about 200 lines).
- `tools/build-ios.js`: builds `ios-www/` from the web build, with bundled fonts and the native layer.

Haptics, share and the save copy use Capacitor's official plugins (`@capacitor/haptics`, `share`, `preferences`).

## Build and run

You need a Mac with Xcode 26 or later, Node 22 or later, and (for a real phone or the App Store) a paid Apple
Developer Program membership.

```sh
npm install
npm run ios:sync      # builds ios-www/ and copies it into the Xcode project
npm run ios:open      # opens ios/App/App.xcodeproj in Xcode
```

In Xcode: select the **App** target > **Signing & Capabilities**, choose your team, then pick a simulator or your
phone and press Run. The first build downloads Capacitor's Swift package, which takes a minute.

After any change to the game, run `npm run ios:sync` again before building in Xcode. `ios-www/` and
`ios/App/App/public/` are generated and git-ignored.

Things you may want to change:

- **Bundle ID:** `com.bhstepp.perihelion`, in `capacitor.config.json` and in the App target's build settings. It
  cannot be changed after the first upload.
- **Version:** `MARKETING_VERSION` (1.0) and `CURRENT_PROJECT_VERSION` (1) in the App target. Raise the build number for
  every upload.
- **No Game Center:** set `gameCenter: false` in `CONFIG` at the top of `src/native/ios-native.js` and remove the
  Game Center capability in Xcode. A free (personal) Apple team cannot sign an app with Game Center, so do this if
  you want to try the app on your phone before joining the developer program.

## Tests

```sh
npm run build:ios && npm run test:ios
```

59 checks drive the app's page in Chromium with a stand-in for the native bridge: the page makes no network request,
every `vibrate` maps to the right haptic, the save is copied and restored, Game Center receives the right IDs and
values and nothing twice, Share produces the right text, and the game still plays when every native call fails. The
game's own suites (`npm test`, `npm run test:flow`, `npm run test:log`) cover the game itself.

What these cannot cover is the Swift code and the Xcode project, which only Xcode can compile.
`.github/workflows/ios.yml` does that on GitHub's macOS runners on every push: a green check there means the app
compiles for the simulator.

**Check on a real iPhone before submitting** (none of this can be seen in a browser):

1. Sound follows the ringer switch, and other apps' music keeps playing under the game.
2. Haptics feel right, in particular the aim tick when a pull crosses the cancel distance.
3. The first swipe up from the bottom edge during a pull does not leave the game.
4. Game Center: the welcome banner at launch, scores and achievements arriving, the button in the Observer's Log.
5. The title screen appears from the ink launch screen without a white flash.
6. Progress survives closing and reopening the app, and an update installed over it. (Deleting the app deletes
   local progress; Game Center keeps the scores and achievements.)

## Game Center

`ios/game-center/SETUP.md` lists every leaderboard and achievement with its exact ID, title, description and points,
and `ios/game-center/achievements/` has the image App Store Connect requires for each. They are generated from the
honours in `src/55-log.js` by `node tools/make-gamecenter.js`, so run that again if you add an honour.

The Observer's Log remains the source of truth. After each save the app reports whatever Game Center has not been
told yet, and once per launch it re-sends everything, so a new phone or a late sign-in catches up by itself. A player
who is not signed in to Game Center loses nothing; the game never waits on it.

## Submitting to the App Store

1. In App Store Connect, create the app with the bundle ID above. App names are unique across the App Store, so have
   a second choice ready in case "Perihelion" is taken.
2. Set up Game Center from `ios/game-center/SETUP.md` and add the leaderboards and achievements to version 1.0.
3. In Xcode: **Product > Archive**, then **Distribute App > App Store Connect**.
4. Fill in the listing. Screenshots: iPhone only (the app does not target iPad). Category: Games > Puzzle.
5. App Privacy: the app itself collects nothing and contacts no server. Answer the questionnaire yourself; Game
   Center is Apple's service.
6. Export compliance is already answered in `Info.plist` (`ITSAppUsesNonExemptEncryption` = NO).

### About guideline 4.2 ("more than a repackaged website")

This build is made to sit clearly on the right side of that rule: everything is in the bundle and works with no
connection, there is no browser behaviour left (no scrolling page, zoom, selection, link previews or loading bar), and
it uses haptics, Game Center and the share sheet. In the review notes it is worth saying so in plain words, for
example:

> Perihelion is a self-contained puzzle game with 90 hand-verified levels, a daily level and an endless mode. All
> content is inside the app; it makes no network requests and works offline. It supports Game Center leaderboards
> and achievements (Observer's Log > Game Center), haptic feedback, and sharing a Daily Plate result.

Approval is Apple's decision and cannot be promised from here.

## Not done yet

- iPad layout (the target is iPhone-only; iPads run it in iPhone mode).
- iCloud sync of progress between devices.
- A link in shared results: set `CONFIG.shareUrl` once the app has an App Store address.
