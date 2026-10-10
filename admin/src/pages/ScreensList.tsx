import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type OnboardingScreen } from '../supabase';

export default function ScreensList() {
  const [screens, setScreens] = useState<OnboardingScreen[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('admin_onboarding_screens')
      .select('*')
      .order('position', { ascending: true });
    if (error) {
      setErr(error.message);
      setScreens([]);
    } else {
      setScreens((data ?? []) as OnboardingScreen[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (s: OnboardingScreen) => {
    const { error } = await supabase
      .from('admin_onboarding_screens')
      .update({ is_active: !s.is_active, updated_at: new Date().toISOString() })
      .eq('id', s.id);
    if (error) setErr(error.message);
    else void load();
  };

  const remove = async (s: OnboardingScreen) => {
    if (!window.confirm(`Delete "${s.title}"? This also removes every user answer to it.`)) return;
    const { error } = await supabase.from('admin_onboarding_screens').delete().eq('id', s.id);
    if (error) setErr(error.message);
    else void load();
  };

  if (loading) return <div className="card">Loading…</div>;
  if (err) return <div className="card err">{err}</div>;

  if (screens.length === 0) {
    return (
      <div className="card">
        <p>No admin onboarding screens yet.</p>
        <Link to="/new">
          <button>Create the first one</button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      {screens.map((s) => (
        <div key={s.id} className="card">
          <div className="row">
            <div>
              <div style={{ fontWeight: 600 }}>{s.title}</div>
              <div className="small">
                position {s.position} · {s.question_type.replace('_', ' ')}
              </div>
            </div>
            <div className="spacer" />
            <span className={`badge ${s.is_active ? 'active' : 'inactive'}`}>
              {s.is_active ? 'active' : 'inactive'}
            </span>
            {s.is_required ? <span className="badge required">required</span> : null}
          </div>
          {s.subtitle ? <p className="small" style={{ marginTop: 10 }}>{s.subtitle}</p> : null}
          {s.question_type === 'single_choice' && s.options ? (
            <div className="small" style={{ marginTop: 8 }}>
              Options: {s.options.map((o) => o.label).join(' · ')}
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 14 }}>
            <Link to={`/edit/${s.id}`}>
              <button className="secondary">Edit question</button>
            </Link>
            <button className="secondary" onClick={() => void toggleActive(s)}>
              {s.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <div className="spacer" />
            <button className="danger" onClick={() => void remove(s)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
