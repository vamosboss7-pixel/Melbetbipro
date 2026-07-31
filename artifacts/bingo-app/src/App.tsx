import { Switch, Route } from 'wouter'
import LobbyPage from './pages/LobbyPage'
import SlotSelectionPage from './pages/SlotSelectionPage'
import GamePage from './pages/GamePage'
import WinnerPage from './pages/WinnerPage'

export default function App() {
  return (
    <div className="game-bg" style={{ minHeight: '100vh', maxWidth: 480, margin: '0 auto', position: 'relative', overflow: 'hidden' }}>
      <Switch>
        <Route path="/" component={LobbyPage} />
        <Route path="/slots" component={SlotSelectionPage} />
        <Route path="/game" component={GamePage} />
        <Route path="/winner" component={WinnerPage} />
      </Switch>
    </div>
  )
}
