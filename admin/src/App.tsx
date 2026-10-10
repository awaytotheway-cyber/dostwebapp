import { Link, Route, Routes, useLocation } from 'react-router-dom';
import ScreensList from './pages/ScreensList';
import ScreenForm from './pages/ScreenForm';
import BuiltInScreens from './pages/BuiltInScreens';
import ScreenTextEditor from './pages/ScreenTextEditor';

export default function App() {
  const { pathname } = useLocation();
  const onBuiltIn = pathname.startsWith('/builtin');

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>DOST admin</h1>
          <div className="small" style={{ marginTop: 4 }}>
            Edit the onboarding flow. No login yet — keep this local.
          </div>
        </div>
        <nav>
          <Link to="/builtin" style={onBuiltIn ? { fontWeight: 600 } : undefined}>
            Built-in screens
          </Link>
          <Link to="/" style={!onBuiltIn ? { fontWeight: 600 } : undefined}>
            Extra screens
          </Link>
          <Link to="/new">+ New</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<ScreensList />} />
        <Route path="/new" element={<ScreenForm mode="create" />} />
        <Route path="/edit/:id" element={<ScreenForm mode="edit" />} />
        <Route path="/builtin" element={<BuiltInScreens />} />
        <Route path="/builtin/:screenKey" element={<ScreenTextEditor />} />
      </Routes>
    </div>
  );
}
