import { Link, Route, Routes } from 'react-router-dom';
import ScreensList from './pages/ScreensList';
import ScreenForm from './pages/ScreenForm';

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>DOST admin</h1>
          <div className="small" style={{ marginTop: 4 }}>
            Add and edit onboarding screens. No login yet — keep this local.
          </div>
        </div>
        <nav>
          <Link to="/">Screens</Link>
          <Link to="/new">+ New screen</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<ScreensList />} />
        <Route path="/new" element={<ScreenForm mode="create" />} />
        <Route path="/edit/:id" element={<ScreenForm mode="edit" />} />
      </Routes>
    </div>
  );
}
