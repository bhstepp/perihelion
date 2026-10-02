import Capacitor
import GameKit
import UIKit

/// Game Center for Perihelion: sign-in, leaderboard scores, achievements and the dashboard.
///
/// The JavaScript side (src/native/ios-native.js) decides *what* to report from the game's own save; this class only
/// talks to GameKit. Every method resolves or rejects exactly once, and a player who is not signed in is never an
/// error the game has to handle: the calls simply report `authenticated: false`.
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showDashboard", returnType: CAPPluginReturnPromise)
    ]

    private var handlerInstalled = false
    private var settled = false
    private var waitingForSignIn: [CAPPluginCall] = []
    /// Game Center's own sign-in screen, when GameKit asks for one. It is shown when the player taps the Game Center
    /// button, not at launch, so nobody is interrupted by a sign-in sheet they did not ask for.
    private var loginController: UIViewController?
    /// A dashboard request that is waiting for Game Center to finish signing the player in.
    private var pendingDashboard: CAPPluginCall?
    /// Whether that request has already shown Game Center's sign-in screen (so a cancel is not followed by an alert).
    private var pendingSawLogin = false

    private func status() -> [String: Any] {
        return ["authenticated": GKLocalPlayer.local.isAuthenticated]
    }

    private func installHandler() {
        if handlerInstalled { return }
        handlerInstalled = true
        GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, _ in
            DispatchQueue.main.async {
                self?.authenticationChanged(viewController)
            }
        }
    }

    /// GameKit calls this at launch and again whenever the sign-in state changes. Always on the main queue.
    private func authenticationChanged(_ viewController: UIViewController?) {
        settled = true
        loginController = viewController

        let current = status()
        let waiting = waitingForSignIn
        waitingForSignIn = []
        for call in waiting {
            call.resolve(current)
        }

        guard let call = pendingDashboard else { return }
        if let login = viewController {
            loginController = nil
            pendingSawLogin = true
            present(login)
        } else {
            pendingDashboard = nil
            if GKLocalPlayer.local.isAuthenticated {
                openDashboard(call)
            } else {
                if !pendingSawLogin { explainSignIn() }
                call.resolve(current)
            }
        }
    }

    private func present(_ controller: UIViewController) {
        guard let presenter = bridge?.viewController, presenter.presentedViewController == nil else { return }
        presenter.present(controller, animated: true, completion: nil)
    }

    private func openDashboard(_ call: CAPPluginCall) {
        // Right after a sign-in, Game Center's own sheet may still be closing; give it a moment first.
        let busy = bridge?.viewController?.presentedViewController != nil
        DispatchQueue.main.asyncAfter(deadline: .now() + (busy ? 0.6 : 0)) {
            GKAccessPoint.shared.trigger(state: .default) { }
        }
        call.resolve(status())
    }

    private func explainSignIn() {
        let alert = UIAlertController(
            title: "Game Center",
            message: "Sign in to Game Center in the Settings app to see leaderboards and achievements.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default, handler: nil))
        present(alert)
    }

    /// Starts Game Center authentication (once) and resolves with `{ authenticated }`. Never shows any interface.
    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.settled {
                call.resolve(self.status())
                return
            }
            self.waitingForSignIn.append(call)
            self.installHandler()
        }
    }

    /// `{ id, value }`: submits one score to one leaderboard.
    @objc func submitScore(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not signed in to Game Center")
            return
        }
        guard let leaderboard = call.getString("id"), let value = call.getInt("value") else {
            call.reject("id and value are required")
            return
        }
        GKLeaderboard.submitScore(value, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [leaderboard]) { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    /// `{ ids: [String] }`: marks each achievement as complete. Game Center ignores ones it already has.
    @objc func reportAchievements(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Not signed in to Game Center")
            return
        }
        let ids = call.getArray("ids", String.self) ?? []
        if ids.isEmpty {
            call.resolve()
            return
        }
        var achievements: [GKAchievement] = []
        for id in ids {
            let achievement = GKAchievement(identifier: id)
            achievement.percentComplete = 100
            achievement.showsCompletionBanner = false   // the game shows its own honour toast
            achievements.append(achievement)
        }
        GKAchievement.report(achievements, withCompletionHandler: { error in
            if let error = error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        })
    }

    /// Opens the Game Center dashboard. If the player is not signed in, offers Game Center's sign-in screen first
    /// (or explains where to sign in when iOS no longer offers one). Resolves with `{ authenticated }`.
    @objc func showDashboard(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if GKLocalPlayer.local.isAuthenticated {
                self.openDashboard(call)
                return
            }
            if let waiting = self.pendingDashboard {
                self.pendingDashboard = nil
                waiting.resolve(self.status())
            }
            if let login = self.loginController {
                self.pendingDashboard = call
                self.pendingSawLogin = true
                self.loginController = nil
                self.present(login)
                return
            }
            if !self.settled {
                // Game Center has not answered yet: open the dashboard (or its sign-in screen) as soon as it does.
                self.pendingDashboard = call
                self.pendingSawLogin = false
                self.installHandler()
                return
            }
            self.explainSignIn()
            call.resolve(self.status())
        }
    }
}
