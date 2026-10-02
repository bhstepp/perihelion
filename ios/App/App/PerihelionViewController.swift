import Capacitor
import UIKit

/// The app's root view controller: Capacitor's web view, plus the pieces that belong to this game.
class PerihelionViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }

    /// A full-screen game: no clock or battery over the engraving. (Info.plist hides the bar during launch too.)
    override var prefersStatusBarHidden: Bool {
        return true
    }

    /// The whole screen is a pull-back surface, and a long pull often ends at the bottom edge. Deferring the system
    /// gesture there means the first swipe up only wakes the home indicator instead of leaving the game mid-aim.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        return [.bottom]
    }
}
